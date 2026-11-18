import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, normalizeUrl, tagsFor, dedupe, mergeHistory, finalize, decodeEntities, diversify, nextStreaks, unhealthy, isValidSnapshot } from '../scripts/lib.mjs';

test('parseFeed 解析 RSS（含 CDATA 與實體）', () => {
  const xml = `<rss><channel><item><title><![CDATA[Rust &amp; Go]]></title><link>https://a.com/1</link><pubDate>Mon, 17 Nov 2026 08:00:00 GMT</pubDate></item></channel></rss>`;
  const [x] = parseFeed(xml);
  assert.equal(x.title, 'Rust & Go');
  assert.equal(x.link, 'https://a.com/1');
  assert.equal(x.time, '2026-11-17T08:00:00.000Z');
});

test('parseFeed 解析 Atom 並略過非 http 連結', () => {
  const xml = `<feed><entry><title>t1</title><link href="https://b.com/x"/><updated>2026-11-17T08:00:00+08:00</updated></entry><entry><title>bad</title><link href="javascript:alert(1)"/></entry></feed>`;
  const r = parseFeed(xml);
  assert.equal(r.length, 1);
  assert.equal(r[0].link, 'https://b.com/x');
});

test('normalizeUrl 移除追蹤參數、www、結尾斜線', () => {
  assert.equal(normalizeUrl('https://www.Example.com/a/?utm_source=x&id=2#top'), 'https://example.com/a?id=2');
});

test('tagsFor 不會把 maintain 當成 AI', () => {
  assert.deepEqual(tagsFor('How to maintain a garden'), []);
  assert.ok(tagsFor('OpenAI releases new LLM').includes('AI'));
  assert.ok(tagsFor('iThome 資安漏洞通報').includes('資安'));
});

test('decodeEntities 處理數字實體且不爆掉', () => {
  assert.equal(decodeEntities('&#65;&#x42;&bogus;&#99999999;'), 'AB&bogus;&#99999999;');
});

test('dedupe 合併相同網址並保留較高分數者', () => {
  const r = dedupe([
    { url: 'https://x.com/a?utm_source=1', source: 'Lobsters', score: 5 },
    { url: 'https://www.x.com/a', source: 'Hacker News', score: 50, discuss: 'hn' },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].source, 'Hacker News');
  assert.deepEqual(r[0].alsoOn, ['Lobsters']);
});

test('mergeHistory 保留近期舊項目並標記 stale，超過 ttl 則移除', () => {
  const now = Date.parse('2026-11-18T00:00:00Z');
  const prev = [
    { id: 'old', firstSeen: '2026-11-17T12:00:00Z' },
    { id: 'ancient', firstSeen: '2026-11-10T00:00:00Z' },
    { id: 'keep', firstSeen: '2026-11-17T00:00:00Z' },
  ];
  const out = mergeHistory(prev, [{ id: 'keep' }, { id: 'new' }], now);
  const by = Object.fromEntries(out.map((x) => [x.id, x]));
  assert.equal(by.old.stale, true);
  assert.equal(by.ancient, undefined);
  assert.equal(by.keep.firstSeen, '2026-11-17T00:00:00Z');
  assert.equal(by.new.firstSeen, '2026-11-18T00:00:00.000Z');
});

test('finalize：同來源分數高者排前；時間越久越低；stale 打折', () => {
  const now = Date.parse('2026-11-18T00:00:00Z');
  const mk = (id, score, time, extra = {}) => ({ id, source: 'S', score, time, order: 0, ...extra });
  const out = finalize([mk('a', 100, '2026-11-17T23:00:00Z'), mk('b', 10, '2026-11-17T23:00:00Z'), mk('c', 100, '2026-11-10T00:00:00Z'), mk('d', 100, '2026-11-17T23:00:00Z', { stale: true })], { S: 1 }, now);
  assert.equal(out[0].id, 'a');
  assert.ok(out.find((x) => x.id === 'd').hot < out.find((x) => x.id === 'a').hot);
  assert.ok(out.find((x) => x.id === 'c').hot < out.find((x) => x.id === 'a').hot);
});

test('沒有分數的來源，最新一則也不會超過有分數來源的最高分', () => {
  const now = Date.parse('2026-11-18T00:00:00Z');
  const t = '2026-11-17T23:59:00Z';
  const rss = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, source: 'RSS', score: 0, time: t, order: i }));
  const hn = Array.from({ length: 5 }, (_, i) => ({ id: `h${i}`, source: 'HN', score: 100 - i * 10, time: t, order: i }));
  const out = finalize([...rss, ...hn], { RSS: 1, HN: 1 }, now);
  assert.equal(out[0].source, 'HN');
});

test('diversify：同來源連續項目逐步降權，讓不同來源交錯', () => {
  const items = [
    { id: 'a1', source: 'A', hot: 1.0 }, { id: 'a2', source: 'A', hot: 0.99 }, { id: 'a3', source: 'A', hot: 0.98 },
    { id: 'b1', source: 'B', hot: 0.95 },
  ];
  const out = diversify(items);
  assert.equal(out[0].id, 'a1');
  assert.equal(out[1].id, 'b1'); // a2 降權成 0.92，低於 b1(0.95)
});

test('nextStreaks：失敗累加、成功歸零、新來源從 0 起算', () => {
  const prev = [{ name: 'A', failStreak: 2 }, { name: 'B', failStreak: 5 }];
  const out = nextStreaks(prev, [{ name: 'A', ok: false }, { name: 'B', ok: true }, { name: 'C', ok: false }]);
  assert.deepEqual(out.map((x) => x.failStreak), [3, 0, 1]);
});

test('unhealthy：只回報連續失敗達門檻的來源', () => {
  const r = unhealthy([{ name: 'A', failStreak: 2 }, { name: 'B', failStreak: 3 }, { name: 'C' }]);
  assert.deepEqual(r.map((x) => x.name), ['B']);
});

test('isValidSnapshot：接受正常快照，拒絕壞資料', () => {
  assert.equal(isValidSnapshot({ items: [{ id: 'a', url: 'https://x' }], sources: [] }), true);
  assert.equal(isValidSnapshot({ items: [] }), true);
  assert.equal(isValidSnapshot(null), false);
  assert.equal(isValidSnapshot({ items: 'x' }), false);
  assert.equal(isValidSnapshot({ items: [{ id: 1, url: 'u' }] }), false);
  assert.equal(isValidSnapshot({ items: [], sources: {} }), false);
});
