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
| PTT Soft_Job | 職場討論 | Atom（排除回文與公告） |

## 運作方式

1. `scripts/sources.mjs`：各來源獨立抓取，任一來源失敗不影響其他來源。
2. `scripts/lib.mjs`：解析 RSS/Atom、網址正規化後去重、關鍵字主題標籤、排名。
3. 排名：每個來源內先依分數（沒有分數的依 feed 名次）算百分位，再乘上來源權重，並隨發布時間衰減。各站分數單位不同，所以不直接比較。
4. 上一輪有、這輪沒抓到的項目會保留最多 72 小時（標示「來源暫時無更新」），避免來源暫時故障時整區消失；所有來源都失敗時則不覆寫資料。
5. 前端 `index.html` + `assets/app.js` 讀取 `data/latest.json`，純靜態，標題一律用 `textContent` 渲染。

排名與主題規則都在 `scripts/lib.mjs`、來源清單與權重在 `scripts/sources.mjs`，要新增來源只要加一個 `rssSource({...})`。

## 本機執行

需要 Node.js 20 以上。

```bash
npm test          # 單元測試
npm run build     # 抓取並寫入 data/latest.json
python3 -m http.server 8000   # 打開 http://localhost:8000
```

## 部署（第一次要做一次）

到 repo 的 **Settings → Pages → Build and deployment → Source**，選 **GitHub Actions**。之後每次排程或手動執行，工作流程會自動抓資料、提交 `data/latest.json` 並發布網站。

## 參考的開源專案

開工前比較過：[polyrabbit/hacker-news-digest](https://github.com/polyrabbit/hacker-news-digest)、[discus0434/nook](https://github.com/discus0434/nook)、[camilleroux/tech-digest](https://github.com/camilleroux/tech-digest)、[notbrighton/ai-daily-digest](https://github.com/notbrighton/ai-daily-digest)。前兩者依賴 LLM 與金鑰，這裡刻意不用，改採「分數＋時間衰減」的零相依做法，沿用 tech-digest 與 ai-daily-digest 的「分數過濾＋Actions＋Pages」思路。

內容版權屬於原網站，本站只彙整標題與連結。
