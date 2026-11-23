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
    ['Apple調整macOS App權限管理', ['系統']],   // 桌面 App 不是行動
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

test('mergeHistory：只有「來源本輪抓取失敗」的舊項目才標 down；來源正常但掉出榜單只是 stale', () => {
  const now = Date.parse('2026-11-18T00:00:00Z');
  const prev = [
    { id: 'a', source: 'iThome', firstSeen: '2026-11-17T12:00:00Z' },
    { id: 'b', source: 'Hacker News', firstSeen: '2026-11-17T12:00:00Z' },
    { id: 'c', source: 'iThome', firstSeen: '2026-11-17T12:00:00Z' },
  ];
  // iThome 抓取失敗；Hacker News 正常但 b 掉出榜單；c 仍在榜上
  const by = Object.fromEntries(mergeHistory(prev, [{ id: 'c', source: 'iThome' }], now, undefined, new Set(['iThome'])).map((x) => [x.id, x]));
  assert.equal(by.a.stale, true); assert.equal(by.a.down, true);
  assert.equal(by.b.stale, true); assert.equal(by.b.down, false);
  assert.equal(by.c.stale, false); assert.equal(by.c.down, false);
  // 沒傳 downSources（舊呼叫方式）時，一律不算故障；也接受陣列
  assert.equal(mergeHistory(prev, [], now).every((x) => x.down === false), true);
  assert.equal(mergeHistory(prev, [], now, undefined, ['Hacker News']).find((x) => x.id === 'b').down, true);
});

test('mergeHistory：上一輪是 down、這一輪來源恢復並重新抓到時，down 與 stale 都清掉', () => {
  const now = Date.parse('2026-11-18T00:00:00Z');
  const prev = [{ id: 'a', source: 'iThome', firstSeen: '2026-11-17T12:00:00Z', stale: true, down: true }];
  const out = mergeHistory(prev, [{ id: 'a', source: 'iThome' }], now);
  assert.equal(out[0].stale, false); assert.equal(out[0].down, false);
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

test('tagsFor：結尾是符號的詞（.NET、C#、C++）要能辨識——\\b 邊界做不到這點', () => {
  assert.ok(tagsFor('換一台電腦，快速建立 Nuxt 3 + .NET 8 開發環境').includes('語言'));
  assert.ok(tagsFor('C# 與 C++ 的差別').includes('語言'));
  assert.ok(tagsFor('Why F# still matters').includes('語言'));
  assert.ok(tagsFor('ASP.NET Core 入門').includes('語言'));
});

test('tagsFor：網路類別（台灣技術文章常見的 tcpdump／MTU／DNS／SMTP）', () => {
  for (const t of ['MTU 設 1500，tcpdump 為什麼會顯示 length 28960？', 'PTR nslookup 反解授權查詢命令', 'SMTP 是什麼？一封 Email 是怎麼寄出去的', 'Linux 有兩張網卡，回程走哪張？用 ip route get 查 IPv4 出口', 'How DNS resolvers work', 'HTTP/3 and QUIC explained']) assert.ok(tagsFor(t).includes('網路'), t);
});

test('tagsFor：已修掉的誤判不再出現', () => {
  const no = (title, tag) => assert.ok(!tagsFor(title).includes(tag), `「${title}」不該有 ${tag}，實際 [${tagsFor(title)}]`);
  no('Tesla 砸 30 億歐元擴建柏林超級工廠！Cybercab 2029 年投產', '資安');   // cyber\w* 曾把 Cybercab 當資安
  no('Ghost in the Shell: the movie', '開發工具');                          // shell 曾被當開發工具
  no('Hunting a memory leak in Rust', '資安');                                // memory leak 不是資安
  no('Taylor Swift announces a new tour', '語言');                            // swift 語言
  no('A neural network for image classification', '網路');                    // neural network 不是網路
  no('Social network effects in startups', '網路');
  no('Don\'t Be a Proxy Between Me and Your AI', '網路');                     // proxy 慣用語
  no('My app stopped working after the update', '行動');                      // app 不等於行動
  no('Anthropic offers new enterprise plans', '職場');                        // offers 不等於職場
  no('Apple Services Down', '行動');
  assert.ok(tagsFor('美國多家銀行App傳出服務異常').includes('行動'), '中文緊貼 App 仍視為行動');
});

import { readFileSync } from 'node:fs';
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')).items;

test('標籤品質（人工標註 75 則）：召回率 ≥ 95%，且不得出現「不該有」的標籤', () => {
  let want = 0, hit = 0; const bad = [];
  for (const x of fixture('tag-manual.json')) {
    const p = new Set(tagsFor(x.title));
    for (const t of x.want ?? []) { want++; if (p.has(t)) hit++; }
    for (const t of x.not ?? []) if (p.has(t)) bad.push(`${x.title} 不該有 ${t}`);
    if (x.empty && p.size) bad.push(`${x.title} 應為空卻有 [${[...p]}]`);
  }
  assert.deepEqual(bad, []);
  assert.ok(hit / want >= 0.95, `召回率 ${Math.round((hit / want) * 100)}%（${hit}/${want}）低於 95%`);
});

test('標籤品質（銀標準 207 則，來源作者自貼的標籤）：召回率不退步、精確率下限不退步', () => {
  let tp = 0, fn = 0, fp = 0;
  for (const x of fixture('tag-silver.json')) {
    const p = new Set(tagsFor(x.title)), truth = new Set(x.truth);
    for (const t of truth) p.has(t) ? tp++ : fn++;
    for (const t of p) if (!truth.has(t)) fp++;
  }
  const recall = tp / (tp + fn), precision = tp / (tp + fp);
  // 門檻設在目前水準略下方：銀標準不完整（作者不會把每個主題都貼上），所以精確率只是下限
  assert.ok(recall >= 0.36, `召回率 ${Math.round(recall * 100)}% 退步（基線 38%）`);
  assert.ok(precision >= 0.75, `精確率下限 ${Math.round(precision * 100)}% 退步（基線 77%）`);
});

test('mergeHistory：保留的舊項目用目前規則重算標籤，舊標籤當備援；職場來源以職場開頭，最多 3 個', () => {
  const now = Date.parse('2026-11-18T00:00:00Z');
  const prev = [
    { id: 'a', title: 'Nvidia Chair says board will not reinstate CEO', tags: [], firstSeen: '2026-11-17T12:00:00Z' },
    { id: 'b', title: '完全沒有關鍵字的標題', tags: ['AI'], firstSeen: '2026-11-17T12:00:00Z' },               // 舊標籤（可能來自來源自帶）要保留
    { id: 'c', title: 'Rust 與 Python 與 Linux 與 AWS 與 React', tags: [], kind: 'job', firstSeen: '2026-11-17T12:00:00Z' },
  ];
  const by = Object.fromEntries(mergeHistory(prev, [], now).map((x) => [x.id, x]));
  assert.deepEqual(by.a.tags, ['硬體']);
  assert.deepEqual(by.b.tags, ['AI']);
  assert.equal(by.c.tags[0], '職場');
  assert.equal(by.c.tags.length, 3);
  assert.ok(by.a.stale && by.b.stale);
});

test('tagsFor：中文「網路」只在真的是網路技術時才標網路', () => {
  const has = (t) => tagsFor(t).includes('網路');
  assert.ok(!has('果粉哀號！iCloud、App Store 全掛點，蘋果揪出元兇：不是網路攻擊'));
  assert.ok(!has('以神經網路預測股價走勢'));
  assert.ok(!has('社群網路的演算法爭議'));
  assert.ok(!has('網路購物詐騙再增'));
  assert.ok(has('公司內部網路連線異常，排查路由設定'));
  assert.ok(has('Tor匿名網路遭DDoS攻擊，官方緊急更新IPv6防禦機制'));
  assert.ok(tagsFor('駭客發動網路攻擊癱瘓政府網站').includes('資安'), '網路攻擊歸資安');
});
