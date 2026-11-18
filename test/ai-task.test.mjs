import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const S = (f) => fileURLToPath(new URL(`../scripts/${f}`, import.meta.url));
const items = Array.from({ length: 4 }, (_, i) => ({ id: `id${i}`, url: `https://x/${i}`, source: 'iThome', title: `標題 ${i}`, score: 0, comments: 0, tags: [], hot: 1 - i / 10 }));
const latest = { generatedAt: '2026-11-18T00:00:00Z', items, kev: { latest: [{ cve: 'CVE-2026-100001', vendor: 'V', product: 'P', name: 'N', added: 'a', due: 'd', ransomware: false }] } };

// 非同步執行子程序（本機 http 伺服器在同一個程序，不能用 spawnSync 阻塞）
const run = (cmd, args, env = {}) => new Promise((res) => {
  const c = spawn(cmd, args, { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } });
  let out = '', err = ''; c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (err += d));
  c.on('close', (code) => res({ code, out, err }));
});

test('ai-input：取得最新資料，產出給 AI 讀的 input.json（只有標題與統計）與驗證用的 latest.json', async () => {
  const srv = http.createServer((q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(latest)); }).listen(0);
  const dir = mkdtempSync(join(tmpdir(), 'aiin-'));
  const r = await run('node', [S('ai-input.mjs'), dir], { LATEST_URL: `http://127.0.0.1:${srv.address().port}/` });
  srv.close();
  assert.equal(r.code, 0, r.err);
  const input = JSON.parse(readFileSync(join(dir, 'input.json'), 'utf8'));
  assert.equal(input.items.length, 4);
  assert.equal(input.kev[0].cve, 'CVE-2026-100001');
  assert.ok(!('url' in input.items[0]), '不該把網址傳給 AI');
  assert.ok(existsSync(join(dir, 'latest.json')));
});

test('ai-input：伺服器錯誤或資料格式不符時失敗退出', async () => {
  const srv = http.createServer((q, r) => { r.statusCode = 500; r.end('x'); }).listen(0);
  const r = await run('node', [S('ai-input.mjs'), mkdtempSync(join(tmpdir(), 'aiin-'))], { LATEST_URL: `http://127.0.0.1:${srv.address().port}/` });
  srv.close();
  assert.notEqual(r.code, 0);
});

function validate(raw) {
  const dir = mkdtempSync(join(tmpdir(), 'aival-'));
  writeFileSync(join(dir, 'latest.json'), JSON.stringify(latest));
  writeFileSync(join(dir, 'raw.json'), raw);
  const r = spawnSync('node', [S('ai-validate.mjs'), dir], { encoding: 'utf8' });
  return { r, out: existsSync(join(dir, 'analysis.json')) ? JSON.parse(readFileSync(join(dir, 'analysis.json'), 'utf8')) : null };
}

test('ai-validate：接受 ```json 區塊，丟棄捏造的 id／CVE 與網址並提示被丟棄的數量', () => {
  const raw = '```json\n' + JSON.stringify({
    summary: '摘要 https://evil.example',
    actions: [{ title: '升級', why: '原因', urgency: 'high', itemIds: ['id0', 'NOPE'], cves: ['CVE-2026-100001', 'CVE-2099-1'] }, { title: '', why: 'x' }],
    highlights: [{ itemId: 'id1', summary: '好', importance: 9 }, { itemId: 'GHOST', summary: '捏造' }],
  }) + '\n```';
  const { r, out } = validate(raw);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(out.actions[0].itemIds, ['id0']);
  assert.deepEqual(out.actions[0].cves, ['CVE-2026-100001']);
  assert.equal(out.highlights.length, 1);
  assert.equal(out.highlights[0].importance, 5);
  assert.ok(!/https?:/.test(JSON.stringify(out)));
  assert.equal(out.basedOn, latest.generatedAt);
  assert.equal(out.failStreak, 0);
  assert.match(r.stderr, /actions 有 1 筆/);
  assert.match(r.stderr, /highlights 有 1 筆/);
});

test('ai-validate：不合法 JSON、全空內容都以失敗退出且不產生 analysis.json', () => {
  for (const raw of ['這不是 JSON', '{}', '{"summary":"","actions":[],"highlights":[{"itemId":"GHOST","summary":"x"}]}']) {
    const { r, out } = validate(raw);
    assert.notEqual(r.status, 0, raw);
    assert.equal(out, null);
  }
});

function git(cwd, ...args) { return spawnSync('git', args, { cwd, encoding: 'utf8' }); }

test('ai-publish：首次建立孤立分支、再次更新、內容相同時略過，且不碰 main', () => {
  const root = mkdtempSync(join(tmpdir(), 'aipub-'));
  const remote = join(root, 'remote.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  const seed = join(root, 'seed'); git(root, 'clone', '-q', remote, seed);
  writeFileSync(join(seed, 'README.md'), 'main 的內容'); git(seed, 'add', '.');
  git(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'); git(seed, 'push', '-q', 'origin', 'main');

  const a1 = join(root, 'a1.json'); writeFileSync(a1, JSON.stringify({ generatedAt: '2026-11-18T01:00:00Z', summary: 'v1' }));
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, REPO_URL: remote };
  let r = spawnSync('bash', [S('ai-publish.sh'), a1], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const check = join(root, 'check'); git(root, 'clone', '-q', '-b', 'ai-analysis', remote, check);
  assert.equal(JSON.parse(readFileSync(join(check, 'analysis.json'), 'utf8')).summary, 'v1');
  assert.ok(!existsSync(join(check, 'README.md')), 'ai-analysis 分支只該有 analysis.json');

  r = spawnSync('bash', [S('ai-publish.sh'), a1], { env, encoding: 'utf8' });   // 相同內容
  assert.match(r.stdout, /沒有變更/);

  const a2 = join(root, 'a2.json'); writeFileSync(a2, JSON.stringify({ generatedAt: '2026-11-18T06:00:00Z', summary: 'v2' }));
  r = spawnSync('bash', [S('ai-publish.sh'), a2], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  git(check, 'pull', '-q');
  assert.equal(JSON.parse(readFileSync(join(check, 'analysis.json'), 'utf8')).summary, 'v2');
  assert.equal(git(root, '--git-dir', remote, 'rev-list', '--count', 'ai-analysis').stdout.trim(), '2');
  assert.equal(git(root, '--git-dir', remote, 'rev-parse', 'main').stdout.trim(), git(seed, 'rev-parse', 'HEAD').stdout.trim(), 'main 不該被動到');

  const bad = join(root, 'bad.json'); writeFileSync(bad, '{"x":1}');                  // 缺 generatedAt → 拒絕發布
  assert.notEqual(spawnSync('bash', [S('ai-publish.sh'), bad], { env, encoding: 'utf8' }).status, 0);
});
