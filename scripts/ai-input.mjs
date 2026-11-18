// 給「排程任務」用：取得最新資料並整理成要分析的輸入。
// 用法：node scripts/ai-input.mjs [輸出資料夾，預設 /tmp/ai]
//   產出 input.json（給 AI 讀：只有標題與統計）與 latest.json（完整資料，驗證時用）
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildAnalysisInput, isValidSnapshot } from './lib.mjs';

const outDir = resolve(process.argv[2] || '/tmp/ai');
const url = process.env.LATEST_URL || 'https://cornming.github.io/dev-intel/data/latest.json';

const res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'cache-control': 'no-cache', 'user-agent': 'dev-intel-ai/1.0' } });
if (!res.ok) { console.error(`取得最新資料失敗：HTTP ${res.status}`); process.exit(1); }
const latest = await res.json();
if (!isValidSnapshot(latest) || !latest.items.length) { console.error('最新資料格式不符或沒有項目'); process.exit(1); }

const input = { generatedAt: latest.generatedAt, industryIds: (latest.taxonomy?.industries ?? []).map((i) => `${i.id}（${i.name}）`), ...buildAnalysisInput(latest.items, latest.kev) };
await mkdir(outDir, { recursive: true });
await writeFile(resolve(outDir, 'latest.json'), JSON.stringify(latest));
await writeFile(resolve(outDir, 'input.json'), JSON.stringify(input, null, 1));
console.log(`輸入已準備好：${input.items.length} 則項目、${input.kev.length} 筆 KEV（資料時間 ${latest.generatedAt}）→ ${outDir}/input.json`);
