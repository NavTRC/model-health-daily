#!/usr/bin/env bash
# 把 public/slides.html 輸出成 public/slides.pdf（一張投影片＝一頁 16:9）。
# 改完簡報後執行一次：bash tools/build-pdf.sh ，再 commit、push。
# 需要 Microsoft Edge 或 Google Chrome（用它們的無頭模式輸出 PDF）。
set -euo pipefail
cd "$(dirname "$0")/.."

BROWSER=""
for c in "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
         "/c/Program Files/Microsoft/Edge/Application/msedge.exe" \
         "/c/Program Files/Google/Chrome/Application/chrome.exe" \
         "$(command -v google-chrome 2>/dev/null || true)" \
         "$(command -v chromium 2>/dev/null || true)"; do
  if [ -n "$c" ] && [ -x "$c" ]; then BROWSER="$c"; break; fi
done
[ -n "$BROWSER" ] || { echo "找不到 Edge 或 Chrome"; exit 1; }

SRC="$(pwd)/public/slides.html"
OUT="$(pwd)/public/slides.pdf"
TMP_PROFILE="$(mktemp -d)"
if command -v cygpath >/dev/null 2>&1; then
  URL="file:///$(cygpath -m "$SRC")"; OUT_ARG="$(cygpath -w "$OUT")"; PROFILE_ARG="$(cygpath -w "$TMP_PROFILE")"
else
  URL="file://$SRC"; OUT_ARG="$OUT"; PROFILE_ARG="$TMP_PROFILE"
fi

"$BROWSER" --headless=new --disable-gpu --no-pdf-header-footer --virtual-time-budget=5000 \
  --user-data-dir="$PROFILE_ARG" --print-to-pdf="$OUT_ARG" "$URL" 2>/dev/null || true
rm -rf "$TMP_PROFILE"

[ -s "$OUT" ] || { echo "PDF 沒有產生"; exit 1; }
PAGES=$(grep -ao "/MediaBox" "$OUT" | wc -l | tr -d ' ')
SLIDES=$(grep -c '<section class="s' public/slides.html)
echo "已產生 public/slides.pdf：$PAGES 頁（簡報 $SLIDES 張）"
[ "$PAGES" = "$SLIDES" ] || echo "⚠️ 頁數和投影片數不一致，請打開 PDF 檢查版面"
