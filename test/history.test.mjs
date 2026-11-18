import test from 'node:test';
import assert from 'node:assert/strict';
import { updateHistory, taipeiDay, isValidHistory, HISTORY_DAYS } from '../scripts/history.mjs';

const item = (id, firstSeen, o = {}) => ({ id, firstSeen, region: 'global', tags: ['AI'], inds: ['ai'], ents: [], stype: 'community', ...o });

test('taipeiDay：依台北時間（UTC+8）切日，UTC 16:00 起算隔天', () => {
  assert.equal(taipeiDay(Date.parse('2026-11-17T15:59:59Z')), '2026-11-17');
  assert.equal(taipeiDay(Date.parse('2026-11-17T16:00:00Z')), '2026-11-18');
  assert.equal(taipeiDay(Date.parse('2026-11-18T00:00:00Z')), '2026-11-18');
});

test('updateHistory：依「首次出現的台北日期」分組並統計主題、產業、公司、地區與來源類型', () => {
  const now = Date.parse('2026-11-18T10:00:00Z');
  const h = updateHistory(null, [
    item('a', '2026-11-17T15:00:00Z', { tags: ['AI', '資安'], inds: ['ai', 'sec'], ents: ['nvidia'] }),
    item('b', '2026-11-17T17:00:00Z', { region: 'tw', tags: [], inds: [] }),   // 台北已是 11/18
    item('c', '2026-11-18T01:00:00Z', { region: 'tw', stype: 'media' }),
  ], now);
  assert.deepEqual(Object.keys(h.days), ['2026-11-17', '2026-11-18']);
  assert.equal(h.days['2026-11-17'].n, 1);
  assert.deepEqual(h.days['2026-11-17'].topics, { AI: 1, 資安: 1 });
  assert.deepEqual(h.days['2026-11-17'].ents, { nvidia: 1 });
  const d = h.days['2026-11-18'];
  assert.equal(d.n, 2); assert.equal(d.tw, 2); assert.equal(d.gl, 0);
  assert.equal(d.topics['其他'], 1);                       // 沒有標籤的歸「其他」
  assert.equal(d.stype.media, 1);
  assert.equal(h.firstDay, '2026-11-17');
});

test('updateHistory：重複執行（Re-run、同一批項目再算一次）不會重複計數', () => {
  const now = Date.parse('2026-11-18T10:00:00Z');
  const items = [item('a', '2026-11-18T01:00:00Z'), item('b', '2026-11-18T02:00:00Z')];
  const h1 = updateHistory(null, items, now);
  const h2 = updateHistory(h1, items, now + 36e5);
  const h3 = updateHistory(h2, items, now + 72e5);
  assert.equal(h3.days['2026-11-18'].n, 2);
  assert.equal(h3.days['2026-11-18'].topics.AI, 2);
});

test('updateHistory：取最大值合併——項目過期離開後，當天的計數不會倒退；新項目則會增加', () => {
  const now = Date.parse('2026-11-18T10:00:00Z');
  const h1 = updateHistory(null, [item('a', '2026-11-18T01:00:00Z'), item('b', '2026-11-18T02:00:00Z'), item('c', '2026-11-18T03:00:00Z')], now);
  const h2 = updateHistory(h1, [item('c', '2026-11-18T03:00:00Z')], now + 6e6);   // a、b 已不在資料中
  assert.equal(h2.days['2026-11-18'].n, 3);
  const h3 = updateHistory(h2, [item('c', '2026-11-18T03:00:00Z'), item('d', '2026-11-18T05:00:00Z'), item('e', '2026-11-18T06:00:00Z'), item('f', '2026-11-18T07:00:00Z')], now + 12e6);
  assert.equal(h3.days['2026-11-18'].n, 4);
});

test('updateHistory：只保留最近 HISTORY_DAYS 天；壞掉的舊檔會被忽略並重新開始', () => {
  const days = {};
  for (let i = 0; i < HISTORY_DAYS + 10; i++) days[new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)] = { n: 1, tw: 0, gl: 1, topics: {}, inds: {}, ents: {}, stype: {} };
  const h = updateHistory({ days }, [], Date.parse('2026-11-18T00:00:00Z'));
  assert.equal(Object.keys(h.days).length, HISTORY_DAYS);
  assert.ok(!('2026-01-01' in h.days));
  assert.equal(isValidHistory({ days: { bad: { n: 1 } } }), false);
  assert.equal(isValidHistory(null), false);
  const fresh = updateHistory({ days: { bad: 1 } }, [item('a', '2026-11-18T01:00:00Z')], Date.parse('2026-11-18T10:00:00Z'));
  assert.deepEqual(Object.keys(fresh.days), ['2026-11-18']);
});

test('updateHistory：沒有 firstSeen 的項目略過；startedAt 沿用第一次累積的時間', () => {
  const t0 = Date.parse('2026-11-18T10:00:00Z');
  const h1 = updateHistory(null, [item('a', undefined), item('b', '壞掉')], t0);
  assert.deepEqual(h1.days, {});
  const h2 = updateHistory({ ...h1, startedAt: '2026-11-01T00:00:00.000Z' }, [], t0 + 1e6);
  assert.equal(h2.startedAt, '2026-11-01T00:00:00.000Z');
});
