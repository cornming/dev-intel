// 從已部署的網站取回上一輪的 data/latest.json 與 data/history.json 作為本輪的起點，
// 這樣資料不必每次更新都提交進 repo（避免 git 歷史膨脹）。
// 取不到或格式不對就略過，build 會用空資料重新開始；
// 但「暫時性失敗」（逾時、5xx）會先重試幾次，因為一旦以空資料開始，累積的歷史就會被新檔覆蓋掉。
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidSnapshot } from './lib.mjs';
import { isValidHistory } from './history.mjs';

// 檔案確實不存在（例如第一次部署）：不必重試，也不算異常
export class NotFoundError extends Error {}

// 重試：最多 tries 次，每次間隔 baseMs、2×baseMs…；NotFoundError 不重試。
export async function withRetry(fn, { tries = 3, baseMs = 2000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try { return await fn(i); } catch (e) {
      if (e instanceof NotFoundError) throw e;
      lastErr = e;
      if (i < tries) await sleep(baseMs * i);
    }
  }
  throw lastErr;
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'dev-intel/1.0', 'cache-control': 'no-cache' } });
  if (res.status === 404) throw new NotFoundError('HTTP 404');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), '../data');
  await mkdir(dataDir, { recursive: true });

  const url = process.env.PREV_URL;
  if (!url) console.log('未設定 PREV_URL，略過。');
  else {
    try {
      const json = await withRetry(() => fetchJson(url));
      if (!isValidSnapshot(json)) throw new Error('格式不符');
      await writeFile(resolve(dataDir, 'latest.json'), JSON.stringify(json) + '\n');
      console.log(`已載入上一輪資料：${json.items.length} 則（${json.generatedAt}）`);
    } catch (e) {
      const first = e instanceof NotFoundError;
      console.log(`${first ? '' : '::warning title=無法取得上一輪資料::'}無法取得上一輪資料（${e.message}），將以空資料開始。${first ? '（可能是第一次部署）' : '來源狀態與保留項目會重置。'}`);
    }
  }

  // 歷史累積檔：檔案不存在就從今天開始累積；其他原因失敗要大聲警告，因為這輪結束後新檔會覆蓋掉已部署的舊檔
  const hurl = process.env.PREV_HISTORY_URL;
  if (hurl) {
    try {
      const j = await withRetry(() => fetchJson(hurl));
      if (!isValidHistory(j)) throw new Error('格式不符');
      await writeFile(resolve(dataDir, 'history.json'), JSON.stringify(j) + '\n');
      console.log(`已載入歷史累積：${Object.keys(j.days).length} 天（${j.firstDay} 起）`);
    } catch (e) {
      if (e instanceof NotFoundError) console.log('網站上還沒有歷史累積檔，將從今天開始累積。');
      else console.log(`::warning title=無法取得歷史累積檔::${e.message}。本輪會從今天重新累積，已部署的歷史會被覆蓋，趨勢圖會回到「累積中」。`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
