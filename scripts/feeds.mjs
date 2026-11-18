// 產生 Atom 1.0 與 RSS 2.0 訂閱輸出：每個分類（全部／台灣／國際／開源新星／職場）各一組。
// 分類規則與網站頁籤共用同一份 assets/tabs.js，所以「訂閱的職場」＝「網頁上的職場」。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SITE_URL = (process.env.SITE_URL || 'https://cornming.github.io/dev-intel/').replace(/\/?$/, '/');
export const FEED_LIMIT = 50;
const STYPE = { official: '官方', media: '媒體', community: '社群', repo: '開源專案' };

// 載入網站用的頁籤定義（同一個檔案，掛在 self.DevTabs）
export async function loadTabs() {
  const sandbox = { self: {} };
  vm.runInNewContext(await readFile(resolve(ROOT, 'assets/tabs.js'), 'utf8'), sandbox);
  return sandbox.self.DevTabs.TABS;
}

// XML 1.0 不允許的字元（控制字元、孤立的代理字元等）一律移除，否則整份 feed 會解析失敗
const ILLEGAL = /[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu;
export const escapeXml = (s) => String(s ?? '').replace(ILLEGAL, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const escapeHtml = escapeXml; // 對 HTML 內文同樣適用

const isHttp = (u) => /^https?:\/\//i.test(u ?? '');
const stripEmoji = (label) => label.replace(/^[^\p{L}\p{N}]+/u, '').trim();

export function pickItems(items, tab, limit = FEED_LIMIT) {
  return items.filter((x) => !x.stale && isHttp(x.url) && tab.test(x)).sort((a, b) => b.hot - a.hot).slice(0, limit);
}

// 每則的內文（HTML）：來源與類型、標籤、分數與討論連結、封面圖
export function entryHtml(x) {
  const parts = [`<p>${escapeHtml(x.source)}${STYPE[x.stype] ? `（${STYPE[x.stype]}）` : ''}${x.tags?.length ? ' · ' + x.tags.map(escapeHtml).join('、') : ''}</p>`];
  const stats = [];
  if (x.kind === 'repo') stats.push(`⭐ ${Number(x.score || 0).toLocaleString('en-US')}`);
  else if (x.score) stats.push(`▲ ${x.score}`);
  if (x.discuss && x.comments && isHttp(x.discuss)) stats.push(`<a href="${escapeHtml(x.discuss)}">💬 ${x.comments} 則討論</a>`);
  if (stats.length) parts.push(`<p>${stats.join('　')}</p>`);
  if (x.image && /^https:\/\//i.test(x.image)) parts.push(`<p><img src="${escapeHtml(x.image)}" alt="" /></p>`);
  return parts.join('');
}

const entryUpdated = (x, fallback) => x.time ?? x.firstSeen ?? fallback;
const entryId = (x) => `tag:cornming.github.io,2026:dev-intel:${x.id}`;
const feedTitle = (tab) => `軟體人情報站｜${stripEmoji(tab.label)}`;
const FEED_DESC = '台灣與國際的軟體開發新聞、開源新星專案與職場討論，每 5 小時自動更新。';

export function toAtom(items, tab, { generatedAt, selfPath }) {
  const self = SITE_URL + selfPath;
  const entries = items.map((x) => {
    const upd = entryUpdated(x, generatedAt);
    return `  <entry>
    <id>${escapeXml(entryId(x))}</id>
    <title>${escapeXml(x.title)}</title>
    <link rel="alternate" type="text/html" href="${escapeXml(x.url)}"/>${x.discuss && isHttp(x.discuss) && x.discuss !== x.url ? `
    <link rel="related" type="text/html" title="討論" href="${escapeXml(x.discuss)}"/>` : ''}
    <published>${escapeXml(upd)}</published>
    <updated>${escapeXml(upd)}</updated>
    <author><name>${escapeXml(x.source)}</name></author>${(x.tags ?? []).map((t) => `
    <category term="${escapeXml(t)}"/>`).join('')}
    <summary type="html">${escapeXml(entryHtml(x))}</summary>
  </entry>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="zh-TW">
  <id>tag:cornming.github.io,2026:dev-intel:feed:${escapeXml(tab.key)}</id>
  <title>${escapeXml(feedTitle(tab))}</title>
  <subtitle>${escapeXml(FEED_DESC)}</subtitle>
  <link rel="alternate" type="text/html" href="${escapeXml(SITE_URL)}"/>
  <link rel="self" type="application/atom+xml" href="${escapeXml(self)}"/>
  <updated>${escapeXml(generatedAt)}</updated>
  <author><name>軟體人情報站</name><uri>${escapeXml(SITE_URL)}</uri></author>
  <generator>dev-intel</generator>
${entries}
</feed>
`;
}

export function toRss(items, tab, { generatedAt, selfPath }) {
  const self = SITE_URL + selfPath;
  const rfc822 = (iso) => new Date(iso).toUTCString();
  const rows = items.map((x) => `    <item>
      <title>${escapeXml(x.title)}</title>
      <link>${escapeXml(x.url)}</link>
      <guid isPermaLink="false">${escapeXml(entryId(x))}</guid>
      <pubDate>${escapeXml(rfc822(entryUpdated(x, generatedAt)))}</pubDate>
      <dc:creator>${escapeXml(x.source)}</dc:creator>${(x.tags ?? []).map((t) => `
      <category>${escapeXml(t)}</category>`).join('')}
      <description>${escapeXml(entryHtml(x))}</description>
    </item>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(feedTitle(tab))}</title>
    <link>${escapeXml(SITE_URL)}</link>
    <description>${escapeXml(FEED_DESC)}</description>
    <language>zh-TW</language>
    <lastBuildDate>${escapeXml(rfc822(generatedAt))}</lastBuildDate>
    <atom:link href="${escapeXml(self)}" rel="self" type="application/rss+xml"/>
    <generator>dev-intel</generator>
${rows}
  </channel>
</rss>
`;
}

// 回傳要寫出的檔案清單：{ path, xml }。feed.xml（根目錄）是「全部」的 Atom，方便訂閱與自動探索。
export function buildFeeds(data, tabs) {
  const files = [];
  const meta = (selfPath) => ({ generatedAt: data.generatedAt, selfPath });
  for (const tab of tabs) {
    const items = pickItems(data.items, tab);
    files.push({ path: `feeds/${tab.key}.atom.xml`, xml: toAtom(items, tab, meta(`feeds/${tab.key}.atom.xml`)), count: items.length });
    files.push({ path: `feeds/${tab.key}.rss.xml`, xml: toRss(items, tab, meta(`feeds/${tab.key}.rss.xml`)), count: items.length });
    if (tab.key === 'all') files.push({ path: 'feed.xml', xml: toAtom(items, tab, meta('feed.xml')), count: items.length });
  }
  return files;
}

export async function writeFeeds(data, root = ROOT) {
  const files = buildFeeds(data, await loadTabs());
  await mkdir(resolve(root, 'feeds'), { recursive: true });
  for (const f of files) await writeFile(resolve(root, f.path), f.xml);
  return files;
}
