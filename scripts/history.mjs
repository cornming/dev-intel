// 歷史累積：每天（台北日期）的各主題／產業／公司被報導的篇數，用來算趨勢與動能。
// 每個項目依「首次出現的日期」歸入當天；重複執行（含 Re-run）以「取最大值」合併，所以不會重複計數。
// 檔案隨網站一起部署（data/history.json），下一輪由 fetch-prev 取回，不進 git。

export const HISTORY_DAYS = 120;
const TZ = 8 * 36e5; // 台北 UTC+8，沒有日光節約時間

export const taipeiDay = (ms) => new Date(ms + TZ).toISOString().slice(0, 10);

const inc = (obj, key, n = 1) => { obj[key] = (obj[key] ?? 0) + n; };

// 一天的彙總：從該天首次出現的項目算出
function summarize(items) {
  const d = { n: 0, tw: 0, gl: 0, topics: {}, inds: {}, ents: {}, stype: {} };
  for (const x of items) {
    d.n++;
    inc(d, x.region === 'tw' ? 'tw' : 'gl');
    for (const t of x.tags?.length ? x.tags : ['其他']) inc(d.topics, t);
    for (const i of x.inds ?? []) inc(d.inds, i);
    for (const e of x.ents ?? []) inc(d.ents, e);
    inc(d.stype, x.stype ?? 'media');
  }
  return d;
}

const maxMerge = (a = {}, b = {}) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = Math.max(o[k] ?? 0, v); return o; };
function mergeDay(old, cur) {
  if (!old) return cur;
  return { n: Math.max(old.n, cur.n), tw: Math.max(old.tw, cur.tw), gl: Math.max(old.gl, cur.gl),
    topics: maxMerge(old.topics, cur.topics), inds: maxMerge(old.inds, cur.inds), ents: maxMerge(old.ents, cur.ents), stype: maxMerge(old.stype, cur.stype) };
}

export function isValidHistory(h) {
  return !!h && typeof h === 'object' && h.days && typeof h.days === 'object' && !Array.isArray(h.days)
    && Object.entries(h.days).every(([k, v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && v && typeof v.n === 'number');
}

export function updateHistory(prev, items, now = Date.now()) {
  const days = isValidHistory(prev) ? { ...prev.days } : {};
  const byDay = new Map();
  for (const x of items) {
    const t = Date.parse(x.firstSeen ?? '');
    if (!Number.isFinite(t)) continue;
    const k = taipeiDay(t);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(x);
  }
  for (const [k, list] of byDay) days[k] = mergeDay(days[k], summarize(list));
  // 只保留最近 HISTORY_DAYS 天
  const keep = Object.keys(days).sort().slice(-HISTORY_DAYS);
  const out = {};
  for (const k of keep) out[k] = days[k];
  const first = keep[0];
  return { version: 1, updatedAt: new Date(now).toISOString(), startedAt: prev?.startedAt ?? new Date(now).toISOString(), firstDay: first ?? null, days: out };
}
