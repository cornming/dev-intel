import test from 'node:test';
import assert from 'node:assert/strict';
import { withRetry, NotFoundError } from '../scripts/fetch-prev.mjs';

const noSleep = { sleep: async () => {} };

test('withRetry：暫時性失敗會重試，成功就回傳', async () => {
  let n = 0;
  const out = await withRetry(async () => { if (++n < 3) throw new Error('HTTP 503'); return 'ok'; }, { tries: 3, ...noSleep });
  assert.equal(out, 'ok');
  assert.equal(n, 3);
});

test('withRetry：用完次數仍失敗，丟出最後一次的錯誤', async () => {
  let n = 0;
  await assert.rejects(withRetry(async () => { throw new Error(`fail ${++n}`); }, { tries: 3, ...noSleep }), /fail 3/);
  assert.equal(n, 3);
});

test('withRetry：檔案不存在（404）不重試', async () => {
  let n = 0;
  await assert.rejects(withRetry(async () => { n++; throw new NotFoundError('HTTP 404'); }, { tries: 3, ...noSleep }), NotFoundError);
  assert.equal(n, 1);
});

test('withRetry：重試之間會等待（間隔遞增）', async () => {
  const waits = [];
  await assert.rejects(withRetry(async () => { throw new Error('x'); }, { tries: 3, baseMs: 100, sleep: async (ms) => { waits.push(ms); } }));
  assert.deepEqual(waits, [100, 200]);
});
