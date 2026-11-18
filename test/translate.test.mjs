import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
// translate.js 是給瀏覽器用的腳本（掛在全域 self.DevTranslate），用 vm 以同樣方式載入來測試
const sandbox = { self: {} };
vm.runInNewContext(readFileSync(new URL('../assets/translate.js', import.meta.url), 'utf8'), sandbox);
const { needsTranslation, splitTitle } = sandbox.self.DevTranslate;

test('needsTranslation：英文要翻；中文、太短、無英文字母不翻', () => {
  assert.equal(needsTranslation('Quad9 withdrawal from France'), true);
  assert.equal(needsTranslation('輝達營收翻倍'), false);
  assert.equal(needsTranslation('Nvidia營收翻倍，黃仁勳首度表態'), false); // 混合句含中文就不翻
  assert.equal(needsTranslation('Go'), false);
  assert.equal(needsTranslation('12345 !!!'), false);
  assert.equal(needsTranslation('日本語のタイトル'), false);
  assert.equal(needsTranslation(''), false);
  assert.equal(needsTranslation(null), false);
});

test('splitTitle：GitHub 專案只翻說明，專案名稱保留', () => {
  // vm 內建立的物件原型不同，所以逐欄比對而不用 deepStrictEqual
  const pick = (r) => [r.head, r.text];
  assert.deepEqual(pick(splitTitle({ kind: 'repo', title: 'a/b — Fast JSON parser' })), ['a/b', 'Fast JSON parser']);
  assert.deepEqual(pick(splitTitle({ kind: 'repo', title: 'a/b' })), ['a/b', '']);
  assert.deepEqual(pick(splitTitle({ kind: 'news', title: 'Hello — world' })), ['', 'Hello — world']);
});
