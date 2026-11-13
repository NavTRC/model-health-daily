// 在 LINE（LIFF）裡用外部瀏覽器開啟連結。
// LIFF 視窗不吃 ?openExternalBrowser=1，要用 LIFF SDK 的 liff.openWindow({ external: true })。
// 不在 LINE 裡時什麼都不做，連結照常打開。
(function () {
  var LIFF_ID = "2012586632-UOqlVsSZ";
  var inLine = /\bLine\//i.test(navigator.userAgent);
  var ready = false;
  if (inLine) {
    var s = document.createElement("script");
    s.src = "https://static.line-scdn.net/liff/edge/2/sdk.js";
    s.onload = function () {
      try { liff.init({ liffId: LIFF_ID }).then(function () { ready = true; }).catch(function () {}); } catch (e) {}
    };
    document.head.appendChild(s);
  }
  window.openExternal = function (url) {
    var abs = new URL(url, location.origin).href;
    if (inLine && ready && window.liff && liff.isInClient && liff.isInClient()) {
      liff.openWindow({ url: abs, external: true });
    } else if (inLine) {
      // 不是 LIFF 視窗（一般 LINE 內建瀏覽器）：這個參數有效
      location.href = abs + (abs.indexOf("?") >= 0 ? "&" : "?") + "openExternalBrowser=1";
    } else {
      location.href = abs;
    }
  };
  // 標了 data-external 的連結，一律走上面的方法
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[data-external]");
    if (!a || !inLine) return;
    e.preventDefault();
    window.openExternal(a.getAttribute("href"));
  }, true);
})();
