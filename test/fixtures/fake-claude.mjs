#!/usr/bin/env node
// 假的 claude：記錄收到的參數與環境，並依 FAKE_MODE 回傳不同結果，用來測 ai-analyze 的流程與防線。
import { readFileSync, writeFileSync } from 'node:fs';
const stdin = readFileSync(0, 'utf8');
const input = JSON.parse(stdin);
writeFileSync(process.env.FAKE_LOG, JSON.stringify({ args: process.argv.slice(2), envKeys: Object.keys(process.env), cwd: process.cwd(), itemCount: input.items.length }));
const mode = process.env.FAKE_MODE;
if (mode === 'fail') { console.error('boom'); process.exit(2); }
if (mode === 'garbage') { console.log(JSON.stringify({ result: '抱歉我無法完成' })); process.exit(0); }
const realId = input.items[0].id;
const payload = {
  summary: '今天重點是 AI 與資安。<script>x</script> 詳見 https://evil.example/x',
  actions: [
    { title: '升級 Chrome', why: '已遭利用，請盡快處理 https://evil.example', urgency: 'high', itemIds: [realId, 'FAKE-ID'], cves: [input.kev[0]?.cve ?? 'CVE-2026-000001', 'CVE-2099-999999'] },
    { title: '', why: '沒有標題會被丟棄' },
  ],
  highlights: [
    { itemId: realId, summary: '真實項目的摘要', impact: '影響', importance: 99 },
    { itemId: 'HALLUCINATED', summary: '捏造的項目不該出現', importance: 5 },
    { itemId: realId, summary: '重複的項目只留一次', importance: 1 },
  ],
  divergences: [{ topic: '只有一個說法', claims: [{ source: 'A', claim: '1' }], judgement: '不足兩個說法會被丟棄' }],
  glossary: [{ term: 'KEV', definition: '已知遭利用漏洞清單', why: '優先修補' }],
};
const wrap = process.env.FAKE_WRAP;
console.log(JSON.stringify(wrap === 'result' ? { result: '```json\n' + JSON.stringify(payload) + '\n```' } : { structured_output: payload }));
