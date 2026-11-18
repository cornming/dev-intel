// 給「排程任務」用：驗證 AI 寫的 raw.json，通過才產出可發布的 analysis.json。
// 用法：node scripts/ai-validate.mjs [資料夾，預設 /tmp/ai]
// 不信任 AI 的輸出：捏造的項目 ID／CVE、網址、標記都會被丟棄，數值會被夾在範圍內。
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateAnalysis } from './lib.mjs';

const dir = resolve(process.argv[2] || '/tmp/ai');
const latest = JSON.parse(await readFile(resolve(dir, 'latest.json'), 'utf8'));
const text = await readFile(resolve(dir, 'raw.json'), 'utf8').catch(() => { console.error('找不到 raw.json'); process.exit(1); });

// 容許 AI 把 JSON 包在 ```json 區塊裡
const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
let raw;
try { raw = JSON.parse((fenced ? fenced[1] : text).trim()); } catch (e) { console.error(`raw.json 不是合法 JSON：${e.message}`); process.exit(1); }

const ids = latest.items.map((x) => x.id);
const cves = (latest.kev?.latest ?? []).map((v) => v.cve);
const clean = validateAnalysis(raw, ids, cves);
if (!clean) { console.error('驗證失敗：內容為空或格式不符（至少需要 summary、actions 或 highlights 其中之一）'); process.exit(1); }

const n = (x) => (Array.isArray(x) ? x.length : 0);
for (const k of ['actions', 'highlights', 'divergences', 'glossary']) {
  const dropped = n(raw[k]) - clean[k].length;
  if (dropped > 0) console.warn(`注意：${k} 有 ${dropped} 筆因不合規則被丟棄（引用了不存在的 id／CVE、缺欄位、重複，或分歧不足兩個說法）`);
}
const out = { generatedAt: new Date().toISOString(), basedOn: latest.generatedAt, model: 'Claude 排程任務', failStreak: 0, ...clean };
await writeFile(resolve(dir, 'analysis.json'), JSON.stringify(out) + '\n');
console.log(`驗證通過：行動 ${clean.actions.length}、焦點 ${clean.highlights.length}、分歧 ${clean.divergences.length}、名詞 ${clean.glossary.length} → ${dir}/analysis.json`);
