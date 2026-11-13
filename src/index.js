// 模型健康日報：Cloudflare Worker 後端
// - 靜態頁面（public/）由 Assets 直接提供
// - /api/summary：Workers AI 寫一句白話摘要（草稿），失敗時退回固定文字
// - /api/report：使用者回報問題，存進 KV（REPORTS）
// - /api/reports：負責人看回報清單、改處理狀態（需要 ADMIN_KEY）
import { evaluate } from "../public/health.js";

// 依序嘗試；2026-07 起部分模型只給付費方案，所以準備備援（避開課程建議跳過的中國廠商模型）
const MODELS = ["@cf/meta/llama-3.1-8b-instruct", "@cf/meta/llama-3.2-3b-instruct", "@cf/google/gemma-3-12b-it", "@cf/mistral/mistral-7b-instruct-v0.1"];
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/api/summary") return await summary(req, env, ctx, url);
      if (url.pathname === "/api/report" && req.method === "POST") return await createReport(req, env);
      if (url.pathname === "/api/reports") return await listReports(req, env, url);
      if (url.pathname.startsWith("/api/reports/") && req.method === "POST") return await setStatus(req, env, url);
    } catch (e) {
      return json({ ok: false, error: "伺服器錯誤，請稍後再試或回報給負責人" }, 500);
    }
    return env.ASSETS.fetch(req);
  },
};

async function loadData(env, url) {
  const r = await env.ASSETS.fetch(new Request(new URL("/data.json", url)));
  return r.json();
}

async function summary(req, env, ctx, url) {
  const data = await loadData(env, url);
  const rows = evaluate(data);
  const need = rows.filter(r => r.needsHuman);
  const fallback = need.length
    ? `今天 ${rows.length} 支模型中有 ${need.length} 支要人看：` + need.map(r => `${r.name}（${r.statuses.map(s => s.label).join("、")}）`).join("、") + "。"
    : `今天 ${rows.length} 支模型都正常。`;

  // 同一天的摘要快取起來，避免每次打開都耗 Workers AI 額度
  const cache = caches.default;
  const key = new Request(new URL(`/api/summary?d=${rows[0]?.date}&v=2`, url));
  const hit = await cache.match(key);
  if (hit) return hit;

  let text = fallback, source = "rule", model = null;
  const errors = [];
  if (env.AI && need.length) {
    const facts = need.map(r =>
      `${r.name}：今天辨識率 ${r.rate}%，比昨天 ${r.vsYesterday}，筆數為平常的 ${Math.round(r.nRatio * 100)}%，狀態 ${r.statuses.map(s => s.label).join("、")}`).join("\n");
    const messages = [
      { role: "system", content: "你是產線模型維運的助理。只根據使用者給的事實，用繁體中文寫兩句話的摘要給工程師。不要編任何新數字，不要建議重訓、回滾或停用，那是人決定的。" },
      { role: "user", content: `資料日 ${rows[0].date}，共 ${rows.length} 支模型，要人看的有：
${facts}` },
    ];
    for (const m of MODELS) {
      try {
        const res = await env.AI.run(m, { messages, max_tokens: 160 });
        const out = (res && (res.response || res.result?.response) || "").toString().trim();
        if (out) { text = out; source = "ai"; model = m; break; }
        errors.push(`${m}: 空回應`);
      } catch (e) { errors.push(`${m}: ${String(e && e.message || e).slice(0, 120)}`); }
    }
  }
  const resp = json({ ok: true, text, source, model, errors: source === "ai" ? undefined : errors, date: rows[0]?.date });
  // 只有成功的 AI 結果才快取；規則文字不快取，下次再試 AI
  if (source !== "ai") return resp;
  resp.headers.set("cache-control", "public, max-age=3600");
  ctx.waitUntil(cache.put(key, resp.clone()));
  return resp;
}

const clip = (s, n) => String(s ?? "").replace(/[<>]/g, "").trim().slice(0, n);

async function createReport(req, env) {
  if (!env.REPORTS) return json({ ok: false, error: "回報功能尚未開通，請直接在 LINE 官方帳號留言給負責人" }, 503);
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "格式錯誤" }, 400); }
  const item = {
    target: clip(b.target, 40), kind: clip(b.kind, 20), detail: clip(b.detail, 500), who: clip(b.who, 30),
    status: "新回報", at: new Date().toISOString(),
  };
  if (!item.detail) return json({ ok: false, error: "請寫一下哪裡不對" }, 400);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await env.REPORTS.put(`report:${id}`, JSON.stringify(item));
  return json({ ok: true, id });
}

function authed(req, env, url) {
  const k = req.headers.get("x-admin-key") || url.searchParams.get("key") || "";
  return env.ADMIN_KEY && k === env.ADMIN_KEY;
}

async function listReports(req, env, url) {
  if (!env.ADMIN_KEY) return json({ ok: false, error: "尚未設定 ADMIN_KEY，管理頁未開通" }, 503);
  if (!authed(req, env, url)) return json({ ok: false, error: "管理密碼不對" }, 401);
  if (!env.REPORTS) return json({ ok: true, items: [] });
  const list = await env.REPORTS.list({ prefix: "report:", limit: 100 });
  const items = await Promise.all(list.keys.map(async k => ({ id: k.name.slice(7), ...(JSON.parse(await env.REPORTS.get(k.name)) || {}) })));
  items.sort((a, b) => b.at.localeCompare(a.at));
  return json({ ok: true, items });
}

async function setStatus(req, env, url) {
  if (!authed(req, env, url)) return json({ ok: false, error: "管理密碼不對" }, 401);
  const id = url.pathname.split("/").pop();
  const raw = await env.REPORTS.get(`report:${id}`);
  if (!raw) return json({ ok: false, error: "找不到這筆回報" }, 404);
  const b = await req.json().catch(() => ({}));
  const allowed = ["新回報", "處理中", "已解決", "不處理"];
  if (!allowed.includes(b.status)) return json({ ok: false, error: "狀態不對" }, 400);
  const item = JSON.parse(raw); item.status = b.status; item.note = clip(b.note, 200); item.updated = new Date().toISOString();
  await env.REPORTS.put(`report:${id}`, JSON.stringify(item));
  return json({ ok: true });
}
