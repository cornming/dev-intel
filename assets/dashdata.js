'use strict';
// 儀表板的資料計算（純函式，不碰 DOM）：依產業／主題／公司聚合、台灣與國際的注意力落差、趨勢與動能。
// 「關注度」＝被收錄的文章數（一則文章可同時屬於多個產業／主題／公司）。不是市場規模、營收或市占。
(function (root) {
  const DAY = 864e5;
  const TZ = 8 * 36e5;
  const taipeiDay = (ms) => new Date(ms + TZ).toISOString().slice(0, 10);
  const timeOf = (x) => Date.parse(x.time || x.firstSeen || '') || 0;

  const KEYS = {
    industry: (x) => x.inds || [],
    topic: (x) => (x.tags && x.tags.length ? x.tags : ['其他']),
    entity: (x) => x.ents || [],
    source: (x) => [x.source],
  };

  // 依維度聚合：回傳 [{ key, tw, gl, total, last24, items }]，依篇數由多到少；items 依熱度排序（引用出處用）
  function rank(items, kind, now = Date.now()) {
    const keysOf = KEYS[kind];
    const m = new Map();
    for (const x of items) {
      for (const k of keysOf(x)) {
        if (!m.has(k)) m.set(k, { key: k, tw: 0, gl: 0, total: 0, last24: 0, items: [] });
        const r = m.get(k);
        r[x.region === 'tw' ? 'tw' : 'gl']++;
        r.total++;
        if (now - timeOf(x) < DAY) r.last24++;
        r.items.push(x);
      }
    }
    const rows = [...m.values()];
    for (const r of rows) r.items.sort((a, b) => (b.hot || 0) - (a.hot || 0));
    return rows.sort((a, b) => b.total - a.total || String(a.key).localeCompare(String(b.key)));
  }

  // 台灣與國際的注意力落差：各自占自己總量的比例相減（百分點），已排除總量不同的影響。
  // 正值＝台灣占比更高；負值＝國際占比更高。注意：這同時反映「來源組成」，不是市場差異。
  function gap(rows, nTw, nGl, minTotal = 8) {
    return rows.filter((r) => r.total >= minTotal)
      .map((r) => ({ ...r, gap: (r.tw / (nTw || 1) - r.gl / (nGl || 1)) * 100 }))
      .sort((a, b) => b.gap - a.gap);
  }

  // ── 趨勢與動能 ──
  // 第一天是「上線當下的存量」，今天只過了一部分：兩者都不能和完整的日子比，所以都排除。
  function completeDays(history, now = Date.now()) {
    if (!history || !history.days) return [];
    const keys = Object.keys(history.days).sort();
    const today = taipeiDay(now);
    const base = history.startedAt ? taipeiDay(Date.parse(history.startedAt)) : keys[0];
    return keys.filter((k) => k !== today && k !== base);
  }

  const dayValue = (history, kind, key, day) => {
    const d = history.days[day];
    if (!d) return 0;
    if (kind === 'total') return d.n || 0;
    const bucket = { industry: d.inds, topic: d.topics, entity: d.ents }[kind] || {};
    return bucket[key] || 0;
  };

  // 回傳 { days: 可用的完整天數, series: [{day, v}]（最近 14 天）, daily, weekly }
  // daily：最近一天 vs 之前最多 6 天的日均（至少需 3 個完整日）；weekly：最近 7 天 vs 前 7 天（需 14 個完整日）
  function trend(history, kind, key, now = Date.now()) {
    const days = completeDays(history, now);
    const series = days.slice(-14).map((day) => ({ day, v: dayValue(history, kind, key, day) }));
    const out = { days: days.length, series, daily: null, weekly: null };
    if (days.length >= 3) {
      const last = dayValue(history, kind, key, days[days.length - 1]);
      const prev = days.slice(-7, -1).map((d) => dayValue(history, kind, key, d));
      const avg = prev.reduce((a, b) => a + b, 0) / prev.length;
      out.daily = { last, avg: +avg.toFixed(2), n: prev.length, change: avg > 0 ? +(((last - avg) / avg) * 100).toFixed(0) : null };
    }
    if (days.length >= 14) {
      const sum = (ds) => ds.reduce((a, d) => a + dayValue(history, kind, key, d), 0);
      const cur = sum(days.slice(-7)), before = sum(days.slice(-14, -7));
      out.weekly = { cur, before, change: before > 0 ? +(((cur - before) / before) * 100).toFixed(0) : null };
    }
    return out;
  }

  const api = { rank, gap, completeDays, trend, taipeiDay, timeOf, KEYS };
  root.DevDashData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
