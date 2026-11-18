import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { escapeXml, pickItems, entryHtml, toAtom, toRss, buildFeeds, loadTabs, SITE_URL } from '../scripts/feeds.mjs';

const py = spawnSync('python3', ['-c', 'import xml.etree.ElementTree'], { encoding: 'utf8' });
const HAS_PY = py.status === 0;

// 用 Python 標準函式庫的嚴格 XML 解析器驗證「格式正確」，並印出供 JS 比對的欄位
function parseXml(xml) {
  const code = `
import sys, json, xml.etree.ElementTree as ET
r = ET.fromstring(sys.stdin.read().encode('utf-8'))
A = '{http://www.w3.org/2005/Atom}'
def t(e, p): x = e.find(p); return x.text if x is not None else None
if r.tag == A + 'feed':
    out = {'kind': 'atom', 'id': t(r, A+'id'), 'title': t(r, A+'title'), 'updated': t(r, A+'updated'),
           'entries': [{'id': t(e, A+'id'), 'title': t(e, A+'title'), 'summary': t(e, A+'summary'), 'updated': t(e, A+'updated'),
                        'href': e.find(A+'link').get('href'), 'author': t(e.find(A+'author'), A+'name') if e.find(A+'author') is not None else None} for e in r.findall(A+'entry')]}
else:
    c = r.find('channel'); out = {'kind': 'rss', 'title': t(c, 'title'), 'entries': [{'guid': t(i, 'guid'), 'title': t(i, 'title'), 'link': t(i, 'link'), 'description': t(i, 'description'), 'pubDate': t(i, 'pubDate')} for i in c.findall('item')]}
print(json.dumps(out, ensure_ascii=False))`;
  const r = spawnSync('python3', ['-c', code], { input: xml, encoding: 'utf8' });
  assert.equal(r.status, 0, `不是格式正確的 XML：${r.stderr}`);
  return JSON.parse(r.stdout);
}

const nasty = {
  id: 'abc123', source: 'Hacker News', stype: 'community', region: 'global', kind: 'news', hot: 0.9,
  title: 'Q&A: <script>alert("x")</script> \u0000 控制字元 \u0007 與 emoji 🚀 \'單引號\'',
  url: 'https://example.com/a?x=1&y=2"z', discuss: 'https://news.ycombinator.com/item?id=1', comments: 12, score: 345,
  tags: ['AI', 'C++ & Rust'], time: '2026-11-17T10:00:00.000Z', image: 'https://example.com/i.png?a=1&b=2',
};
const meta = { generatedAt: '2026-11-18T00:00:00.000Z', selfPath: 'feeds/all.atom.xml' };
const TAB = { key: 'all', label: '全部', test: () => true };

test('escapeXml：轉義特殊字元，移除 XML 不允許的控制字元與孤立代理字元，保留中文與 emoji', () => {
  assert.equal(escapeXml('a&b<c>d"e\'f'), 'a&amp;b&lt;c&gt;d&quot;e&apos;f');
  assert.equal(escapeXml('x\u0000y\u0007z\u001f'), 'xyz');
  assert.equal(escapeXml('a\ud800b'), 'ab');
  assert.equal(escapeXml('中文 🚀 \t\n'), '中文 🚀 \t\n');
  assert.equal(escapeXml(null), '');
});

test('pickItems：排除過期與非 http 連結、套用分類、依熱度排序並限制數量', () => {
  const mk = (id, o = {}) => ({ id, url: `https://x/${id}`, hot: 0.5, tags: [], region: 'tw', kind: 'news', ...o });
  const items = [mk('a', { hot: 0.2 }), mk('b', { hot: 0.9 }), mk('c', { stale: true, hot: 1 }), mk('d', { url: 'javascript:alert(1)', hot: 1 }), mk('e', { region: 'global', hot: 0.7 })];
  const tw = { key: 'tw', test: (x) => x.region === 'tw' };
  assert.deepEqual(pickItems(items, tw).map((x) => x.id), ['b', 'a']);
  assert.deepEqual(pickItems(items, TAB, 2).map((x) => x.id), ['b', 'e']);
});

test('entryHtml：所有動態內容都被轉義；只收 https 圖片與 http(s) 討論連結', () => {
  const h = entryHtml({ ...nasty, discuss: 'javascript:alert(1)', image: 'http://insecure/x.png' });
  assert.ok(!h.includes('<script>') && !h.includes('javascript:') && !h.includes('http://insecure'));
  const ok = entryHtml(nasty);
  assert.ok(ok.includes('https://example.com/i.png?a=1&amp;b=2'), '圖片網址的 & 要轉義');
  assert.ok(ok.includes('C++ &amp; Rust'));
});

test('Atom：格式正確的 XML，怪異標題解析回原樣、無注入，且包含必要欄位', { skip: !HAS_PY }, () => {
  const f = parseXml(toAtom([nasty], TAB, meta));
  assert.equal(f.kind, 'atom');
  assert.ok(f.id && f.title && f.updated);
  const e = f.entries[0];
  assert.equal(e.title, 'Q&A: <script>alert("x")</script>  控制字元  與 emoji 🚀 \'單引號\'');
  assert.equal(e.href, 'https://example.com/a?x=1&y=2"z');
  assert.equal(e.id, 'tag:cornming.github.io,2026:dev-intel:abc123');
  assert.equal(e.author, 'Hacker News');
  assert.equal(e.updated, nasty.time);
  assert.ok(e.summary.startsWith('<p>Hacker News（社群）'), '摘要是 HTML 片段（解析後還原為標籤）');
  assert.ok(!e.summary.includes('<script>'), '標題裡的 <script> 不會出現在摘要的標籤中');
});

test('RSS：格式正確，guid 非永久連結、pubDate 為 RFC 822，描述內容經過轉義', { skip: !HAS_PY }, () => {
  const f = parseXml(toRss([nasty], TAB, { ...meta, selfPath: 'feeds/all.rss.xml' }));
  assert.equal(f.kind, 'rss');
  const e = f.entries[0];
  assert.equal(e.pubDate, 'Mon, 17 Nov 2026 10:00:00 GMT'.replace('Mon', 'Tue'));
  assert.equal(e.guid, 'tag:cornming.github.io,2026:dev-intel:abc123');
  assert.ok(!e.description.includes('<script>'));
});

test('項目 id 穩定：相同項目重複產生，id 與時間不變（閱讀器不會把舊文章當新文章）', { skip: !HAS_PY }, () => {
  const a = parseXml(toAtom([nasty], TAB, meta)).entries[0];
  const b = parseXml(toAtom([{ ...nasty }], TAB, { ...meta, generatedAt: '2030-01-01T00:00:00.000Z' })).entries[0];
  assert.equal(a.id, b.id); assert.equal(a.updated, b.updated);
});

test('沒有時間的項目退回 firstSeen，再退回產生時間', { skip: !HAS_PY }, () => {
  const e1 = parseXml(toAtom([{ ...nasty, time: null, firstSeen: '2026-11-16T00:00:00.000Z' }], TAB, meta)).entries[0];
  const e2 = parseXml(toAtom([{ ...nasty, time: null, firstSeen: null }], TAB, meta)).entries[0];
  assert.equal(e1.updated, '2026-11-16T00:00:00.000Z'); assert.equal(e2.updated, meta.generatedAt);
});

test('分類規則與網站共用同一份 assets/tabs.js：職場分頁含 kind=job 與帶「職場」標籤的項目', async () => {
  const tabs = await loadTabs();
  assert.equal(JSON.stringify(tabs.map((t) => t.key)), JSON.stringify(['all', 'tw', 'global', 'repo', 'job']));  // vm 內的陣列原型不同，所以比對 JSON
  const by = Object.fromEntries(tabs.map((t) => [t.key, t.test]));
  assert.ok(by.job({ kind: 'job', tags: [], region: 'global' }));
  assert.ok(by.job({ kind: 'news', tags: ['職場'], region: 'tw' }));
  assert.ok(!by.global({ kind: 'news', tags: ['職場'], region: 'global' }), '帶職場標籤的國際文章歸職場，不歸國際');
  assert.ok(by.repo({ kind: 'repo', tags: [], region: 'global' }));
});

test('buildFeeds：5 個分類各有 Atom 與 RSS，另有根目錄 feed.xml；自我連結指向正確位置', async () => {
  const tabs = await loadTabs();
  const data = { generatedAt: meta.generatedAt, items: [{ ...nasty, tags: [] }] };
  const files = buildFeeds(data, tabs);
  assert.deepEqual(files.map((f) => f.path).sort(), ['feed.xml', ...tabs.flatMap((t) => [`feeds/${t.key}.atom.xml`, `feeds/${t.key}.rss.xml`])].sort());
  assert.ok(files.find((f) => f.path === 'feed.xml').xml.includes(`href="${SITE_URL}feed.xml"`));
  assert.ok(files.find((f) => f.path === 'feeds/tw.rss.xml').xml.includes(`href="${SITE_URL}feeds/tw.rss.xml"`));
});
