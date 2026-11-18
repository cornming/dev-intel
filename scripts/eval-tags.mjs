// 量測主題標籤規則的品質。用法：node scripts/eval-tags.mjs [-v]
//   -v 會列出漏標與違規的清單，方便調整規則。
// 兩份評估資料（test/fixtures/）：
//   tag-manual.json  人工標註：want＝應有、not＝不該有、empty＝不屬於技術主題（在調整規則之前標好，不為遷就規則而改）
//   tag-silver.json  銀標準：DEV／Lobsters 作者自己貼的標籤對應到本站主題（獨立於規則，但不完整，所以精確率只是下限）
import { readFileSync } from 'node:fs';
import { tagsFor } from './lib.mjs';

const load = (f) => JSON.parse(readFileSync(new URL(`../test/fixtures/${f}`, import.meta.url), 'utf8')).items;
const verbose = process.argv.includes('-v');
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '-');

// ── 人工標註 ──
let want = 0, hit = 0; const miss = [], viol = [];
for (const x of load('tag-manual.json')) {
  const p = new Set(tagsFor(x.title));
  for (const t of x.want ?? []) { want++; p.has(t) ? hit++ : miss.push(`${t} ← ${x.title.slice(0, 50)}`); }
  for (const t of x.not ?? []) if (p.has(t)) viol.push(`不該有 ${t} ← ${x.title.slice(0, 50)}`);
  if (x.empty && p.size) viol.push(`應為空卻有 [${[...p]}] ← ${x.title.slice(0, 50)}`);
}
console.log(`【人工標註】召回率 ${pct(hit, want)}（${hit}/${want}）｜違規 ${viol.length} 項`);
if (verbose) { miss.forEach((m) => console.log('  漏標', m)); viol.forEach((m) => console.log('  違規', m)); }

// ── 銀標準 ──
const per = {}; let tp = 0, fn = 0, fp = 0, none = 0;
const silver = load('tag-silver.json');
for (const x of silver) {
  const p = new Set(tagsFor(x.title)), truth = new Set(x.truth);
  if (!p.size) none++;
  for (const t of truth) { per[t] ??= { tp: 0, fn: 0, fp: 0 }; if (p.has(t)) { per[t].tp++; tp++; } else { per[t].fn++; fn++; } }
  for (const t of p) { per[t] ??= { tp: 0, fn: 0, fp: 0 }; if (!truth.has(t)) { per[t].fp++; fp++; } }
}
console.log(`【銀標準 ${silver.length} 則】召回率 ${pct(tp, tp + fn)}｜精確率下限 ${pct(tp, tp + fp)}｜完全沒標到 ${pct(none, silver.length)}`);
if (verbose) {
  console.log('  標籤    召回(找回/應有)   精確下限(對/預測)');
  for (const [t, v] of Object.entries(per).sort((a, b) => b[1].tp + b[1].fn - (a[1].tp + a[1].fn))) console.log(`  ${t.padEnd(5)} ${pct(v.tp, v.tp + v.fn).padStart(5)} (${v.tp}/${v.tp + v.fn})`.padEnd(30), `${pct(v.tp, v.tp + v.fp).padStart(5)} (${v.tp}/${v.tp + v.fp})`);
}
