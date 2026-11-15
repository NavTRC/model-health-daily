// LINE 問答（Messaging API webhook）
// - 在官方帳號聊天室打字 → LINE 把訊息送到 /line/webhook → 這裡用「程式規則」回答，不送給 AI
//   （使用者打的字只拿來比對關鍵字；提示注入打不進來，也不會有 AI 講錯數字的問題）
// - 用「回應訊息」（Reply），不吃每月 200 則的推播額度
// - 機密：LINE_CHANNEL_SECRET、LINE_CHANNEL_ACCESS_TOKEN 在 Cloudflare 後台設定，不寫進程式
// - 不記錄使用者傳來的文字
import { evaluate, RULES } from "../public/health.js";

const LIFF = "https://liff.line.me/2012586632-UOqlVsSZ";
const SLIDES = "https://model-health-daily.tzungshiun72.workers.dev/slides?openExternalBrowser=1";

export async function lineWebhook(req, env, ctx, loadData, url) {
  if (!env.LINE_CHANNEL_SECRET || !env.LINE_CHANNEL_ACCESS_TOKEN)
    return new Response("LINE 問答尚未開通（缺少 Channel secret 或 access token）", { status: 503 });
  const body = await req.text();
  if (!(await validSignature(body, req.headers.get("x-line-signature") || "", env.LINE_CHANNEL_SECRET)))
    return new Response("signature mismatch", { status: 401 });

  let events = [];
  try { events = JSON.parse(body).events || []; } catch { return new Response("bad json", { status: 400 }); }
  if (!events.length) return new Response("ok"); // LINE 後台按「Verify」時送來的空事件

  const rows = evaluate(await loadData(env, url));
  const work = events.map(ev => {
    let text = null;
    if (ev.type === "follow") text = welcome();
    else if (ev.type === "message" && ev.message?.type === "text") text = answer(ev.message.text, rows);
    else if (ev.type === "message") text = "我只看得懂文字喔。\n\n" + help();
    return text && ev.replyToken ? reply(env, ev.replyToken, text) : null;
  }).filter(Boolean);
  ctx.waitUntil(Promise.allSettled(work));
  return new Response("ok");
}

// ---- 回答規則（全部是程式判斷，不用 AI） ----
export function answer(raw, rows) {
  const q = String(raw || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "").slice(0, 200);
  if (!q) return help();

  // 指名某支模型（刮傷、缺件、印字、取放、障礙…；或代號 VI-2、CW-6、AM-300）
  const hits = rows.filter(r => aliases(r.name).some(a => q.includes(a)));
  if (hits.length && hits.length < rows.length) return hits.map(detail).join("\n\n") + "\n\n" + footer();

  if (/今天|今日|日報|狀況|狀態|摘要|結論|哪幾支|哪支|有問題|異常|要人看|總覽|status|today/.test(q)) return overview(rows);
  if (/回報|反映|錯了|不對|報告問題/.test(q)) return `看到不對，請點選單右下「回報問題」，或打開：\n${LIFF}/report\n\n選模型、寫一句哪裡不對就好；請不要填客戶名稱或個資。負責人會在管理頁處理。`;
  if (/簡報|說明|怎麼用|教學|使用|pdf/.test(q)) return `簡報分三章（使用者／主管／技術），可以下載 PDF：\n${SLIDES}\n\n90 秒 Demo：${LIFF}/demo`;
  if (/門檻|規則|怎麼判斷|標準/.test(q)) return rules();
  if (/ai|人工智慧|摘要準/.test(q)) return "判斷哪支要人看的是程式規則，不是 AI。看板上的 AI 摘要僅供參考，以數字為準；重新訓練、退回舊版、停用一律由人決定。\n\n這個聊天問答也是程式規則回答，沒有用 AI。";
  return help();
}

function aliases(name) {
  const [code, part] = name.split(/\s+/);
  const core = (part || "").replace(/檢測|辨識|定位/g, "");
  return [code, part, core].filter(x => x && x.length >= 2).map(x => x.toLowerCase());
}

const sign = x => (x > 0 ? "+" : "") + x.toFixed(1);
const emoji = r => ({ bad: "🔴", drift: "🟠", data: "🟡", ok: "🟢" })[r.statuses[0].key];

function overview(rows) {
  const need = rows.filter(r => r.needsHuman), ok = rows.filter(r => !r.needsHuman);
  const head = `資料日 ${rows[0].date}：${rows.length} 支模型，${need.length ? need.length + " 支要人看" : "全部正常"}`;
  const lines = need.map(r => `${emoji(r)} ${r.name}｜${r.statuses.map(s => s.label).join("、")}\n　 今天 ${r.rate}%，比昨天 ${sign(r.vsYesterday)} 點`);
  const okLine = ok.length ? `🟢 正常：${ok.map(r => r.name).join("、")}` : "";
  return [head, ...lines, okLine, "", "想看某一支，直接打名稱，例如「缺件」。", footer()].filter(x => x !== "").join("\n");
}

function detail(r) {
  const out = [
    `${emoji(r)} ${r.name}｜${r.line}｜${r.statuses.map(s => s.label).join("、")}`,
    `今天 ${r.rate}%，比昨天 ${sign(r.vsYesterday)} 點，比 7 天平均 ${sign(r.vsAvg)} 點`,
    `筆數 ${r.n.toLocaleString("en-US")}（平常的 ${Math.round(r.nRatio * 100)}%）`,
  ];
  if (r.advice.guess) out.push(r.advice.guess, "可以選的處理方式（由人決定）：" + r.advice.options.join("／"));
  return out.join("\n");
}

function rules() {
  return [
    "判斷規則（程式自動算，門檻要改先問負責人）：",
    `🔴 異常：今天辨識率 < ${RULES.rateFloor}%，或比昨天掉超過 ${RULES.dayDrop} 點`,
    `🟠 漂移：連續 ${RULES.driftDays} 天下降，累計掉超過 ${RULES.driftTotal} 點`,
    `🟡 資料異常：今天筆數不到平常的 ${Math.round(RULES.dataRatio * 100)}%（先查資料，別先怪模型）`,
  ].join("\n");
}

const footer = () => `詳細看「打開工具」：${LIFF}`;
const help = () => [
  "你可以問我：",
  "・今天 → 今天哪幾支要人看",
  "・缺件／印字／刮傷／取放／障礙 → 某一支的數字",
  "・門檻 → 怎麼判斷異常",
  "・回報 → 看到不對怎麼回報",
  "・簡報 → 下載說明簡報",
].join("\n");
const welcome = () => [
  "歡迎使用「模型健康日報」！",
  "每天只挑出要人看的辨識模型，正常的不吵你。（練習用虛擬資料）",
  "",
  "下方選單：",
  "📊 打開工具：看今天哪幾支要人看",
  "▶ 看 Demo：90 秒介紹",
  "⬇ 簡報下載：用手機瀏覽器開啟",
  "❗ 回報問題：看到不對，交給負責人",
  "",
  "也可以直接打字問我：",
  "・今天 → 今天哪幾支要人看",
  "・缺件／印字／刮傷／取放／障礙 → 某一支的數字",
  "・門檻 → 怎麼判斷異常",
].join("\n");

// ---- LINE 簽章驗證與回覆 ----
async function validSignature(body, signature, secret) {
  if (!signature) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const expected = btoa(String.fromCharCode(...mac));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

function reply(env, replyToken, text) {
  return fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
  });
}
