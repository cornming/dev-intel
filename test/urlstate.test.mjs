import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
// urlstate.js 是給瀏覽器用的腳本，用 vm 以同樣方式載入（掛在全域 self.UrlState）
const sandbox = { self: {}, URLSearchParams };
vm.runInNewContext(readFileSync(new URL('../assets/urlstate.js', import.meta.url), 'utf8'), sandbox);
const { parse, build } = sandbox.self.UrlState;
const TABS = ['brief', 'sec', 'all', 'tw', 'global', 'repo', 'job'];
const pick = (o) => JSON.stringify(o);

test('build：預設值不寫進網址', () => {
  assert.equal(build({ tab: 'all', tag: '', source: '', sort: 'hot', q: '' }), '');
  assert.equal(build({ tab: 'all', tag: '', source: '', sort: 'hot', q: '   ' }), '');
});

test('build：只寫出非預設的欄位，中文會被編碼', () => {
  const s = build({ tab: 'tw', tag: '資安', source: 'iThome', sort: 'new', q: '漏洞' });
  assert.equal(new URLSearchParams(s).get('tag'), '資安');
  assert.equal(new URLSearchParams(s).get('src'), 'iThome');
  assert.equal(new URLSearchParams(s).get('tab'), 'tw');
  assert.equal(new URLSearchParams(s).get('sort'), 'new');
  assert.equal(new URLSearchParams(s).get('q'), '漏洞');
  assert.ok(s.startsWith('?'));
  assert.equal(build({ tab: 'job', tag: '', source: '', sort: 'hot', q: '' }), '?tab=job');
});

test('parse ∘ build 可以還原（來回一致）', () => {
  const st = { tab: 'repo', tag: 'AI', source: 'GitHub 新星專案', sort: 'new', q: 'rust & go' };
  assert.equal(pick(parse(build(st), TABS)), pick(st));
  const def = { tab: 'all', tag: '', source: '', sort: 'hot', q: '' };
  assert.equal(pick(parse(build(def), TABS)), pick(def));
});

test('parse：不合法的頁籤、排序一律退回預設；不存在的頁籤（如沒有 AI 分析時的 brief）也退回', () => {
  assert.equal(parse('?tab=hacker&sort=random', TABS).tab, 'all');
  assert.equal(parse('?tab=hacker&sort=random', TABS).sort, 'hot');
  assert.equal(parse('?tab=brief', ['sec', 'all', 'tw']).tab, 'all');
  assert.equal(parse('?tab=brief', TABS).tab, 'brief');
});

test('parse：長度限制、控制字元與空白被處理；空網址與壞輸入不會丟例外', () => {
  const r = parse('?q=' + 'a'.repeat(500) + '&tag=' + 'b'.repeat(100) + '&src=' + 'c'.repeat(100), TABS);
  assert.equal(r.q.length, 100); assert.equal(r.tag.length, 30); assert.equal(r.source.length, 40);
  assert.equal(parse('?q=%00%01hi%1f', TABS).q, 'hi');
  assert.equal(parse('?q=%20%20abc%20', TABS).q, 'abc');
  assert.equal(pick(parse('', TABS)), pick({ tab: 'all', tag: '', source: '', sort: 'hot', q: '' }));
  assert.equal(pick(parse(undefined, TABS)), pick({ tab: 'all', tag: '', source: '', sort: 'hot', q: '' }));
  assert.doesNotThrow(() => parse('?%E0%A4%A', TABS));
});

test('parse：網址中的惡意內容只當作文字，不含任何會被執行的處理', () => {
  const r = parse('?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E&tag=%22%3E%3Cimg%20src%3Dx%3E', TABS);
  assert.equal(typeof r.q, 'string');           // 後續一律以 textContent／input.value 使用，不會被當成 HTML
  assert.equal(r.tab, 'all');
});
