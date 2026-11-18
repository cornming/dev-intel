# 軟體人情報站（dev-intel）

台灣與國際的軟體開發新聞、開源新星專案、職場討論，彙整在同一頁。**每 5 小時自動更新**，不需要任何 API 金鑰、不需要伺服器、沒有第三方套件。

線上看：<https://cornming.github.io/dev-intel/>

## 更新時間

每日（台北時間）00:00、05:00、10:00、15:00、20:00，由 [`update.yml`](.github/workflows/update.yml) 的 cron 觸發（換算成 UTC 是 `0 2,7,12,16,21 * * *`）。GitHub 的排程在尖峰時段可能延遲數分鐘到數十分鐘，這是平台特性。也可以在 Actions 頁面手動執行 `workflow_dispatch`。

## 資料來源

| 來源 | 類型 | 取得方式 |
|---|---|---|
| Hacker News | 國際新聞 | 官方 Firebase API（前 40 名） |
| Lobsters | 國際新聞 | `hottest.json` |
| DEV | 國際文章 | 官方 API（單日熱門） |
| GitHub 新星專案 | 開源專案 | Search API：近 7 天新建、星數最高 |
| GitHub Blog | 官方消息 | RSS |
| iThome | 台灣新聞 | RSS |
| 科技新報 / TechOrange | 台灣新聞 | RSS（只保留命中主題標籤的文章） |
| DEV 職涯 / Lobsters 職場文化 | 職場討論 | 官方 API 的標籤分類（career／culture）；台灣媒體中命中「職場」主題的文章也會列入職場分頁 |

> PTT Soft_Job 曾在清單中，但 PTT 會擋掉 GitHub 機房 IP（HTTP 403），已移除。

## 運作方式

1. `scripts/sources.mjs`：各來源獨立抓取，任一來源失敗不影響其他來源。
2. `scripts/lib.mjs`：解析 RSS/Atom、網址正規化後去重、關鍵字主題標籤、排名。
3. 排名：每個來源內先依分數（沒有分數的依 feed 名次）算百分位，再乘上來源權重，並隨發布時間衰減。各站分數單位不同，所以不直接比較。
4. 上一輪有、這輪沒抓到的項目會保留最多 72 小時（標示「來源暫時無更新」），避免來源暫時故障時整區消失；所有來源都失敗時則不覆寫資料。
5. 前端 `index.html` + `assets/app.js` 讀取 `data/latest.json`，純靜態，標題一律用 `textContent` 渲染。

排名與主題規則都在 `scripts/lib.mjs`、來源清單與權重在 `scripts/sources.mjs`，要新增來源只要加一個 `rssSource({...})`。

## 封面圖

每則以卡片呈現。封面圖依序取得：來源自帶的圖（DEV 的 `cover_image`、RSS 的 `media:content`／`enclosure`／內文第一張圖、GitHub 專案的官方預覽圖）→ 沒有的才去抓文章頁的 `og:image`（`scripts/images.mjs`）。

- 每篇文章只抓一次，結果（含「已查過但沒有圖」）存進資料，下一輪沿用；暫時性失敗最多重試 3 輪。
- 每輪最多查 120 篇、上限 150 秒，排名高的優先；只讀頁面開頭到 `</head>`，最多 300 KB。
- Hacker News／Lobsters 的連結是討論串，不抓。
- 只收 https 圖片，排除追蹤像素與 gif；圖片以 `loading="lazy"`、`referrerpolicy="no-referrer"` 載入，失效時自動退回預設封面。
- 圖片是第三方網站的，本站只引用連結、不儲存圖檔。

## 中文化（Chrome 內建翻譯）

按「🌐 翻成中文」會用瀏覽器內建的 [Translator API](https://developer.chrome.com/docs/ai/translator-api) 把英文標題翻成繁體中文（`zh-Hant`），**不需要任何金鑰，翻譯在讀者本機完成**，內容不會送到我們的伺服器。

- 需要桌面版 Chrome 138 以上；不支援的瀏覽器按鈕會停用並說明，仍可正常閱讀原文。
- 第一次使用會下載翻譯模型（頁面會顯示進度），之後不必再下載。
- 已含中文的標題不翻；GitHub 專案名稱不翻、只翻說明；翻譯後原文以小字保留，方便對照。
- 翻譯結果快取在瀏覽器的 localStorage，重新整理後不必重翻。
- 機器翻譯偶爾會有不準確的地方，請以原文為準。

## 資料不進 git 歷史

`data/latest.json` 每 5 小時就會變動一次（約 26 KB，壓縮後），若每次都提交，一年會多出約 1,800 個 commit。所以工作流程**不提交資料**：每輪開始時先從已部署的網站取回上一輪的 `latest.json`（`scripts/fetch-prev.mjs`），在它的基礎上更新，再直接部署。`data/latest.json` 已加入 `.gitignore`，不在 repo 內；若某輪取不到網站上的檔案，會從空資料重新開始（來源狀態與保留項目會重置，但網站內容仍會重新抓齊）。

## 來源故障通知

每個來源在 `data/latest.json` 都有 `failStreak`（連續失敗輪數）。連續失敗達 3 輪（約 15 小時）時，`scripts/check-health.mjs` 會讓該次工作流程轉紅；這一步放在部署之後，所以網站仍照常更新。GitHub 預設會寄「工作流程失敗」通知信給 repo 擁有者（到 GitHub Settings → Notifications → Actions 確認有開啟）。單次的暫時性失敗不會觸發通知。

## 本機執行

需要 Node.js 20 以上。

```bash
npm test          # 單元測試
npm run build     # 抓取並寫入 data/latest.json
python3 -m http.server 8000   # 打開 http://localhost:8000
```

## 部署（第一次要做一次）

到 repo 的 **Settings → Pages → Build and deployment → Source**，選 **GitHub Actions**。之後每次排程或手動執行，工作流程會自動抓資料並發布網站。

## 參考的開源專案

開工前比較過：[polyrabbit/hacker-news-digest](https://github.com/polyrabbit/hacker-news-digest)、[discus0434/nook](https://github.com/discus0434/nook)、[camilleroux/tech-digest](https://github.com/camilleroux/tech-digest)、[notbrighton/ai-daily-digest](https://github.com/notbrighton/ai-daily-digest)。前兩者依賴 LLM 與金鑰，這裡刻意不用，改採「分數＋時間衰減」的零相依做法，沿用 tech-digest 與 ai-daily-digest 的「分數過濾＋Actions＋Pages」思路。

內容版權屬於原網站，本站只彙整標題與連結。
