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

// 上一輪的 AI 分析（沒有也沒關係）：AI 步驟失敗或尚未啟用時，網站仍保留最近一次的分析
const aurl = process.env.PREV_ANALYSIS_URL;
if (aurl) {
  try {
    const res = await fetch(aurl, { signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'dev-intel/1.0', 'cache-control': 'no-cache' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('格式不符');
    await writeFile(resolve(dirname(out), 'analysis.json'), JSON.stringify(j) + '\n');
    console.log(`已載入上一輪 AI 分析（${j.generatedAt ?? '無內容'}）`);
  } catch (e) {
    console.log(`沒有上一輪 AI 分析（${e.message}），略過。`);
  }
}
