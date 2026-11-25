'use strict';
// 儀表板的資料計算（純函式，不碰 DOM）：依產業／主題／公司聚合、台灣與國際的注意力落差、趨勢與動能、今日升溫。
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

  const BUCKET = { industry: 'inds', topic: 'topics', entity: 'ents' };
  const dayValue = (history, kind, key, day) => {
    const d = history.days[day];
    if (!d) return 0;
    if (kind === 'total') return d.n || 0;
    return (d[BUCKET[kind]] || {})[key] || 0;
  };
  const dayTotal = (history, day) => history.days[day]?.n || 0;

  // 合併多天的占比：Σ篇數 ÷ Σ當天總篇數（比「每天占比再平均」穩定，總量少的日子不會被放大）
  function pooledShare(history, kind, key, ds) {
    const n = ds.reduce((a, d) => a + dayTotal(history, d), 0);
    const v = ds.reduce((a, d) => a + dayValue(history, kind, key, d), 0);
    return { v, n, share: n > 0 ? v / n : null };
  }
  const pctChange = (cur, base) => (cur != null && base > 0 ? +(((cur - base) / base) * 100).toFixed(0) : null);
  const round = (x, k = 4) => (x == null ? null : +x.toFixed(k));

  // 趨勢與動能一律比「占比」而不是篇數：每天收錄的總量起伏很大（例如 124 篇 vs 222 篇），
  // 直接比篇數會把「整體量變多」誤當成「這個產業升溫」。kind 為 'total' 時才比總篇數。
  // 回傳 { days: 可用的完整天數, series: [{day, v, n, share}]（最近 14 天）, daily, weekly }
  // daily：最近一天 vs 之前最多 6 天（至少需 3 個完整日）；weekly：最近 7 天 vs 前 7 天（需 14 個完整日）
  function trend(history, kind, key, now = Date.now()) {
    const days = completeDays(history, now);
    const total = kind === 'total';
    const series = days.slice(-14).map((day) => {
      const v = dayValue(history, kind, key, day), n = dayTotal(history, day);
      return { day, v, n, share: total ? null : n > 0 ? round(v / n) : null };
    });
    const out = { days: days.length, series, daily: null, weekly: null };
    if (days.length >= 3) {
      const lastDay = days[days.length - 1], prevDays = days.slice(-7, -1);
      const last = dayValue(history, kind, key, lastDay), lastN = dayTotal(history, lastDay);
      const prev = pooledShare(history, kind, key, prevDays);
      const avg = prev.v / prevDays.length;
      const lastShare = lastN > 0 ? last / lastN : null;
      out.daily = total
        ? { last, avg: +avg.toFixed(2), n: prevDays.length, change: pctChange(last, avg) }
        : { last, lastN, avg: +avg.toFixed(2), n: prevDays.length, lastShare: round(lastShare), avgShare: round(prev.share), change: pctChange(lastShare, prev.share) };
    }
    if (days.length >= 14) {
      const cur = pooledShare(history, kind, key, days.slice(-7)), before = pooledShare(history, kind, key, days.slice(-14, -7));
      out.weekly = total
        ? { cur: cur.v, before: before.v, change: pctChange(cur.v, before.v) }
        : { cur: cur.v, before: before.v, curShare: round(cur.share), beforeShare: round(before.share), change: pctChange(cur.share, before.share) };
    }
    return out;
  }

  // ── 今日升溫／降溫：近 24 小時的占比 ÷ 平常的占比 ──
  // 篇數最多的類別（例如 AI）每天都排第一，看不出當天的變化；比「占比相對平常的倍數」才看得出哪些是今天特別多的。
  // 平常＝每日歷史中「昨天以前」最多 7 個完整日的合併占比。昨天和近 24 小時大部分重疊，所以不放進基準。
  // 小樣本會亂跳，所以設門檻：近 24 小時總量 ≥ minWindow、升溫需 ≥ minCount 篇、降溫需「平常應有」≥ minCount 篇。
  const LIFT_KINDS = ['industry', 'entity', 'topic'];
  const LIFT_DEFAULTS = { minCount: 5, minWindow: 30, minBaseDays: 3, baseDays: 7, up: 1.3, down: 0.7, top: 6, bottom: 4 };

  function baselineDays(history, now = Date.now(), max = LIFT_DEFAULTS.baseDays) {
    return completeDays(history, now).slice(0, -1).slice(-max);
  }

  function lift(items, history, now = Date.now(), opts = {}) {
    const o = { ...LIFT_DEFAULTS, ...opts };
    const win = items.filter((x) => now - timeOf(x) < DAY);
    const base = history && history.days ? baselineDays(history, now, o.baseDays) : [];
    const baseN = base.reduce((a, d) => a + dayTotal(history, d), 0);
    const out = { n: win.length, baseDays: base, baseN, ready: base.length >= o.minBaseDays && baseN > 0 && win.length >= o.minWindow, up: [], down: [] };
    if (!out.ready) return out;
    const rows = [];
    for (const kind of LIFT_KINDS) {
      const seen = new Map(rank(win, kind, now).map((r) => [r.key, r]));
      // 平常有、但近 24 小時一篇都沒有的，也要算（可能是降溫）
      const keys = new Set(seen.keys());
      for (const d of base) for (const k of Object.keys(history.days[d][BUCKET[kind]] || {})) keys.add(k);
      for (const key of keys) {
        if (kind === 'topic' && key === '其他') continue;   // 「其他」沒有意義
        const r = seen.get(key);
        const cur = r ? r.total : 0;
        const baseCount = base.reduce((a, d) => a + dayValue(history, kind, key, d), 0);
        const curShare = cur / win.length, baseShare = baseCount / baseN;
        // 平常完全沒出現的：以「平常有 1 篇」估一個保守的倍數來排序，並標示為新出現
        const fresh = baseCount === 0;
        const ratio = curShare / (fresh ? 1 / baseN : baseShare);
        rows.push({ kind, key, cur, curShare: round(curShare), baseCount, baseShare: round(baseShare), expected: +(baseShare * win.length).toFixed(1), lift: +ratio.toFixed(2), fresh, items: r ? r.items : [] });
      }
    }
    out.up = rows.filter((r) => r.cur >= o.minCount && r.lift >= o.up).sort((a, b) => b.lift - a.lift || b.cur - a.cur).slice(0, o.top);
    out.down = rows.filter((r) => !r.fresh && r.expected >= o.minCount && r.lift <= o.down).sort((a, b) => a.lift - b.lift || b.expected - a.expected).slice(0, o.bottom);
    return out;
  }

  // 儀表板的時間範圍：'24h'＝近 24 小時發布（預設）；'all'＝目前收錄的全部
  const WINDOWS = ['24h', 'all'];
  const inWindow = (items, win, now = Date.now()) => (win === 'all' ? items : items.filter((x) => now - timeOf(x) < DAY));

  const api = { rank, gap, completeDays, trend, lift, baselineDays, inWindow, WINDOWS, LIFT_DEFAULTS, taipeiDay, timeOf, KEYS };
  root.DevDashData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
