// 用 Claude 訂閱額度做每 5 小時一次的「今日重點」分析。
// 驗證與防線：
//  - 只傳標題與統計（公開資料），不傳任何金鑰或內部內容
//  - claude 在空目錄執行、最小環境變數、dontAsk 權限（任何需要確認的工具呼叫都會被拒絕）
//  - 輸出逐欄驗證：引用的項目 ID／CVE 必須真的存在，AI 產生的網址一律移除
//  - 失敗時沿用上一輪分析並累計 failStreak，連續失敗由 check-health 讓工作流程轉紅
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAnalysisInput, validateAnalysis, extractAnalysisPayload, ANALYSIS_SCHEMA } from './lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(ROOT, 'data');
const LATEST = resolve(DATA, 'latest.json');
const OUT = resolve(DATA, 'analysis.json');
const MODEL = process.env.AI_MODEL || 'claude-sonnet-5-5';
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 300000);

// 規則的唯一來源是 ai/RULES.md（排程任務與 CI 版共用）
const INSTRUCTION = await readFile(resolve(ROOT, 'ai/RULES.md'), 'utf8');

function runClaude(input) {
  return new Promise((resolveP, reject) => {
    // 環境變數白名單。AI_PASS_ENV 只給測試用（讓假的 claude 取得它需要的設定），正式流程不設定
    const extra = (process.env.AI_PASS_ENV || '').split(',').filter(Boolean);
    const env = Object.fromEntries(['PATH', 'HOME', 'LANG', 'CLAUDE_CODE_OAUTH_TOKEN', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS', ...extra]
      .filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
    mkdtemp(join(tmpdir(), 'ai-')).then((cwd) => {
      const args = ['-p', INSTRUCTION, '--output-format', 'json', '--model', MODEL, '--max-turns', '4',
        '--permission-mode', 'dontAsk', '--json-schema', JSON.stringify(ANALYSIS_SCHEMA)];
      const child = spawn(CLAUDE_BIN, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '', err = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('逾時')); }, TIMEOUT_MS);
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', (e) => { clearTimeout(timer); rm(cwd, { recursive: true, force: true }); reject(e); });
      child.on('close', (code) => {
        clearTimeout(timer); rm(cwd, { recursive: true, force: true });
        if (code !== 0) reject(new Error(`claude 結束碼 ${code}：${err.slice(0, 200)}`)); else resolveP(out);
      });
      child.stdin.end(JSON.stringify(input));
    });
  });
}

const prev = await readFile(OUT, 'utf8').then(JSON.parse).catch(() => null);
const latest = JSON.parse(await readFile(LATEST, 'utf8'));
const now = new Date().toISOString();

try {
  const input = buildAnalysisInput(latest.items, latest.kev);
  if (!input.items.length) throw new Error('沒有可分析的項目');
  const stdout = await runClaude(input);
  const raw = extractAnalysisPayload(stdout);
  const clean = validateAnalysis(raw, input.items.map((x) => x.id), (latest.kev?.latest ?? []).map((v) => v.cve));
  if (!clean) throw new Error('回應格式不符或內容為空');
  await writeFile(OUT, JSON.stringify({ generatedAt: now, basedOn: latest.generatedAt, model: MODEL, failStreak: 0, ...clean }) + '\n');
  console.log(`AI 分析完成：行動 ${clean.actions.length}、焦點 ${clean.highlights.length}、分歧 ${clean.divergences.length}、名詞 ${clean.glossary.length}`);
} catch (e) {
  const failStreak = (prev?.failStreak ?? 0) + 1;
  const msg = String(e.message || e).slice(0, 200);
  console.warn(`::warning title=AI 分析失敗::${msg}（連續第 ${failStreak} 次）`);
  // 沿用上一輪內容（generatedAt 不變，網站會顯示「已過時」），只更新失敗計數
  const base = prev && !prev.empty ? prev : { empty: true };
  await writeFile(OUT, JSON.stringify({ ...base, failStreak, lastError: msg, lastFailedAt: now }) + '\n');
}
