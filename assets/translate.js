'use strict';
// Chrome 內建翻譯（Translator API）的包裝。不需要任何金鑰，翻譯在讀者自己的瀏覽器內完成。
// 依官方文件：桌面版 Chrome 138+；繁體中文代碼是 zh-Hant；只能在頁面（非 Web Worker）使用；
// 翻譯會依序排隊處理；首次使用需下載模型，create() 要在使用者操作（點擊）後呼叫。
(function (root) {
  const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯]/;
  const OPTS = { sourceLanguage: 'en', targetLanguage: 'zh-Hant' };
  const CACHE_KEY = 'devintel.tr.v1';
  const CACHE_MAX = 600;

  // 已含中日韓文字的不翻；太短或沒有英文字母的不翻
  function needsTranslation(text) {
    const t = (text || '').trim();
    return t.length >= 4 && !CJK.test(t) && /[A-Za-z]{3}/.test(t);
  }

  // GitHub 專案標題是「owner/name — 說明」：專案名稱不翻，只翻說明
  function splitTitle(item) {
    if (item.kind === 'repo') {
      const [head, ...rest] = item.title.split(' — ');
      return { head, text: rest.join(' — ') };
    }
    return { head: '', text: item.title };
  }

  const supported = () => typeof self !== 'undefined' && 'Translator' in self;

  async function availability() {
    if (!supported()) return 'unsupported';
    try { return await self.Translator.availability(OPTS); } catch { return 'unavailable'; }
  }

  async function createTranslator(onProgress) {
    if (!supported()) throw new Error('此瀏覽器不支援內建翻譯（需要桌面版 Chrome 138 以上）');
    if ((await availability()) === 'unavailable') throw new Error('此瀏覽器無法提供 英文→繁體中文 翻譯');
    return self.Translator.create({
      ...OPTS,
      monitor(m) { m.addEventListener('downloadprogress', (e) => onProgress && onProgress(e.loaded)); },
    });
  }

  // 翻譯結果快取在 localStorage（儲存失敗就只用記憶體），重新整理後不必重翻
  function loadCache() {
    try { return new Map(JSON.parse(localStorage.getItem(CACHE_KEY) || '[]')); } catch { return new Map(); }
  }
  function saveCache(map) {
    try {
      const entries = [...map].slice(-CACHE_MAX);
      localStorage.setItem(CACHE_KEY, JSON.stringify(entries));
    } catch { /* 無痕模式或額度滿了：略過 */ }
  }

  const api = { needsTranslation, splitTitle, supported, availability, createTranslator, loadCache, saveCache };
  root.DevTranslate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
