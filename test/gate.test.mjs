import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, SLOT_HOURS } from '../scripts/gate.mjs';

// 台北時間 → 毫秒（UTC+8）
const tpe = (s) => Date.parse(s.replace(' ', 'T') + ':00+08:00');
const run = (now, last, event = 'schedule') => decide({ event, now: tpe(now), lastGeneratedAt: new Date(tpe(last)).toISOString() });

test('推送與手動執行一律更新，不看資料新舊', () => {
  assert.equal(decide({ event: 'push', now: Date.now(), lastGeneratedAt: new Date().toISOString() }).run, true);
  assert.equal(decide({ event: 'workflow_dispatch', now: Date.now(), lastGeneratedAt: new Date().toISOString() }).run, true);
});

test('預定時段（台北 0／5／10／15／20 點）且資料超過 3 小時沒更新 → 執行', () => {
  for (const h of SLOT_HOURS) {
    const d = run(`2026-11-18 ${String(h).padStart(2, '0')}:23`, `2026-11-17 ${String((h + 24 - 5) % 24).padStart(2, '0')}:30`);
    assert.equal(d.run, true, `台北 ${h} 點`);
  }
});

test('預定時段但資料才剛更新（例如剛推送過）→ 跳過，避免重複', () => {
  const d = run('2026-11-18 10:23', '2026-11-18 08:30');   // 才過 1.9 小時
  assert.equal(d.run, false);
});

test('非預定時段且資料不算舊 → 跳過（每小時的檢查大多是這個）', () => {
  assert.equal(run('2026-11-18 03:23', '2026-11-18 00:30').run, false);   // 2.9 小時
  assert.equal(run('2026-11-18 04:23', '2026-11-18 00:30').run, false);   // 3.9 小時，非預定時段
  assert.equal(run('2026-11-18 12:23', '2026-11-18 10:40').run, false);   // 1.7 小時
  assert.equal(run('2026-11-18 13:23', '2026-11-18 10:40').run, false);   // 2.7 小時
});

test('補跑：資料超過 5.5 小時沒更新（上一個預定時段被 GitHub 漏掉）→ 任何時刻都執行', () => {
  // 預定在台北 5 點更新但被漏掉：5 點那次沒跑；6 點時資料已 6 小時沒更新 → 補跑
  const d = run('2026-11-18 06:23', '2026-11-18 00:30');
  assert.equal(d.run, true);
  assert.match(d.reason, /補跑/);
  // 剛好 5 點 23 分、資料 4.9 小時：走預定時段規則
  assert.equal(run('2026-11-18 05:23', '2026-11-18 00:30').run, true);
});

test('完整的一天：模擬每小時的檢查，正常情況只在預定時段更新、一天 5 次', () => {
  let last = tpe('2026-11-17 20:40'); const updates = [];
  for (let h = 0; h < 24; h++) {
    const now = tpe(`2026-11-18 ${String(h).padStart(2, '0')}:23`);
    const d = decide({ event: 'schedule', now, lastGeneratedAt: new Date(last).toISOString() });
    if (d.run) { updates.push(h); last = now + 40 * 1000; }
  }
  assert.deepEqual(updates, [0, 5, 10, 15, 20]);
});

test('完整的一天：漏掉一次預定更新（5 點）時，6 點補上，之後恢復正常節奏', () => {
  let last = tpe('2026-11-17 20:40'); const updates = [];
  for (let h = 0; h < 24; h++) {
    if (h === 5) continue;                                       // GitHub 沒有觸發這一次
    const now = tpe(`2026-11-18 ${String(h).padStart(2, '0')}:23`);
    const d = decide({ event: 'schedule', now, lastGeneratedAt: new Date(last).toISOString() });
    if (d.run) { updates.push(h); last = now + 40 * 1000; }
  }
  assert.ok(updates.includes(6), `應在 6 點補跑，實際 ${updates}`);
  assert.ok(updates.includes(15) && updates.includes(20));
  assert.ok(Math.max(...updates.slice(1).map((h, i) => h - updates[i])) <= 6, '任兩次更新的間隔不超過 6 小時');
});

test('取不到上次更新時間 → 保險起見更新', () => {
  assert.equal(decide({ event: 'schedule', now: Date.now(), lastGeneratedAt: null }).run, true);
  assert.equal(decide({ event: 'schedule', now: Date.now(), lastGeneratedAt: '壞掉' }).run, true);
});
