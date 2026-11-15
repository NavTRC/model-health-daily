// 個資遮罩規則：回報頁（在使用者裝置上，送出前）和 Worker（收到後再檢查一次）共用同一份。
// 只用規則與檢查碼，不用 AI；只抓有固定格式的四種：手機、Email、身分證字號（含新式居留證）、統一編號。
// 人名、地址、客戶名稱沒有固定格式，抓不準，表單上仍請使用者不要填。

export const KINDS = {
  email: "Email",
  id: "身分證字號",
  phone: "手機號碼",
  ubn: "統一編號",
};

// 身分證字號／新式居留證：1 個英文字母＋9 碼數字，用檢查碼確認（避免把型號誤認成身分證）
const LETTER = { A:10,B:11,C:12,D:13,E:14,F:15,G:16,H:17,I:34,J:18,K:19,L:20,M:21,N:22,O:35,P:23,Q:24,R:25,S:26,T:27,U:28,V:29,W:32,X:30,Y:31,Z:33 };
export function validTwId(s) {
  const m = /^([A-Z])([1289])(\d{8})$/.exec(String(s).toUpperCase());
  if (!m) return false;
  const n = LETTER[m[1]], d = (m[2] + m[3]).split("").map(Number);
  let sum = Math.floor(n / 10) + (n % 10) * 9;
  for (let i = 0; i < 8; i++) sum += d[i] * (8 - i);
  sum += d[8];
  return sum % 10 === 0;
}

// 統一編號：8 碼，加權 1,2,1,2,1,2,4,1、各位數相加；2023 年起規則為能被 5 整除（舊規則被 10 整除也包含在內）
export function validUbn(s) {
  if (!/^\d{8}$/.test(s)) return false;
  const w = [1, 2, 1, 2, 1, 2, 4, 1], d = s.split("").map(Number);
  const digitSum = x => Math.floor(x / 10) + (x % 10);
  const sum = d.reduce((t, v, i) => t + digitSum(v * w[i]), 0);
  return sum % 5 === 0 || (d[6] === 7 && (sum + 1) % 5 === 0);
}

// 看起來像日期（19xx／20xx 年＋合理月日）的 8 碼不當統編，避免把 20261115 遮掉
function looksLikeDate(s) {
  const y = +s.slice(0, 4), mo = +s.slice(4, 6), d = +s.slice(6, 8);
  return y >= 1900 && y <= 2099 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
}

// 回傳 { text: 遮好的文字, counts: {email, id, phone, ubn}, total }
// 不用 lookbehind（舊版 iPhone 的 LINE 內建瀏覽器不支援），改用前後字元判斷
export function maskPII(input) {
  let text = String(input ?? "");
  const counts = { email: 0, id: 0, phone: 0, ubn: 0 };
  const edge = c => !c || !/[A-Za-z0-9]/.test(c);   // 前後不是英數字，才算一個獨立的號碼

  text = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, () => { counts.email++; return "***@***"; });

  text = text.replace(/[A-Za-z][1289]\d{8}/g, (m, off, all) => {
    if (!edge(all[off - 1]) || !edge(all[off + m.length]) || !validTwId(m)) return m;
    counts.id++; return m[0].toUpperCase() + m[1] + "********";
  });

  // 手機：09 開頭 10 碼，或 +886 9 開頭；中間可有 - 或空格
  text = text.replace(/(?:\+?886[-\s]?|0)9\d{2}[-\s]?\d{3}[-\s]?\d{3}/g, (m, off, all) => {
    if (!edge(all[off - 1]) || !edge(all[off + m.length])) return m;
    counts.phone++; return "09XX-XXX-XXX";
  });

  text = text.replace(/\d{8}/g, (m, off, all) => {
    const prev = all[off - 1], next = all[off + m.length];
    if (!edge(prev) || !edge(next) || prev === "." || next === "." || looksLikeDate(m) || !validUbn(m)) return m;
    counts.ubn++; return "********";
  });

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { text, counts, total };
}

// 「手機號碼 1、Email 1」這種摘要
export function describe(counts) {
  return Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${KINDS[k]} ${n}`).join("、");
}
