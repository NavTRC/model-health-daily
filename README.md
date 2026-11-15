# 模型健康日報（課堂練習）

產線上有好幾支辨識模型，辨識率掉了常常要等客訴或停線才發現。
這個工具每天看一次模型運作紀錄，**只把要人決定的模型挑出來**；要不要重新訓練、退回舊版或停用，由人決定。

> 課堂練習作品（智動協會《製造業 AI Agent 實務應用》D4）。資料是**虛擬練習資料**（嶺碩自動化，虛構），不是實際產線數據。

## 頁面

| 路徑 | 用途 |
|---|---|
| `/` | 日報看板（手機優先），第一行是結論；要人看的排前面，正常的摺起來 |
| `/demo` | 90 秒 Demo：自動播放；旁白是事先錄好的台灣語音（曉臻，`public/audio/demo01～12.mp3`），點一下畫面開啟聲音；音檔失敗才退回手機內建朗讀 |
| `/slides` | 簡報（分三章：使用者／主管／技術）；可翻頁，可下載 PDF 或離線 HTML 版 |
| `/slides.pdf` | 簡報 PDF（一張投影片一頁 16:9），由 `bash tools/build-pdf.sh` 產生 |
| `/report` | 回報問題：送出前在使用者裝置上先遮手機、Email、身分證、統編（`public/mask.js`，Worker 用同一份再檢查一次），頁面內確認後才送出 |
| `/admin` | 負責人看回報、改處理狀態（需管理密碼）：狀態色塊與統計、卡片內直接寫處理說明（不跳視窗）、標示「已遮 N 處」個資 |
| `/api/summary` | AI 摘要，僅供參考（Workers AI）：固定一支模型一行「・」，`src/summary-format.js` 整理開場白與沒寫完的句子；伺服器快取 1 小時、瀏覽器不快取；看板顯示產生的模型與時間；失敗時回規則文字 |
| `/api/report`、`/api/reports` | 回報寫入 KV、管理頁讀取與改狀態 |
| `/line/webhook` | LINE 官方帳號聊天問答（Messaging API）：用程式規則回答「今天／缺件／門檻／回報／簡報」，不送 AI；需要 Secret `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN` |

## 狀態規則（`public/health.js`，前後端共用）

- **異常**：今天辨識率 < 95%，或比昨天掉超過 3 個百分點
- **警示（漂移）**：連續 3 天下降且累計掉超過 2 點（只看門檻會漏掉）
- **資料異常**：今天筆數 < 前 7 天平均的 50%（先查資料，不要先怪模型）

## 架構與部署

```
修改 → git push → GitHub → Cloudflare Workers 自動部署（約 30～70 秒）→ LINE（LIFF）裡跟著更新
```

- `wrangler.jsonc`：`name` 要和 repo、Cloudflare 上的名稱一致
- 綁定：`AI`（Workers AI，不用金鑰）、`ASSETS`（public/）、`REPORTS`（KV）
- 機密：`ADMIN_KEY`（管理頁密碼）在 Cloudflare 後台 Settings → Variables and Secrets 設定，**不寫進程式**；LINE 問答的 `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN` 也一樣
- 每次改版把頁尾版本號加 1，在 LINE 裡重新打開確認版本號有變

## AI 治理設計

- 第一道牆：回報表單送出前在**使用者裝置上**先遮手機、Email、身分證、統編（規則＋檢查碼，`public/mask.js`），Worker 收到再用同一份規則檢查一次
- AI 只收到程式算好的數字，不收原始紀錄、製程參數、影像；使用者填的回報、LINE 聊天打的字都**不送給 AI**
- 提示注入實測（2026-11-15）：在回報頁貼假系統通知，狀態沒變、文字原樣顯示，沒有照做
- AI 摘要標「僅供參考，以下方數字為準」；狀態由程式判斷。實測小模型把「掉 12.4 點」寫成「略低」，所以不能讓 AI 判斷
- Workers AI 依序嘗試多個模型（`llama-3.1-8b-instruct` 在免費方案失敗，實際用 `llama-3.2-3b-instruct`）
- 回報有紀錄，負責人改狀態要寫處理說明；管理頁要密碼

## LINE 整合（踩過的坑）

| 狀況 | 解法 |
|---|---|
| Canva 匯出的圖帶 AI 內容憑證，LINE 說格式不對 | 重新存成標準 JPG（本 repo 不含選單圖原檔） |
| `liff.line.me/{id}/demo` 打開的是首頁 | LINE 把路徑放在 `?liff.state=`；首頁的小段程式自己讀出來轉址（只允許站內路徑） |
| LINE 裡無法下載簡報 | LIFF 視窗不吃 `?openExternalBrowser=1`；改在圖文選單用**一般網址** `/slides?openExternalBrowser=1`（C 格）就能跳外部瀏覽器下載 |
| 在頁面加 LIFF SDK 後畫面狂閃 | SDK 會自己處理 `liff.state` 並重導，和上面那段程式打架；已移除，**不要再加** |
| 手機內建朗讀是大陸口音、每台聲音不同 | 改播事先錄好的台灣語音音檔（曉臻，`tools/build-demo-audio.py` 產生）；音檔失敗才用內建朗讀 |
| 管理頁「處理說明」用跳出視窗收，容易沒存到 | 改成卡片內輸入框，按狀態時一起送出 |

## LINE 設定

- 圖文選單四格（2500×1686）：A 打開工具＝`https://liff.line.me/2012586632-UOqlVsSZ`、B 看 Demo＝`…/2012586632-UOqlVsSZ/demo`、D 回報問題＝`…/2012586632-UOqlVsSZ/report`（三格都用 LIFF，在 LINE 裡滑出來）；C 簡報下載刻意用一般網址 `/slides?openExternalBrowser=1`，才會跳手機瀏覽器下載
- LINE Login channel（LIFF 用）已 Publish；Channel icon 圖檔不在 repo 裡（課程資料夾 `D4_發表素材/LINE圖文選單/channel_icon_512.png`）
- 聊天問答（Messaging API channel，和 LIFF 同一個 Provider）：Webhook URL `https://model-health-daily.tzungshiun72.workers.dev/line/webhook`、Use webhook 開啟；官方帳號後台的自動回應訊息、加入好友歡迎訊息都關掉（歡迎訊息改由程式在 follow 事件送）
- **在 LINE Developers 重新發行 access token，舊的會立刻失效**：要同步更新 Cloudflare 的 `LINE_CHANNEL_ACCESS_TOKEN`，否則聊天問答會停止回覆
- `/demo` 的 LINE 聊天室示意用四格選單圖 `public/richmenu4.jpg`

## 改內容時要跟著做

- **改了 Demo 旁白（`public/demo.html` 的 SCENES）**：`PYTHONPATH=.tts python tools/build-demo-audio.py` 重錄音檔（台灣語音曉臻、語速 +10%，第一次先 `python -m pip install --target .tts edge-tts`），再把各幕 `sec` 設成音檔長度＋0.5 秒
- **改了 `public/slides.html`**：執行 `bash tools/build-pdf.sh` 重新產生 PDF（用本機 Edge／Chrome 輸出），再一起 commit、push；腳本會比對 PDF 頁數和投影片張數
- **改了判斷規則或門檻**：`public/health.js` 網頁、Worker、LINE 問答共用，改一處就全部生效；門檻要改先問負責人
- **改了遮個資規則**：`public/mask.js` 回報頁和 Worker 共用

## 待辦

- 異常時主動推播給負責人（每月 200 則免費額度，只推異常）：等接上真實推論紀錄再做，現在是固定的虛擬資料
- 回公司前：資料去識別化、改公司帳號、加登入（Entra ID／LINE Login）、repo 改私人
