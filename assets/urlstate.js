'use strict';
// 篩選狀態 ⇄ 網址查詢字串。純函式（不碰 DOM／history），方便測試。
// 例：?tab=tw&tag=資安&src=iThome&sort=new&q=漏洞　預設值（儀表板首頁、熱門排序、儀表板看近 24 小時）不寫進網址，讓網址保持乾淨。
(function (root) {
  const DEFAULT_TAB = 'dash'; // 首頁預設是儀表板；預設值不寫進網址
  const SORTS = ['hot', 'new'];
  const WINS = ['24h', 'all']; // 儀表板的時間範圍；預設 24h
  const MAX = { tag: 30, src: 40, q: 100 };

  // 從網址讀回狀態；每個值都驗證，不合法的一律退回預設值。validTabs 是目前實際存在的頁籤代號。
  function parse(search, validTabs) {
    let p;
    try { p = new URLSearchParams(search || ''); } catch { p = new URLSearchParams(''); }
    const get = (k) => (p.get(k) ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    const tab = get('tab');
    const sort = get('sort');
    const win = get('win');
    return {
      tab: validTabs.includes(tab) ? tab : DEFAULT_TAB,
      tag: get('tag').slice(0, MAX.tag),
      source: get('src').slice(0, MAX.src),
      sort: SORTS.includes(sort) ? sort : 'hot',
      q: get('q').slice(0, MAX.q),
      win: WINS.includes(win) ? win : '24h',
    };
  }

  // 狀態轉成查詢字串（含開頭的 ?；全部是預設值時回傳空字串）
  function build(state) {
    const p = new URLSearchParams();
    if (state.tab && state.tab !== DEFAULT_TAB) p.set('tab', state.tab);
    if (state.tag) p.set('tag', state.tag);
    if (state.source) p.set('src', state.source);
    if (state.sort && state.sort !== 'hot') p.set('sort', state.sort);
    if ((state.q || '').trim()) p.set('q', state.q.trim());
    if (state.win && state.win !== '24h' && WINS.includes(state.win)) p.set('win', state.win);
    const s = p.toString();
    return s ? `?${s}` : '';
  }

  const api = { parse, build, SORTS, WINS, DEFAULT_TAB };
  root.UrlState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
