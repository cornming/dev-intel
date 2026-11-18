// 從已部署的網站取回上一輪的 data/latest.json 作為本輪的起點，
// 這樣資料不必每 5 小時提交進 repo（避免 git 歷史膨脹）。
// 取不到或格式不對就略過，build 會用 repo 內的檔案（或空資料）重新開始。
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidSnapshot } from './lib.mjs';

const url = process.env.PREV_URL;
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../data/latest.json');

if (!url) { console.log('未設定 PREV_URL，略過。'); process.exit(0); }
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'dev-intel/1.0', 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!isValidSnapshot(json)) throw new Error('格式不符');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(json) + '\n');
  console.log(`已載入上一輪資料：${json.items.length} 則（${json.generatedAt}）`);
} catch (e) {
  console.warn(`無法取得上一輪資料（${e.message}），將以 repo 內現有檔案或空資料開始。`);
}
