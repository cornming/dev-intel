// 抓取所有來源 → 去重 → 與上一輪合併 → 排名 → 寫入 data/latest.json
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES } from './sources.mjs';
import { dedupe, mergeHistory, finalize } from './lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data/latest.json');
const now = Date.now();

const prev = await readFile(OUT, 'utf8').then(JSON.parse).catch(() => ({ items: [] }));

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

const okCount = results.filter((r) => r.ok).length;
if (okCount === 0) {
  console.error('所有來源都失敗，保留舊資料，不覆寫。');
  process.exit(1);
}

const weights = Object.fromEntries(SOURCES.map((s) => [s.name, s.weight]));
const fresh = dedupe(results.flatMap((r) => r.items));
const merged = mergeHistory(prev.items, fresh, now);
const items = finalize(merged, weights, now).map(({ order, ...rest }) => rest);

const out = {
  generatedAt: new Date(now).toISOString(),
  sources: results.map(({ name, ok, count, error }) => ({ name, ok, count, ...(error ? { error } : {}) })),
  items,
};
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(out) + '\n');
console.log(`完成：${okCount}/${results.length} 個來源成功，共 ${items.length} 則。`);
for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name} ${r.count}`);
