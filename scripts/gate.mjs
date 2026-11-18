// 守門：決定這次排程要不要真的更新並部署。
// 為什麼需要：GitHub 的 cron 是「盡力而為」，在整點附近負載高時會延遲甚至略過；只靠 5 小時一次的排程，漏一次就會整整 10 小時沒更新。
// 做法：每小時（避開整點）檢查一次——
//   · 預定時段（台北 00／05／10／15／20 點）且資料已超過 3 小時沒更新 → 更新
//   · 資料已超過 5.5 小時沒更新 → 補跑（上一次被漏掉了）
//   · 其他 → 跳過（這個檢查本身只花幾秒）
// 手動執行與推送程式碼一律更新。
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SLOT_HOURS = [0, 5, 10, 15, 20];
export const SLOT_MIN_AGE_H = 3;
export const CATCHUP_AGE_H = 5.5;
const TZ = 8 * 36e5;

export function decide({ event, now, lastGeneratedAt }) {
  if (event !== 'schedule') return { run: true, reason: `事件 ${event}：一律更新` };
  const t = Date.parse(lastGeneratedAt ?? '');
  if (!Number.isFinite(t)) return { run: true, reason: '無法取得上次更新時間：保險起見更新' };
  const age = (now - t) / 36e5;
  const hourTpe = new Date(now + TZ).getUTCHours();
  const ageTxt = `資料已 ${age.toFixed(1)} 小時沒更新`;
  if (age >= CATCHUP_AGE_H) return { run: true, reason: `${ageTxt}（≥ ${CATCHUP_AGE_H}）：補跑` };
  if (SLOT_HOURS.includes(hourTpe) && age >= SLOT_MIN_AGE_H) return { run: true, reason: `台北 ${hourTpe} 點預定更新時段，${ageTxt}` };
  return { run: false, reason: `${ageTxt}，台北 ${hourTpe} 點不是預定時段：跳過` };
}

async function main() {
  const url = process.env.LATEST_URL;
  const event = process.env.EVENT_NAME ?? 'workflow_dispatch';
  let last = null;
  if (url) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'cache-control': 'no-cache' } }); if (r.ok) last = (await r.json()).generatedAt; } catch { /* 取不到就保險起見更新 */ }
  }
  const d = decide({ event, now: Date.now(), lastGeneratedAt: last });
  console.log(`${d.run ? '▶ 執行' : '⏭ 跳過'}：${d.reason}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${d.run}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**${d.run ? '執行' : '跳過'}**：${d.reason}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
