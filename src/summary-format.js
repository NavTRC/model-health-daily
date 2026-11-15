// AI 摘要的格式整理（Worker 用）
// 把 AI 寫的摘要整理成固定格式：每行「・…。」、最多 max 行；去掉開場白、編號，丟掉沒寫完的句子。
// 整理後一行都不剩就回空字串，呼叫端改用下一個模型或規則文字。
export function tidySummary(raw, max = 3) {
  let s = String(raw || "").replace(/\r/g, "").trim();
  if (!s) return "";
  s = s.replace(/^[^\n]*(以下|摘要如下|摘要：)[^\n]*[：:]\s*/, "");          // 開場白
  let parts = s.split(/\n+/).map(x => x.trim()).filter(Boolean);
  if (parts.length < 2) parts = s.split(/(?<=。)/).map(x => x.trim()).filter(Boolean);   // 寫成一整段：依句號拆
  const lines = [];
  for (let p of parts) {
    p = p.replace(/^(?:[・•\-*]|\d+[.、)）])\s*/, "").trim();               // 去掉清單符號、編號
    if (!p || /^(總結|總之|以上|整體來說)/.test(p)) continue;
    if (!/[。！？]$/.test(p)) {                                               // 沒寫完：保留到最後一個句號，沒有就丟掉
      const k = Math.max(p.lastIndexOf("。"), p.lastIndexOf("！"), p.lastIndexOf("？"));
      if (k < 0) continue;
      p = p.slice(0, k + 1);
    }
    lines.push("・" + p);
    if (lines.length >= max) break;
  }
  return lines.join("\n");
}
