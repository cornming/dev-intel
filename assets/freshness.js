'use strict';
// 「新收錄」的判斷與「上次造訪」的記錄。純函式（儲存空間由呼叫方傳入），方便測試。
// 這裡的「新」是指「本站第一次收錄的時間（firstSeen）」，不是文章的發布時間：
// 一篇舊文章今天才被某個來源列入熱門榜，對讀者來說仍是「新收錄」。
(function (root) {
  const NEW_WINDOW_MS = 6 * 36e5;   // 「新」標記：6 小時內第一次收錄
  const RESET_RATIO = 0.8;          // 幾乎全部都是新的，代表本站資料被重置過（不是真的有那麼多新內容），不標
  const RESET_MIN_ITEMS = 20;       // 項目太少時比例沒有意義，不套用上面的判斷
  const LAST_KEY = 'devintel.lastVisit';
  const BASE_KEY = 'devintel.baseline';

  const seenAt = (x) => { const t = Date.parse((x && x.firstSeen) || ''); return Number.isFinite(t) ? t : null; };

  // 這則是否為「新」：首次收錄在 windowMs 內（時間在未來超過一分鐘視為異常資料，不算）
  function isNew(x, now = Date.now(), windowMs = NEW_WINDOW_MS) {
    const t = seenAt(x);
    return t !== null && t <= now + 6e4 && now - t < windowMs;
  }

  // 全部項目中「新」的 id 集合。資料剛被重置時（幾乎全部都是新的）回傳空集合，避免整頁都標「新」。
  function markNew(items, now = Date.now(), windowMs = NEW_WINDOW_MS) {
    const ids = new Set();
    for (const x of items || []) if (isNew(x, now, windowMs)) ids.add(x.id);
    const looksReset = (items || []).length >= RESET_MIN_ITEMS && ids.size / items.length >= RESET_RATIO;
    return looksReset ? new Set() : ids;
  }

  // 在 baselineMs 之後第一次收錄的項目數
  function sinceCount(items, baselineMs) {
    if (!Number.isFinite(baselineMs)) return 0;
    return (items || []).filter((x) => { const t = seenAt(x); return t !== null && t > baselineMs; }).length;
  }

  // 「上次造訪」的時間（毫秒），第一次造訪或讀不到時為 null；同時把「這次造訪」記下來。
  // 為什麼要用兩層儲存：local 記「上一次」，session 把這個工作階段的基準固定住——
  // 否則重新整理一次，基準就變成剛剛，「上次造訪後新增」立刻變 0。
  function visitBaseline(local, session, now = Date.now()) {
    let baseline;
    let fromSession = false;
    try {
      const s = session.getItem(BASE_KEY);
      if (s !== null && s !== undefined) { baseline = s === 'none' ? null : Number(s); fromSession = true; }
    } catch { /* 讀不到就當作沒有 */ }
    if (!fromSession) {
      try { baseline = Number(local.getItem(LAST_KEY)); } catch { baseline = null; }
      try { session.setItem(BASE_KEY, Number.isFinite(baseline) && baseline > 0 ? String(baseline) : 'none'); } catch { /* 略過 */ }
    }
    // 不合理的值（NaN、0、未來的時間）一律當作「沒有上次造訪」
    if (!Number.isFinite(baseline) || baseline <= 0 || baseline > now) baseline = null;
    try { local.setItem(LAST_KEY, String(now)); } catch { /* 無痕模式或額度滿：略過，功能降級為「沒有上次造訪」 */ }
    return baseline;
  }

  const api = { isNew, markNew, sinceCount, visitBaseline, NEW_WINDOW_MS, RESET_RATIO };
  root.DevFresh = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
