'use strict';
// 內容分類（頁籤）的定義：網站與 Atom/RSS 訂閱輸出共用同一份，避免「網頁上的職場」和「訂閱的職場」不一致。
// 瀏覽器以 <script> 載入（掛在 self.DevTabs）；scripts/feeds.mjs 用 vm 載入同一個檔案。
(function (root) {
  const TABS = [
    { key: 'all', label: '全部', test: () => true },
    { key: 'tw', label: '🇹🇼 台灣', test: (x) => x.region === 'tw' },
    { key: 'global', label: '🌍 國際', test: (x) => x.region === 'global' && x.kind === 'news' && !x.tags.includes('職場') },
    { key: 'repo', label: '⭐ 開源新星', test: (x) => x.kind === 'repo' },
    { key: 'job', label: '💼 職場', test: (x) => x.kind === 'job' || x.tags.includes('職場') },
  ];
  const api = { TABS };
  root.DevTabs = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
