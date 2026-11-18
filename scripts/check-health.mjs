// 讀取 data/latest.json，若有來源連續失敗達門檻就以非 0 結束，讓 Actions 轉紅、GitHub 寄通知信。
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unhealthy, FAIL_THRESHOLD } from './lib.mjs';

const file = resolve(dirname(fileURLToPath(import.meta.url)), '../data/latest.json');
const { sources = [] } = JSON.parse(await readFile(file, 'utf8'));
const bad = unhealthy(sources);
// AI 分析（若有啟用）：連續失敗達門檻同樣視為異常，例如訂閱額度用完、token 過期
const ai = await readFile(resolve(dirname(file), 'analysis.json'), 'utf8').then(JSON.parse).catch(() => null);
if (ai && (ai.failStreak ?? 0) >= FAIL_THRESHOLD) bad.push({ name: 'AI 分析', failStreak: ai.failStreak, error: ai.lastError });
if (bad.length === 0) {
  console.log('所有來源狀態正常。');
} else {
  for (const s of bad) console.log(`::error title=來源異常::${s.name} 已連續 ${s.failStreak} 輪抓取失敗（${s.error ?? '原因不明'}）`);
  console.error(`有 ${bad.length} 個來源連續失敗 ${FAIL_THRESHOLD} 輪以上，請檢查來源是否改版或下線。網站內容仍已正常更新。`);
  process.exit(1);
}
