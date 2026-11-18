import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const load = (f, name) => { const sb = { self: {} }; vm.runInNewContext(readFileSync(new URL(`../assets/${f}`, import.meta.url), 'utf8'), sb); return sb.self[name]; };
// vm 內建立的物件／陣列原型不同，deepStrictEqual 會誤判：純資料函式的結果一律複製到本環境再比對
const plain = (x) => JSON.parse(JSON.stringify(x ?? null));
const wrap = (api, names) => Object.fromEntries(Object.entries(api).map(([k, v]) => [k, names.includes(k) ? (...a) => plain(v(...a)) : v]));
const D = wrap(load('dashdata.js', 'DevDashData'), ['rank', 'gap', 'completeDays', 'trend']);
const W = wrap(load('watchlist.js', 'DevWatch'), ['normalize', 'summarize', 'parseImport']);
const NOW = Date.parse('2026-11-18T12:00:00Z');
const it = (id, o = {}) => ({ id, title: `標題 ${id}`, region: 'global', tags: [], inds: [], ents: [], hot: 0.5, time: '2026-11-18T06:00:00Z', ...o });

test('rank：依產業聚合，區分台灣與國際、計算近 24 小時，代表文章依熱度排序', () => {
  const items = [it('a', { inds: ['ai'], region: 'tw', hot: 0.2 }), it('b', { inds: ['ai', 'sec'], hot: 0.9 }), it('c', { inds: ['sec'], time: '2026-11-10T00:00:00Z' }), it('d', { inds: [] })];
  const rows = D.rank(items, 'industry', NOW);
  assert.equal(rows.length, 2);
  const ai = rows.find((r) => r.key === 'ai'), sec = rows.find((r) => r.key === 'sec');
  assert.equal(ai.total, 2); assert.equal(ai.tw, 1); assert.equal(ai.gl, 1); assert.equal(ai.last24, 2);
  assert.equal(sec.total, 2); assert.equal(sec.last24, 1);                         // c 是 8 天前
  assert.deepEqual(ai.items.map((x) => x.id), ['b', 'a']);                          // 依熱度
});

test('rank：主題維度——沒有標籤的歸「其他」；公司維度只算有公司的', () => {
  const items = [it('a', { tags: ['AI'] }), it('b', { tags: [] }), it('c', { ents: ['nvidia'] })];
  assert.deepEqual(D.rank(items, 'topic', NOW).map((r) => r.key).sort(), ['AI', '其他']);
  assert.deepEqual(D.rank(items, 'entity', NOW).map((r) => r.key), ['nvidia']);
});

test('gap：以各自總量標準化後相減（百分點）；總量太小的不列入', () => {
  const rows = [{ key: 'semi', tw: 20, gl: 5, total: 25 }, { key: 'dev', tw: 5, gl: 60, total: 65 }, { key: 'tiny', tw: 1, gl: 1, total: 2 }];
  const g = D.gap(rows, 100, 200, 8);
  assert.deepEqual(g.map((r) => r.key), ['semi', 'dev']);                           // 依落差由大到小，tiny 被排除
  assert.ok(Math.abs(g[0].gap - (20 / 100 - 5 / 200) * 100) < 1e-9);               // 17.5
  assert.ok(g[1].gap < 0);                                                          // 國際占比更高
});

const hist = (days, startedAt = '2026-11-10T01:00:00Z') => ({ startedAt, days: Object.fromEntries(Object.entries(days).map(([k, v]) => [k, { n: v, tw: 0, gl: v, topics: { AI: v }, inds: { ai: v }, ents: { nvidia: v }, stype: {} }])) });

test('completeDays：排除上線第一天（存量）與今天（只過一部分）', () => {
  const h = hist({ '2026-11-10': 350, '2026-11-11': 100, '2026-11-12': 110, '2026-11-18': 40 });
  assert.deepEqual(D.completeDays(h, NOW), ['2026-11-11', '2026-11-12']);
});

test('trend：完整日不足 3 天時不給動能（避免用太少的資料下結論）', () => {
  const h = hist({ '2026-11-10': 350, '2026-11-11': 100, '2026-11-12': 110, '2026-11-18': 40 });
  const t = D.trend(h, 'industry', 'ai', NOW);
  assert.equal(t.days, 2); assert.equal(t.daily, null); assert.equal(t.weekly, null);
  assert.equal(t.series.length, 2);
});

test('trend：daily＝最近一天 vs 之前日均；weekly 需要 14 個完整日', () => {
  const days = { '2026-11-01': 999 };                                              // 第一天（存量，排除）
  for (let i = 2; i <= 16; i++) days[`2026-11-${String(i).padStart(2, '0')}`] = i <= 9 ? 10 : 20;   // 11/2–11/9 每天 10，11/10–11/16 每天 20
  const h = hist(days, '2026-11-01T01:00:00Z');
  const t = D.trend(h, 'industry', 'ai', Date.parse('2026-11-17T12:00:00Z'));       // 今天 11/17（排除）；完整日 11/2–11/16 共 15 天
  assert.equal(t.days, 15);
  assert.equal(t.daily.last, 20); assert.equal(t.daily.n, 6); assert.equal(t.daily.avg, 20);   // 前 6 天（11/10–11/15）都是 20
  assert.equal(t.daily.change, 0);
  // 最近 7 個完整日（11/10–11/16）每天 20＝140；前 7 天（11/3–11/9）每天 10＝70；成長 +100%
  assert.equal(t.weekly.cur, 140); assert.equal(t.weekly.before, 70); assert.equal(t.weekly.change, 100);
  assert.equal(t.series.length, 14);
});

test('trend：前期為 0 時不算百分比（避免除以零與誇大）', () => {
  const h = hist({ '2026-11-10': 5, '2026-11-11': 0, '2026-11-12': 0, '2026-11-13': 0, '2026-11-14': 7 });
  const t = D.trend(h, 'industry', 'ai', NOW);
  assert.equal(t.daily.change, null);
});

test('trend：空歷史或壞資料不會丟例外', () => {
  assert.deepEqual(D.completeDays(null, NOW), []);
  assert.equal(D.trend({ days: {} }, 'industry', 'ai', NOW).days, 0);
  assert.equal(D.trend({ startedAt: '2026-11-18T00:00:00Z', days: { '2026-11-18': { n: 1 } } }, 'industry', 'x', NOW).series.length, 0);
});

// ── 追蹤清單 ──
test('normalize：丟棄不合法型別、空值、過短關鍵字、重複（不分大小寫）；限制數量；清除控制字元', () => {
  const l = W.normalize([
    { type: 'industry', value: 'ai' }, { type: 'industry', value: 'AI' },        // 重複
    { type: 'hack', value: 'x' }, { type: 'topic', value: '' }, { type: 'keyword', value: 'a' },
    { type: 'keyword', value: '  黃仁勳\u0000  ', label: '黃仁勳' }, null, 'x', { type: 'entity', value: 'nvidia', label: '<b>Nvidia</b>' },
  ]);
  assert.equal(l.length, 3);
  assert.deepEqual(l.map((w) => w.type), ['industry', 'keyword', 'entity']);
  assert.equal(l[1].value, '黃仁勳');
  const many = W.normalize(Array.from({ length: 80 }, (_, i) => ({ type: 'keyword', value: `kw${i}` })));
  assert.equal(many.length, W.MAX_WATCH);
  assert.deepEqual(W.normalize('不是陣列'), []);
});

test('matches：產業、公司、主題（含「其他」）、關鍵字（不分大小寫）', () => {
  const x = it('a', { inds: ['ai'], ents: ['nvidia'], tags: ['AI'], title: 'Nvidia 營收創高' });
  assert.ok(W.matches(x, { type: 'industry', value: 'ai' })); assert.ok(!W.matches(x, { type: 'industry', value: 'sec' }));
  assert.ok(W.matches(x, { type: 'entity', value: 'nvidia' })); assert.ok(W.matches(x, { type: 'topic', value: 'AI' }));
  assert.ok(W.matches(x, { type: 'keyword', value: 'NVIDIA' })); assert.ok(!W.matches(x, { type: 'keyword', value: 'amd' }));
  assert.ok(W.matches(it('b', { tags: [] }), { type: 'topic', value: '其他' }));
  assert.ok(!W.matches(x, { type: 'unknown', value: 'x' }));
});

test('summarize：篇數、近 24 小時、台灣／國際、代表文章依熱度', () => {
  const items = [it('a', { inds: ['ai'], hot: 0.1, region: 'tw' }), it('b', { inds: ['ai'], hot: 0.9 }), it('c', { inds: ['ai'], time: '2026-11-01T00:00:00Z' }), it('d', { inds: ['sec'] })];
  const s = W.summarize(items, { type: 'industry', value: 'ai' }, NOW);
  assert.equal(s.total, 3); assert.equal(s.last24, 2); assert.equal(s.tw, 1); assert.equal(s.gl, 2);
  assert.deepEqual(s.items.map((x) => x.id), ['b', 'c', 'a']);   // 熱度 0.9、0.5（預設）、0.1
});

test('store：新增／移除／持久化；重複新增不會增加；儲存層可抽換；壞資料與儲存失敗不會壞掉', async () => {
  const mem = {}; const storage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
  const s1 = W.createStore(W.localAdapter(storage)); await s1.init();
  assert.equal(await s1.add({ type: 'industry', value: 'ai', label: 'AI 與機器學習' }), true);
  assert.equal(await s1.add({ type: 'industry', value: 'AI' }), false);
  assert.equal(await s1.add({ type: 'keyword', value: '台積電' }), true);
  const s2 = W.createStore(W.localAdapter(storage)); await s2.init();            // 模擬重新整理
  assert.equal(s2.all().length, 2); assert.ok(s2.has('industry', 'ai'));
  await s2.remove('industry', 'ai'); assert.equal(s2.all().length, 1);
  storage.getItem = () => '壞掉的 JSON {'; const s3 = W.createStore(W.localAdapter(storage)); await s3.init(); assert.equal(s3.all().length, 0);
  const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } };
  const s4 = W.createStore(W.localAdapter(full)); await s4.init(); await assert.doesNotReject(() => s4.add({ type: 'topic', value: 'AI' }));
  let saved = null; const remote = { kind: 'remote', load: async () => [{ type: 'topic', value: 'AI' }], save: async (l) => { saved = l; } };
  const s5 = W.createStore(remote); await s5.init(); assert.equal(s5.kind, 'remote'); await s5.add({ type: 'entity', value: 'nvidia' }); assert.equal(saved.length, 2);
});

test('匯入匯出：來回一致；格式不對回傳 null；匯入內容一樣經過驗證', async () => {
  const s = W.createStore(W.localAdapter({ getItem: () => null, setItem: () => {} })); await s.init();
  await s.add({ type: 'industry', value: 'semi', label: '半導體與硬體' }); await s.add({ type: 'keyword', value: 'rust' });
  const back = W.parseImport(s.export());
  assert.equal(back.length, 2); assert.equal(back[0].value, 'semi');
  assert.equal(W.parseImport('不是 JSON'), null); assert.equal(W.parseImport('{"watch":"x"}'), null);
  assert.equal(W.parseImport(JSON.stringify({ watch: [{ type: 'hack', value: 'x' }, { type: 'topic', value: 'AI' }] })).length, 1);
});
