import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
// freshness.js 是給瀏覽器用的腳本，用 vm 以同樣方式載入（掛在全域 self.DevFresh）
const sandbox = { self: {} };
vm.runInNewContext(readFileSync(new URL('../assets/freshness.js', import.meta.url), 'utf8'), sandbox);
const { isNew, markNew, sinceCount, visitBaseline } = sandbox.self.DevFresh;

const H = 36e5;
const NOW = Date.parse('2026-11-23T10:00:00Z');
const seen = (hoursAgo) => ({ firstSeen: new Date(NOW - hoursAgo * H).toISOString() });
const fakeStore = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };

test('isNew：6 小時內第一次收錄才算新；邊界、缺值、壞值與未來時間', () => {
  assert.equal(isNew(seen(0), NOW), true);
  assert.equal(isNew(seen(5.9), NOW), true);
  assert.equal(isNew(seen(6), NOW), false);
  assert.equal(isNew(seen(30), NOW), false);
  assert.equal(isNew({}, NOW), false);
  assert.equal(isNew({ firstSeen: 'not a date' }, NOW), false);
  assert.equal(isNew(null, NOW), false);
  assert.equal(isNew({ firstSeen: new Date(NOW + 3 * H).toISOString() }, NOW), false, '時間在未來是異常資料');
  assert.equal(isNew({ firstSeen: new Date(NOW + 30e3).toISOString() }, NOW), true, '一分鐘內的時鐘誤差可以容忍');
});

test('isNew：只看首次收錄時間，不看文章的發布時間', () => {
  assert.equal(isNew({ ...seen(1), time: '2020-01-01T00:00:00Z' }, NOW), true);
  assert.equal(isNew({ ...seen(40), time: new Date(NOW).toISOString() }, NOW), false);
});

test('markNew：回傳新項目的 id', () => {
  const items = [{ id: 'a', ...seen(1) }, { id: 'b', ...seen(2) }, { id: 'c', ...seen(20) }, { id: 'd', ...seen(48) }];
  assert.deepEqual([...markNew(items, NOW)].sort(), ['a', 'b']);
  assert.equal(markNew([], NOW).size, 0);
  assert.equal(markNew(undefined, NOW).size, 0);
});

test('markNew：幾乎全部都是新的（資料被重置）時不標，避免整頁都是「新」', () => {
  const reset = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, ...seen(0) }));
  assert.equal(markNew(reset, NOW).size, 0);
  // 79%：仍然標；80%：視為重置
  const mix = (n) => Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, ...seen(i < n ? 1 : 30) }));
  assert.equal(markNew(mix(79), NOW).size, 79);
  assert.equal(markNew(mix(80), NOW).size, 0);
  // 項目太少時比例沒有意義：全部都新也照標
  const few = Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, ...seen(0) }));
  assert.equal(markNew(few, NOW).size, 5);
});

test('sinceCount：只算「在基準時間之後」第一次收錄的項目', () => {
  const items = [seen(1), seen(3), seen(10), {}, { firstSeen: 'bad' }];
  assert.equal(sinceCount(items, NOW - 4 * H), 2);
  assert.equal(sinceCount(items, NOW - 1 * H), 0, '剛好等於基準時間不算（那是上次造訪當下就看得到的）');
  assert.equal(sinceCount(items, NOW - 100 * H), 3);
  assert.equal(sinceCount(items, null), 0);
  assert.equal(sinceCount(items, NaN), 0);
  assert.equal(sinceCount(undefined, NOW), 0);
});

test('visitBaseline：第一次造訪沒有基準，並記下這次', () => {
  const local = fakeStore(), session = fakeStore();
  assert.equal(visitBaseline(local, session, NOW), null);
  assert.equal(local.m.get('devintel.lastVisit'), String(NOW));
  assert.equal(session.m.get('devintel.baseline'), 'none');
});

test('visitBaseline：再次造訪時，基準是上一次造訪的時間', () => {
  const prevVisit = NOW - 8 * H;
  const local = fakeStore({ 'devintel.lastVisit': String(prevVisit) }), session = fakeStore();
  assert.equal(visitBaseline(local, session, NOW), prevVisit);
  assert.equal(local.m.get('devintel.lastVisit'), String(NOW), '更新成這次');
});

test('visitBaseline：同一個工作階段內重新整理，基準維持不變（不會變成剛剛）', () => {
  const prevVisit = NOW - 8 * H;
  const local = fakeStore({ 'devintel.lastVisit': String(prevVisit) }), session = fakeStore();
  assert.equal(visitBaseline(local, session, NOW), prevVisit);
  assert.equal(visitBaseline(local, session, NOW + 10 * 60e3), prevVisit, '10 分鐘後重新整理');
  assert.equal(local.m.get('devintel.lastVisit'), String(NOW + 10 * 60e3), '但下次造訪的基準會是最近一次');
});

test('visitBaseline：第一次造訪後在同一個工作階段重新整理，仍然是「沒有上次造訪」', () => {
  const local = fakeStore(), session = fakeStore();
  assert.equal(visitBaseline(local, session, NOW), null);
  assert.equal(visitBaseline(local, session, NOW + 60e3), null);
});

test('visitBaseline：壞值（NaN、0、未來時間）一律當作沒有上次造訪', () => {
  for (const bad of ['abc', '0', '', String(NOW + 5 * H), '-5']) {
    assert.equal(visitBaseline(fakeStore({ 'devintel.lastVisit': bad }), fakeStore(), NOW), null, `lastVisit=${JSON.stringify(bad)}`);
  }
  assert.equal(visitBaseline(fakeStore(), fakeStore({ 'devintel.baseline': 'garbage' }), NOW), null);
});

test('visitBaseline：儲存空間不能用（無痕模式、被封鎖、不存在）時不丟例外，只是沒有基準', () => {
  assert.equal(visitBaseline(broken, broken, NOW), null);
  assert.equal(visitBaseline(null, null, NOW), null);
  assert.equal(visitBaseline(undefined, undefined, NOW), null);
  // 只有 session 壞掉：仍可讀到 local 的上次造訪
  assert.equal(visitBaseline(fakeStore({ 'devintel.lastVisit': String(NOW - 2 * H) }), broken, NOW), NOW - 2 * H);
});
