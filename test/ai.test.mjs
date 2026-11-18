import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAnalysis, extractAnalysisPayload, buildAnalysisInput, sourceTypeOf } from '../scripts/lib.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/ai-analyze.mjs', import.meta.url));

const items = Array.from({ length: 5 }, (_, i) => ({ id: `id${i}`, source: 'Hacker News', title: `標題 ${i}`, score: i, comments: 0, tags: ['AI'], hot: 1 - i / 10 }));
const kev = { latest: [{ cve: 'CVE-2026-100001', vendor: 'V', product: 'P', name: 'N', added: '2026-11-17', due: '2026-12-08', ransomware: false }] };

function runPipeline(mode, { wrap, prev } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aitest-'));
  writeFileSync(join(dir, 'latest.json'), JSON.stringify({ generatedAt: '2026-11-18T00:00:00Z', items, kev }));
  if (prev) writeFileSync(join(dir, 'analysis.json'), JSON.stringify(prev));
  const log = join(dir, 'log.json');
  const r = spawnSync('node', [SCRIPT], {
    env: { PATH: process.env.PATH, DATA_DIR: dir, CLAUDE_BIN: FAKE, FAKE_LOG: log, FAKE_MODE: mode, FAKE_WRAP: wrap ?? '', AI_PASS_ENV: 'FAKE_LOG,FAKE_MODE,FAKE_WRAP', CLAUDE_CODE_OAUTH_TOKEN: 'tok', GITHUB_TOKEN: 'SECRET-SHOULD-NOT-LEAK', SOME_SECRET: 'x' },
    encoding: 'utf8',
  });
  const out = existsSync(join(dir, 'analysis.json')) ? JSON.parse(readFileSync(join(dir, 'analysis.json'), 'utf8')) : null;
  const seen = existsSync(log) ? JSON.parse(readFileSync(log, 'utf8')) : null;
  return { r, out, seen };
}

test('端到端：丟棄捏造的 ID／CVE、移除網址與標記、數值夾在範圍內、重複與不足兩說法的分歧被刪除', () => {
  const { r, out } = runPipeline('ok');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(out.failStreak, 0);
  assert.ok(!/https?:|<|>/.test(JSON.stringify(out)), '輸出不應含網址或標記');
  assert.deepEqual(out.actions.length, 1);                       // 沒有標題的那筆被丟棄
  assert.deepEqual(out.actions[0].itemIds, ['id0']);             // FAKE-ID 被丟棄
  assert.deepEqual(out.actions[0].cves, ['CVE-2026-100001']);    // 不存在於 KEV 的 CVE 被丟棄
  assert.equal(out.highlights.length, 1);                        // 捏造與重複都被丟棄
  assert.equal(out.highlights[0].itemId, 'id0');
  assert.equal(out.highlights[0].importance, 5);                 // 99 夾到 5
  assert.equal(out.divergences.length, 0);                       // 只有一個說法
  assert.equal(out.glossary.length, 1);
});

test('端到端：claude 的呼叫方式——鎖定權限、最小環境變數、空目錄、只傳標題資料', () => {
  const { seen } = runPipeline('ok');
  assert.ok(seen.args.includes('-p'));
  assert.equal(seen.args[seen.args.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.ok(seen.args.includes('--json-schema') && seen.args.includes('--max-turns'));
  assert.ok(seen.envKeys.includes('CLAUDE_CODE_OAUTH_TOKEN'));
  assert.ok(!seen.envKeys.includes('GITHUB_TOKEN') && !seen.envKeys.includes('SOME_SECRET'), '不該把其他機密環境變數傳給 claude');
  assert.ok(/ai-/.test(seen.cwd), '應在暫存空目錄執行');
  assert.equal(seen.itemCount, 5);
});

test('端到端：結構化輸出缺席時，改從 result 的 JSON 區塊解析', () => {
  const { out } = runPipeline('ok', { wrap: 'result' });
  assert.equal(out.highlights.length, 1);
});

test('端到端：失敗時沿用上一輪內容並累計 failStreak', () => {
  const prev = { generatedAt: '2026-11-17T00:00:00Z', summary: '昨天的分析', actions: [], highlights: [], divergences: [], glossary: [], failStreak: 1 };
  const { r, out } = runPipeline('fail', { prev });
  assert.equal(r.status, 0);                                     // AI 失敗不讓整個流程失敗（由健康檢查決定何時轉紅）
  assert.equal(out.summary, '昨天的分析');
  assert.equal(out.generatedAt, '2026-11-17T00:00:00Z');         // 時間不變，網站才看得出已過時
  assert.equal(out.failStreak, 2);
  assert.ok(out.lastError);
});

test('端到端：沒有上一輪且失敗 → 標記為 empty；回應無法解析也算失敗', () => {
  assert.equal(runPipeline('fail').out.empty, true);
  const g = runPipeline('garbage');
  assert.equal(g.out.empty, true);
  assert.equal(g.out.failStreak, 1);
});

test('validateAnalysis：全空回傳 null；buildAnalysisInput 排除過期項目並限制數量', () => {
  assert.equal(validateAnalysis({}, [], []), null);
  assert.equal(validateAnalysis(null, [], []), null);
  const many = Array.from({ length: 100 }, (_, i) => ({ id: `x${i}`, source: 'iThome', title: 't', stale: i === 0 }));
  const inp = buildAnalysisInput(many, kev, 70);
  assert.equal(inp.items.length, 70);
  assert.ok(!inp.items.some((x) => x.id === 'x0'));
  assert.equal(inp.items[0].type, 'media');
});

test('extractAnalysisPayload：錯誤回應與壞 JSON 回傳 null；sourceTypeOf 有預設值', () => {
  assert.equal(extractAnalysisPayload('not json'), null);
  assert.equal(extractAnalysisPayload(JSON.stringify({ is_error: true, result: '{}' })), null);
  assert.deepEqual(extractAnalysisPayload(JSON.stringify({ structured_output: { a: 1 } })), { a: 1 });
  assert.equal(sourceTypeOf('不存在的來源'), 'media');
  assert.equal(sourceTypeOf('GitHub Blog'), 'official');
});
