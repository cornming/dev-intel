import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnalysis, buildAnalysisInput, sourceTypeOf } from '../scripts/lib.mjs';

const kev = { latest: [{ cve: 'CVE-2026-100001', vendor: 'V', product: 'P', name: 'N', added: '2026-11-17', due: '2026-12-08', ransomware: false }] };

test('validateAnalysis：全空回傳 null；buildAnalysisInput 排除過期項目並限制數量', () => {
  assert.equal(validateAnalysis({}, [], []), null);
  assert.equal(validateAnalysis(null, [], []), null);
  const many = Array.from({ length: 100 }, (_, i) => ({ id: `x${i}`, source: 'iThome', title: 't', stale: i === 0 }));
  const inp = buildAnalysisInput(many, kev, 70);
  assert.equal(inp.items.length, 70);
  assert.ok(!inp.items.some((x) => x.id === 'x0'));
  assert.equal(inp.items[0].type, 'media');
});

test('sourceTypeOf：已知來源對應類型，未知來源預設為媒體', () => {
  assert.equal(sourceTypeOf('不存在的來源'), 'media');
  assert.equal(sourceTypeOf('GitHub Blog'), 'official');
  assert.equal(sourceTypeOf('Hacker News'), 'community');
  assert.equal(sourceTypeOf('GitHub 新星專案'), 'repo');
});

test('validateAnalysis：移除網址與標記、丟棄不存在的 id／CVE、夾住數值', () => {
  const r = validateAnalysis({
    summary: '摘要 https://evil.example <b>x</b>',
    actions: [{ title: '升級', why: '原因', urgency: 'high', itemIds: ['a', 'NOPE'], cves: ['CVE-2026-100001', 'CVE-2099-1'] }],
    highlights: [{ itemId: 'a', summary: '好', importance: 99 }, { itemId: 'GHOST', summary: '捏造' }],
  }, ['a'], ['CVE-2026-100001']);
  assert.ok(!/https?:|<|>/.test(JSON.stringify(r)));
  assert.deepEqual(r.actions[0].itemIds, ['a']);
  assert.deepEqual(r.actions[0].cves, ['CVE-2026-100001']);
  assert.equal(r.highlights.length, 1);
  assert.equal(r.highlights[0].importance, 5);
});
