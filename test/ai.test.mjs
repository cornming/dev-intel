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

test('validateAnalysis：事件（events）——引用的 id 必須存在、每個項目只屬於一個事件、少於 2 個有效項目的事件丟棄、依規模排序', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const r = validateAnalysis({
    summary: 'x',
    events: [
      { name: '事件甲', summary: '兩件', itemIds: ['a', 'b'], industries: ['ai', '亂寫的產業'] },
      { name: '事件乙', summary: '三件，含捏造與重複', itemIds: ['b', 'c', 'd', 'GHOST', 'c', 'e'], industries: ['sec'] },   // b 已被事件甲用掉
      { name: '事件丙', summary: '只剩一個有效項目', itemIds: ['f', 'NOPE'] },
      { name: '', summary: '沒有名稱', itemIds: ['a', 'b'] },
    ],
  }, ids, [], { industries: ['ai', 'sec'] });
  assert.equal(r.events.length, 2);
  assert.deepEqual(r.events[0].itemIds, ['c', 'd', 'e']);               // 依規模排序，且 b 已被前面的事件用掉
  assert.deepEqual(r.events[1].itemIds, ['a', 'b']);
  assert.deepEqual(r.events[1].industries, ['ai']);                       // 不存在的產業被丟棄
});

test('validateAnalysis：事件名稱與摘要不含網址與標記；只有事件也算有效回應', () => {
  const r = validateAnalysis({ events: [{ name: '事件 https://evil.example <b>x</b>', summary: '摘要 <script>', itemIds: ['a', 'b'] }] }, ['a', 'b'], []);
  assert.ok(!/https?:|<|>/.test(JSON.stringify(r)));
  assert.equal(r.events.length, 1);
});

test('buildAnalysisInput：每則帶發布時間，供 AI 判斷事件的時間窗', () => {
  const inp = buildAnalysisInput([{ id: 'a', source: 'iThome', title: 't', time: '2026-11-18T01:00:00Z' }, { id: 'b', source: 'iThome', title: 't2', firstSeen: '2026-11-17T01:00:00Z' }], kev);
  assert.equal(inp.items[0].time, '2026-11-18T01:00:00Z');
  assert.equal(inp.items[1].time, '2026-11-17T01:00:00Z');
});
