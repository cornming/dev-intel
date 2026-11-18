'use strict';
// 我的追蹤清單：依產業、主題、公司或關鍵字，追蹤自己關心的內容。
// 儲存層是可抽換的 adapter（{ kind, load(): Promise<list>, save(list): Promise<void> }）：
// 目前是存在「這個瀏覽器」的 localStorage；之後接上帳號登入服務時，只要換一個 adapter，不必改其他程式。
(function (root) {
  const TYPES = ['industry', 'topic', 'entity', 'keyword'];
  const TYPE_LABEL = { industry: '產業', topic: '主題', entity: '公司', keyword: '關鍵字' };
  const MAX_WATCH = 30;
  const KEY = 'devintel.watch.v1';
  const DAY = 864e5;

  const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);

  // 驗證並整理清單（來自儲存或匯入的資料一律不信任）：型別合法、值不空、不重複、最多 MAX_WATCH 個
  function normalize(list) {
    const out = []; const seen = new Set();
    for (const w of Array.isArray(list) ? list : []) {
      if (!w || !TYPES.includes(w.type)) continue;
      const value = clean(w.value, w.type === 'keyword' ? 30 : 40);
      if (!value || (w.type === 'keyword' && value.length < 2)) continue;
      const id = `${w.type}:${value.toLowerCase()}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ type: w.type, value, label: clean(w.label, 40) || value, addedAt: Number.isFinite(+w.addedAt) ? +w.addedAt : 0 });
      if (out.length >= MAX_WATCH) break;
    }
    return out;
  }

  const idOf = (w) => `${w.type}:${w.value.toLowerCase()}`;

  // 這則文章是否符合這個追蹤項目
  function matches(item, w) {
    switch (w.type) {
      case 'industry': return (item.inds || []).includes(w.value);
      case 'entity': return (item.ents || []).includes(w.value);
      case 'topic': return w.value === '其他' ? !(item.tags && item.tags.length) : (item.tags || []).includes(w.value);
      case 'keyword': return String(item.title || '').toLowerCase().includes(w.value.toLowerCase());
      default: return false;
    }
  }

  // 追蹤項目的摘要：篇數、近 24 小時新增、台灣與國際、代表文章（依熱度；引用出處用）
  function summarize(items, w, now = Date.now()) {
    const hit = items.filter((x) => matches(x, w));
    const t = (x) => Date.parse(x.time || x.firstSeen || '') || 0;
    return {
      total: hit.length, last24: hit.filter((x) => now - t(x) < DAY).length,
      tw: hit.filter((x) => x.region === 'tw').length, gl: hit.filter((x) => x.region !== 'tw').length,
      items: hit.sort((a, b) => (b.hot || 0) - (a.hot || 0)),
    };
  }

  // ── 儲存層 ──
  function localAdapter(storage) {
    let mem = [];
    const st = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    return {
      kind: 'local',
      async load() { try { return st ? JSON.parse(st.getItem(KEY) || '[]') : mem; } catch { return mem; } },
      async save(list) { mem = list; try { if (st) st.setItem(KEY, JSON.stringify(list)); } catch { /* 無痕模式或額度滿：只存在記憶體 */ } },
    };
  }

  function createStore(adapter) {
    let list = [];
    return {
      kind: adapter.kind,
      async init() { list = normalize(await adapter.load()); return list; },
      all: () => list.slice(),
      has: (type, value) => list.some((w) => idOf(w) === `${type}:${String(value).toLowerCase()}`),
      async add(w) {
        const n = normalize([...list, { ...w, addedAt: Date.now() }]);
        const grew = n.length > list.length; list = n; if (grew) await adapter.save(list); return grew;
      },
      async remove(type, value) { const id = `${type}:${String(value).toLowerCase()}`; list = list.filter((w) => idOf(w) !== id); await adapter.save(list); },
      async replace(newList) { list = normalize(newList); await adapter.save(list); return list; },
      export: () => JSON.stringify({ version: 1, watch: list }, null, 1),
    };
  }

  // 匯入檔案內容（JSON 字串）；格式不對回傳 null
  function parseImport(text) {
    try { const j = JSON.parse(text); const l = Array.isArray(j) ? j : j && j.watch; return Array.isArray(l) ? normalize(l) : null; } catch { return null; }
  }

  const api = { TYPES, TYPE_LABEL, MAX_WATCH, normalize, matches, summarize, localAdapter, createStore, parseImport, idOf };
  root.DevWatch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
