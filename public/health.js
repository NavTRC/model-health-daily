// 模型健康判斷規則：網頁和 Worker 共用同一份，避免兩邊算出不同結果。
// 門檻與 AGENTS.md 一致；要改門檻，兩邊會一起改。
export const RULES = {
  rateFloor: 95.0,     // 今天辨識率低於這個 → 異常
  dayDrop: 3.0,        // 比昨天掉超過這麼多個百分點 → 異常
  driftDays: 3,        // 連續下降幾天
  driftTotal: 2.0,     // 連續下降累計超過這麼多 → 警示（漂移）
  dataRatio: 0.5,      // 今天筆數低於前 7 天平均的這個比例 → 資料異常
};

export const STATUS = {
  bad:   { key: "bad",   label: "異常",       color: "#d4372c", rank: 0 },
  drift: { key: "drift", label: "警示（漂移）", color: "#e0a34a", rank: 1 },
  data:  { key: "data",  label: "資料異常",    color: "#c9a227", rank: 2 },
  ok:    { key: "ok",    label: "正常",       color: "#3fb37f", rank: 3 },
};

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const r1 = x => Math.round(x * 10) / 10;

export function evaluate(data) {
  const out = [];
  for (const [name, m] of Object.entries(data.models)) {
    const d = [...m.days].sort((a, b) => a.date.localeCompare(b.date));
    const t = d[d.length - 1], y = d[d.length - 2], prev = d.slice(0, -1);
    const avgRate = mean(prev.map(x => x.rate)), avgN = mean(prev.map(x => x.n));
    const last = d.slice(-(RULES.driftDays + 1)).map(x => x.rate);
    const falling = last.every((v, i) => i === 0 || v < last[i - 1]);
    const drop = last[0] - last[last.length - 1];
    const s = [];
    if (t.rate < RULES.rateFloor || y.rate - t.rate > RULES.dayDrop) s.push(STATUS.bad);
    if (falling && drop > RULES.driftTotal) s.push(STATUS.drift);
    if (t.n < avgN * RULES.dataRatio) s.push(STATUS.data);
    if (!s.length) s.push(STATUS.ok);
    out.push({
      name, line: m.line, date: t.date,
      rate: t.rate, vsYesterday: r1(t.rate - y.rate), vsAvg: r1(t.rate - avgRate),
      n: t.n, nRatio: t.n / avgN, miss: t.miss, fp: t.fp,
      trend: d.map(x => x.rate), statuses: s,
      needsHuman: s[0] !== STATUS.ok,
      advice: advise(s),
    });
  }
  out.sort((a, b) => a.statuses[0].rank - b.statuses[0].rank || a.rate - b.rate);
  return out;
}

// 只給「推測」和「選項」，不替人做決定（重新訓練、退回舊版、停用一律由人決定）
function advise(s) {
  const k = s.map(x => x.key);
  if (k.includes("data")) return { guess: "推測：資料沒有完整進來（管線、相機斷線或產線停機），辨識率沒有代表性。", options: ["先查資料管線", "確認產線是否停機"] };
  if (k.includes("bad")) return { guess: "推測：換料、相機位移或光源故障造成單日驟降。", options: ["到產線看相機與光源", "抽今天的誤判樣本", "確認後再決定退回舊版或暫停自動判定"] };
  if (k.includes("drift")) return { guess: "推測：新批次外觀變化或光源老化，造成慢慢變差。", options: ["查新批次樣品與光源使用時數", "在跌破門檻前安排重新訓練"] };
  return { guess: "", options: [] };
}
