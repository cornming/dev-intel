import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, normalizeUrl, tagsFor, dedupe, mergeHistory, finalize, decodeEntities, diversify, nextStreaks, unhealthy, isValidSnapshot, cleanImageUrl, feedImage, extractOgImage, stripQuery, dropSharedImages } from '../scripts/lib.mjs';

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

test('cleanImageUrl：只收 https，排除追蹤像素與 gif，並能解析相對網址', () => {
  assert.equal(cleanImageUrl('https://a.com/x.jpg'), 'https://a.com/x.jpg');
  assert.equal(cleanImageUrl('/img/x.png', 'https://a.com/post/1'), 'https://a.com/img/x.png');
  assert.equal(cleanImageUrl('http://a.com/x.jpg'), null);
  assert.equal(cleanImageUrl('javascript:alert(1)'), null);
  assert.equal(cleanImageUrl('data:image/png;base64,AAAA'), null);
  assert.equal(cleanImageUrl('https://a.com/spinner.gif'), null);
  assert.equal(cleanImageUrl('https://feeds.feedburner.com/~r/x/1.gif'), null);
  assert.equal(cleanImageUrl(null), null);
});

test('feedImage：依序找 media:content、enclosure、內文 <img>（含實體編碼與 CDATA）', () => {
  assert.equal(feedImage('<item><media:content url="https://a.com/m.jpg" medium="image"/></item>'), 'https://a.com/m.jpg');
  assert.equal(feedImage('<item><enclosure url="https://a.com/e.jpg" type="image/jpeg" length="1"/></item>'), 'https://a.com/e.jpg');
  assert.equal(feedImage('<item><enclosure type="image/png" url="https://a.com/e2.png"/></item>'), 'https://a.com/e2.png');
  assert.equal(feedImage('<item><description><![CDATA[<p><img src="https://a.com/i.webp" width="9"></p>]]></description></item>'), 'https://a.com/i.webp');
  assert.equal(feedImage('<item><description>&lt;img src=&quot;https://a.com/enc.jpg&quot;&gt;</description></item>'), 'https://a.com/enc.jpg');
  assert.equal(feedImage('<item><description>純文字</description></item>'), null);
});

test('extractOgImage：兩種屬性順序都能解析，缺 og 時退回 twitter:image', () => {
  assert.equal(extractOgImage('<head><meta property="og:image" content="https://a.com/1.jpg"></head>'), 'https://a.com/1.jpg');
  assert.equal(extractOgImage('<head><meta content="https://a.com/2.jpg" property="og:image" /></head>'), 'https://a.com/2.jpg');
  assert.equal(extractOgImage('<head><meta name="twitter:image" content="/t.jpg"></head>', 'https://a.com/p'), 'https://a.com/t.jpg');
  assert.equal(extractOgImage('<head><meta property="og:image" content="http://a.com/insecure.jpg"></head>'), null);
  assert.equal(extractOgImage('<head><title>x</title></head>'), null);
});

test('mergeHistory：沿用上一輪已抓到的封面圖與「已查過」狀態', () => {
  const now = Date.parse('2026-11-18T00:00:00Z');
  const prev = [{ id: 'a', firstSeen: '2026-11-17T00:00:00Z', image: 'https://a.com/1.jpg', imgChecked: true }, { id: 'b', firstSeen: '2026-11-17T00:00:00Z', image: null, imgChecked: true }];
  const out = mergeHistory(prev, [{ id: 'a', image: null }, { id: 'b', image: null }, { id: 'c', image: null }], now);
  const by = Object.fromEntries(out.map((x) => [x.id, x]));
  assert.equal(by.a.image, 'https://a.com/1.jpg');
  assert.equal(by.b.imgChecked, true);
  assert.equal(by.c.imgChecked, false);
});

import { pickKev, pickCycles } from '../scripts/security.mjs';

test('pickKev：依新增日期取最近 N 筆並只保留需要的欄位', () => {
  const k = pickKev({ catalogVersion: 'v1', count: 3, vulnerabilities: [
    { cveID: 'CVE-1', dateAdded: '2026-11-01', knownRansomwareCampaignUse: 'Unknown', requiredAction: 'a' },
    { cveID: 'CVE-2', dateAdded: '2026-11-17', knownRansomwareCampaignUse: 'Known', requiredAction: 'b' },
    { cveID: 'CVE-3', dateAdded: '2026-11-10', knownRansomwareCampaignUse: 'Unknown', requiredAction: 'c' },
  ] }, 2);
  assert.deepEqual(k.latest.map((x) => x.cve), ['CVE-2', 'CVE-3']);
  assert.equal(k.latest[0].ransomware, true);
  assert.equal(k.count, 3);
  assert.equal(k.version, 'v1');
});

test('pickCycles：只留支援期內版本、計算剩餘天數並標示 90 天內到期', () => {
  const now = Date.parse('2026-11-18T00:00:00Z');
  const r = pickCycles([
    { cycle: '3', eol: '2026-12-31', latest: '3.1' },   // 43 天 → soon
    { cycle: '2', eol: '2025-01-01', latest: '2.9' },   // 已過期 → 排除
    { cycle: '4', eol: false, latest: '4.0' },          // 無結束日
    { cycle: '5', eol: '2029-01-01', latest: '5.0' },
  ], now);
  assert.deepEqual(r.map((x) => x.cycle), ['3', '4', '5']);
  assert.equal(r[0].soon, true);
  assert.equal(r[0].daysLeft, 43);
  assert.equal(r[1].daysLeft, null);
  assert.equal(r[1].soon, false);
});

import { RELEVANT } from '../scripts/sources.mjs';

test('stripQuery：去掉追蹤參數與錨點，但保留路徑', () => {
  assert.equal(stripQuery('https://ithelp.ithome.com.tw/articles/10425471?sc=rss.qu'), 'https://ithelp.ithome.com.tw/articles/10425471');
  assert.equal(stripQuery('https://medium.com/@a/post-abc123?source=rss-----tag#x'), 'https://medium.com/@a/post-abc123');
  assert.equal(stripQuery('不是網址'), '不是網址');
});

test('RELEVANT：職涯文章只留與軟體／科技相關的', () => {
  for (const t of ['轉職軟體工程師之前或許你該知道的產業地圖', 'AI 時代該轉職嗎？', '面試時被問到系統設計怎麼辦', '新創 vs. 大公司：哪一個才適合你？']) assert.ok(RELEVANT.test(t), t);
  for (const t of ['別怕「我不會」: 從 UNIQLO 店長的故事看見共好的力量', '達成目標後為什麼反而覺得空虛？', '人生藍圖怎麼規劃？']) assert.ok(!RELEVANT.test(t), t);
});

test('cleanImageUrl：Medium 圖片縮成 600px，其他網站的圖不動', () => {
  assert.equal(cleanImageUrl('https://cdn-images-1.medium.com/max/2600/1*abc.png'), 'https://cdn-images-1.medium.com/max/600/1*abc.png');
  assert.equal(cleanImageUrl('https://cdn-images-1.medium.com/max/1448/0*xyz'), 'https://cdn-images-1.medium.com/max/600/0*xyz');
  assert.equal(cleanImageUrl('https://example.com/max/2600/a.png'), 'https://example.com/max/2600/a.png');
});

test('dropSharedImages：同來源 3 則以上共用同一張圖視為預設圖並清掉，不同來源或不足 3 則不動', () => {
  const mk = (id, source, image) => ({ id, source, image, imgChecked: false });
  const items = [
    mk(1, 'A', 'https://x/default.jpg'), mk(2, 'A', 'https://x/default.jpg'), mk(3, 'A', 'https://x/default.jpg'), mk(4, 'A', 'https://x/own.jpg'),
    mk(5, 'B', 'https://x/default.jpg'),                                   // 不同來源，只有 1 則
    mk(6, 'C', 'https://x/two.jpg'), mk(7, 'C', 'https://x/two.jpg'),     // 只有 2 則
    mk(8, 'D', null),
  ];
  assert.equal(dropSharedImages(items), 3);
  assert.deepEqual(items.map((x) => x.image), [null, null, null, 'https://x/own.jpg', 'https://x/default.jpg', 'https://x/two.jpg', 'https://x/two.jpg', null]);
  assert.ok(items.slice(0, 3).every((x) => x.imgChecked), '已判定為預設圖的不要再重抓');
  assert.equal(dropSharedImages(items), 0, '重複執行不會再變動');
});
