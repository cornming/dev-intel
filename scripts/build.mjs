// 抓取所有來源 → 去重 → 與上一輪合併 → 排名 → 寫入 data/latest.json
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES } from './sources.mjs';
import { dedupe, mergeHistory, finalize, nextStreaks, sourceTypeOf, dropSharedImages } from './lib.mjs';
import { enrichImages } from './images.mjs';
import { fetchKev, fetchLifecycle } from './security.mjs';
import { writeFeeds } from './feeds.mjs';
import { updateHistory } from './history.mjs';
import { loadTaxonomy, classify, publicTaxonomy } from './taxonomy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data/latest.json');
const now = Date.now();

const prev = await readFile(OUT, 'utf8').then(JSON.parse).catch(() => ({ items: [], sources: [] }));

const results = await Promise.all(SOURCES.map(async (s) => {
  try {
    const items = await s.fetch();
    if (!items.length) throw new Error('沒有取得任何項目');
    return { name: s.name, ok: true, count: items.length, items };
  } catch (e) {
    console.warn(`✗ ${s.name}: ${e.message}`);
    return { name: s.name, ok: false, count: 0, error: String(e.message), items: [] };
  }
}));

// 官方資料面板：失敗時沿用上一輪，並計入來源健康（連續失敗同樣會通知）
const extra = await Promise.all([
  ['CISA KEV', 'kev', fetchKev, (d) => d.latest.length],
  ['endoflife.date', 'lifecycle', fetchLifecycle, (d) => d.length],
].map(async ([name, key, fn, count]) => {
  try { const data = await fn(); return { name, key, ok: true, count: count(data), data }; }
  catch (e) { console.warn(`✗ ${name}: ${e.message}`); return { name, key, ok: false, count: 0, error: String(e.message), data: prev[key] ?? null }; }
}));

const okCount = results.filter((r) => r.ok).length;
if (okCount === 0) {
  console.error('所有來源都失敗，保留舊資料，不覆寫。');
  process.exit(1);
}

const weights = Object.fromEntries(SOURCES.map((s) => [s.name, s.weight]));
const fresh = dedupe(results.flatMap((r) => r.items));
// 已從來源清單移除的來源，其舊項目不再保留
const known = new Set(SOURCES.map((s) => s.name));
const merged = mergeHistory(prev.items.filter((x) => known.has(x.source)), fresh, now);
const ranked = finalize(merged, weights, now);
// 排名高的優先補封面圖；每篇只抓一次，結果存進資料沿用
const imgStats = await enrichImages(ranked);
const sharedDropped = dropSharedImages(ranked);
if (sharedDropped) console.log(`略過 ${sharedDropped} 張疑似網站預設圖（同來源多則共用）`);
console.log(`封面圖：本輪查 ${imgStats.done}/${imgStats.queued} 篇，找到 ${imgStats.found} 張（${imgStats.ms} ms）`);
const tax = await loadTaxonomy();
// 每則加上「公司」與「產業」（只看標題；字典在 config/taxonomy.json，可自行增減）
const items = ranked.map(({ order, ...rest }) => ({ ...rest, stype: sourceTypeOf(rest.source), ...classify(rest, tax) }));

const out = {
  generatedAt: new Date(now).toISOString(),
  taxonomy: publicTaxonomy(tax),
  kev: extra[0].data,
  kevFetchedAt: extra[0].ok ? new Date(now).toISOString() : prev.kevFetchedAt ?? null,
  lifecycle: extra[1].data,
  lifecycleFetchedAt: extra[1].ok ? new Date(now).toISOString() : prev.lifecycleFetchedAt ?? null,
  sources: nextStreaks(prev.sources, [...results, ...extra]).map(({ name, ok, count, error, failStreak }) => ({ name, ok, count, failStreak, ...(error ? { error } : {}) })),
  items,
};
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(out) + '\n');
// 歷史累積：上一輪的檔案由 fetch-prev 取回；沒有就從今天開始
const HIST = resolve(ROOT, 'data/history.json');
const prevHist = await readFile(HIST, 'utf8').then(JSON.parse).catch(() => null);
const hist = updateHistory(prevHist, items, now);
await writeFile(HIST, JSON.stringify(hist) + '\n');
console.log(`歷史累積：${Object.keys(hist.days).length} 天（${hist.firstDay} 起），今天 ${hist.days[Object.keys(hist.days).at(-1)]?.n ?? 0} 則`);
const feedFiles = await writeFeeds(out);
console.log(`訂閱輸出：${feedFiles.length} 個檔案（${[...new Set(feedFiles.map((f) => f.path.split('/').pop().split('.')[0]))].join('、')}）`);
console.log(`完成：${okCount}/${results.length} 個來源成功，共 ${items.length} 則。`);
for (const r of [...results, ...extra]) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name} ${r.count}`);
