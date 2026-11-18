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

test('tagsFor：預期命中的標籤（標題 → 必含標籤）', () => {
  const cases = [
    ['Java4Shell: RCE in OpenJDK when processing Base64', ['資安', '語言']],
    ['jQuery 4.1.0', ['前端']],
    ['Nimony: The next version of Nim', ['語言']],
    ['My Emacs 31 contributions', ['開發工具']],
    ['Redict is deprecated', ['後端']],
    ['OpenAI releases new LLM', ['AI']],
    ['Nvidia stopped disclosing Singapore sales as revenues hit $104B', ['硬體', '產業']],
    ['輝達第三季營收年增達 103%，獲利年增翻倍', ['硬體', '產業']],
    ['iThome 資安漏洞通報', ['資安']],
    ['Tor匿名網路遭DDoS攻擊，官方緊急更新IPv6防禦機制', ['資安']],
    ['Redshift支援Iceberg資料表多陳述式交易', ['雲端', '後端']],
    ['美國多家銀行App傳出服務異常，內部系統軟體臭蟲造成交易延遲', ['行動', '開發工具']],
    ['我的面試心得與薪資談判', ['職場']],
    ['Software engineer layoffs and the job market in 2026', ['職場']],
    ['Apple調整macOS App權限管理', ['系統', '行動']],
    ['Qwen4-Max 任務成本降約六成', ['AI']],
    ['You won\'t win at copyright', ['政策']],
  ];
  for (const [title, expect] of cases) {
    const got = tagsFor(title);
    for (const tag of expect) assert.ok(got.includes(tag), `「${title}」應含 ${tag}，實際 [${got}]`);
  }
});

test('tagsFor：避免常見誤判', () => {
  const none = [
    'How to maintain a garden',          // maintain 不是 AI
    'Steve Jobs Core Animation demo',     // Jobs 不是職場
    'Schedule a cron job nightly',        // cron job 不是職場
    '提升叢集工作負載的穩定度',            // 工作負載不是職場
    'Let\'s go to the beach',             // go 不是 Go 語言
    '驊陞部分資訊系統遭攻擊，核心系統未受影響', // 核心系統不是 kernel
  ];
  for (const title of none) {
    const got = tagsFor(title);
    assert.ok(!got.includes('AI') && !got.includes('職場') && !got.includes('語言'), `「${title}」不該被誤判，實際 [${got}]`);
  }
  assert.ok(!tagsFor('Apple earnings beat estimates').includes('行動'), 'Apple 不是 App');
  assert.ok(!tagsFor('核心系統未受影響').includes('系統'), '核心系統不是系統標籤');
  assert.ok(tagsFor('a'.repeat(5) + ' AI LLM aws react python android linux git nvidia').length <= 3, '最多 3 個標籤');
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
