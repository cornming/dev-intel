'use strict';
// 排程（台北時間）：每日 00:00、05:00、10:00、15:00、20:00。台北沒有日光節約時間，固定 UTC+8。
const SCHEDULE_HOURS = [0, 5, 10, 15, 20];
const TABS = DevTabs.TABS; // 與訂閱輸出共用（assets/tabs.js）
const PANEL_TABS = [
  { key: 'dash', label: '📊 儀表板', panel: true, when: () => true },
  { key: 'brief', label: '✨ 今日重點', panel: true, when: (d) => d.analysis && !d.analysis.empty },
  { key: 'sec', label: '🛡 資安與版本', panel: true, when: (d) => d.kev && d.kev.latest?.length },
];
const visibleTabs = () => [...PANEL_TABS.filter((t) => t.when(state.data)), ...TABS];
const STYPE = { official: '官方', media: '媒體', community: '社群', repo: '開源專案' };
const $ = (id) => document.getElementById(id);
const watchStore = DevWatch.createStore(DevWatch.localAdapter()); // 我的追蹤（目前存在這個瀏覽器；之後可換成帳號同步的 adapter）
const state = { data: null, tab: UrlState.DEFAULT_TAB, tag: '', source: '', sort: 'hot', q: '' };

function nextRun(now = Date.now()) {
  const TZ = 8 * 36e5;
  const local = new Date(now + TZ); // 用 UTC getter 讀台北時間
  for (let add = 0; add < 2; add++) {
    for (const h of SCHEDULE_HOURS) {
      const t = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + add, h) - TZ;
      if (t > now) return t;
    }
  }
}
const fmtTaipei = (ms) => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(ms);
function ago(iso) {
  if (!iso) return '';
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 6e4));
  if (m < 60) return `${m} 分鐘前`;
  if (m < 1440) return `${Math.floor(m / 60)} 小時前`;
  return `${Math.floor(m / 1440)} 天前`;
}
// 沒有命中任何主題的歸為「其他」，讓每一則都能被篩選到
const tagsOf = (x) => (x.tags.length ? x.tags : ['其他']);
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : '#');
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
  }
  n.append(...kids.filter(Boolean));
  return n;
}

function renderMeta() {
  const gen = Date.parse(state.data.generatedAt);
  $('meta').textContent = `最後更新 ${fmtTaipei(gen)}（${ago(state.data.generatedAt)}）· 下次預定 ${fmtTaipei(nextRun())}`;
}

function renderTabs() {
  const box = $('tabs'); box.replaceChildren();
  for (const t of visibleTabs()) {
    const label = t.panel ? t.label : `${t.label} ${state.data.items.filter(t.test).length}`;
    const b = el('button', { type: 'button', role: 'tab', 'aria-selected': String(state.tab === t.key), text: label });
    b.onclick = () => { state.tab = t.key; state.tag = ''; commit(true); }; // 換頁籤：加入瀏覽歷史，返回鍵能回上一頁籤
    box.append(b);
  }
}

function renderFilters(pool) {
  const tags = new Map();
  for (const x of pool) for (const t of tagsOf(x)) tags.set(t, (tags.get(t) ?? 0) + 1);
  const box = $('tags'); box.replaceChildren();
  for (const [t, n] of [...tags].sort((a, b) => b[1] - a[1])) {
    const b = el('button', { type: 'button', 'aria-pressed': String(state.tag === t), text: `${t} ${n}` });
    b.onclick = () => { state.tag = state.tag === t ? '' : t; commit(false); };
    box.append(b);
  }
  const sel = $('source'); const cur = state.source;
  sel.replaceChildren(el('option', { value: '', text: '所有來源' }));
  for (const s of [...new Set(pool.map((x) => x.source))].sort()) sel.append(el('option', { value: s, text: s }));
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';
  state.source = sel.value;
}

const ICONS = { news: '📰', repo: '📦', job: '💼' };
const registry = new Map(); // item id → { li, x }，翻譯結果回來時只更新那一張卡片
const tr = { on: false, translator: null, gen: 0, cache: DevTranslate.loadCache() };

// 依翻譯狀態畫出標題：翻譯後主標題是中文，原文縮小顯示在下方
function paintTitle(id) {
  const rec = registry.get(id);
  if (!rec) return;
  const { li, x } = rec;
  const { head, text } = DevTranslate.splitTitle(x);
  const zh = tr.on ? tr.cache.get(text) : null;
  const shown = zh || text;
  const link = li.querySelector('h2 a');
  const desc = li.querySelector('.desc');
  const orig = li.querySelector('.orig');
  if (x.kind === 'repo') { link.textContent = head; if (desc) desc.textContent = shown; } else { link.textContent = shown; }
  orig.textContent = zh ? text : '';
  orig.hidden = !zh;
}

function mediaFor(x) {
  const ph = () => el('div', { class: `ph ph-${x.kind}`, 'aria-hidden': 'true' }, el('span', { text: ICONS[x.kind] ?? '📰' }), el('small', { text: x.source }));
  if (!x.image || !/^https:\/\//i.test(x.image)) return ph();
  const img = el('img', { src: x.image, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
  const fig = el('div', { class: 'media' }, img);
  img.addEventListener('error', () => fig.replaceWith(ph())); // 圖片失效時退回預設封面
  return fig;
}

// 這一輪沒抓到的舊項目：來源真的故障才用警示色；來源正常、只是掉出熱門榜，用淡色說明即可
function staleNote(x) {
  if (!x.stale) return null;
  return x.down ? el('span', { class: 'stale', text: '（來源暫時無更新）' })
    : el('span', { class: 'offlist', title: '來源運作正常，這則已不在該來源目前的熱門榜單，本站暫時保留近期內容', text: '（已不在來源榜單）' });
}

function card(x) {
  const { head, text } = DevTranslate.splitTitle(x);
  const info = el('div', { class: 'info' },
    el('span', { class: `src${x.region === 'tw' ? ' tw' : ''}`, text: x.source }),
    STYPE[x.stype] ? el('span', { class: 'stype', text: STYPE[x.stype] }) : null,
    ...x.tags.map((t) => el('span', { class: 'tag', text: t })),
    x.kind === 'repo' ? el('span', { text: `⭐ ${x.score.toLocaleString()}${x.lang ? ' · ' + x.lang : ''}` })
      : x.score ? el('span', { text: `▲ ${x.score}` }) : null,
    x.discuss && x.comments ? el('a', { href: safeUrl(x.discuss), target: '_blank', rel: 'noopener noreferrer', text: `💬 ${x.comments}` }) : null,
    x.alsoOn?.length ? el('span', { class: 'multi', title: `也在 ${x.alsoOn.join('、')}`, text: `${x.alsoOn.length + 1} 個來源` }) : null,
    el('span', { text: ago(x.time ?? x.firstSeen) }),
    staleNote(x),
  );
  const link = el('a', { href: safeUrl(x.url), target: '_blank', rel: 'noopener noreferrer', text: x.kind === 'repo' ? head : text });
  const li = el('li', { class: 'card' },
    el('a', { class: 'cover', href: safeUrl(x.url), target: '_blank', rel: 'noopener noreferrer', tabindex: '-1', 'aria-hidden': 'true' }, mediaFor(x)),
    el('div', { class: 'body' },
      el('h2', {}, link),
      x.kind === 'repo' ? el('p', { class: 'desc', text }) : null,
      el('p', { class: 'orig', lang: 'en', hidden: '' }),
      info));
  registry.set(x.id, { li, x });
  return li;
}

// ── 翻譯 ──────────────────────────────────────────────
function setTrStatus(msg) { $('tr-status').textContent = msg; }

function paintAll() { for (const id of registry.keys()) paintTitle(id); }

async function runTranslateQueue() {
  if (!tr.on || !tr.translator) return;
  const gen = ++tr.gen; // 換頁籤、篩選、關閉翻譯時，舊的佇列會在下一輪停止
  const todo = [];
  const seen = new Set();
  for (const { x } of registry.values()) {
    const { text } = DevTranslate.splitTitle(x);
    if (DevTranslate.needsTranslation(text) && !tr.cache.has(text) && !seen.has(text)) { seen.add(text); todo.push({ id: x.id, text }); }
  }
  paintAll();
  if (!todo.length) { setTrStatus('目前顯示的內容已全部翻譯（或本來就是中文）'); return; }
  let n = 0;
  for (const job of todo) {
    if (gen !== tr.gen || !tr.on) return;
    setTrStatus(`翻譯中 ${n}/${todo.length}…`);
    try {
      const zh = await tr.translator.translate(job.text);
      if (zh) tr.cache.set(job.text, zh);
    } catch (e) {
      setTrStatus(`翻譯中斷：${e.message || e}`);
      return;
    }
    n++;
    // 同一句英文可能出現在多張卡片：全部更新
    for (const [id, { x }] of registry) if (DevTranslate.splitTitle(x).text === job.text) paintTitle(id);
  }
  DevTranslate.saveCache(tr.cache);
  if (gen === tr.gen) setTrStatus(`已翻譯 ${todo.length} 則（由瀏覽器本機完成）`);
}

async function enableTranslate() {
  const btn = $('tr-btn');
  btn.disabled = true;
  try {
    tr.translator ??= await DevTranslate.createTranslator((p) => setTrStatus(`下載翻譯模型 ${Math.round(p * 100)}%（第一次需要，之後不必再下載）`));
    tr.on = true;
    try { localStorage.setItem('devintel.tr', '1'); } catch { /* 略過 */ }
    btn.setAttribute('aria-pressed', 'true');
    btn.textContent = '🌐 顯示原文';
    runTranslateQueue();
  } catch (e) {
    setTrStatus(String(e.message || e));
  } finally {
    btn.disabled = false;
  }
}

function disableTranslate() {
  tr.on = false; tr.gen++;
  try { localStorage.setItem('devintel.tr', '0'); } catch { /* 略過 */ }
  $('tr-btn').setAttribute('aria-pressed', 'false');
  $('tr-btn').textContent = '🌐 翻成中文';
  setTrStatus('');
  paintAll();
}

async function initTranslate() {
  const btn = $('tr-btn');
  if (!DevTranslate.supported()) {
    btn.disabled = true;
    btn.title = '需要桌面版 Chrome 138 以上';
    setTrStatus('內建翻譯需要桌面版 Chrome 138 以上（此瀏覽器不支援，仍可正常閱讀原文）');
    return;
  }
  btn.onclick = () => (tr.on ? disableTranslate() : enableTranslate());
  // 之前開過、且模型已下載好，就自動啟用（不需要再次下載，因此不必等使用者點擊）
  let wanted = false;
  try { wanted = localStorage.getItem('devintel.tr') === '1'; } catch { /* 略過 */ }
  if (wanted && (await DevTranslate.availability()) === 'available') enableTranslate();
}

const itemById = () => new Map(state.data.items.map((x) => [x.id, x]));
const nvd = (cve) => `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cve)}`;
const hoursAgo = (iso) => (Date.now() - Date.parse(iso)) / 36e5;
const section = (title, ...kids) => el('section', { class: 'psec' }, el('h2', { text: title }), ...kids.filter(Boolean));
const itemLink = (x) => el('a', { href: safeUrl(x.url), target: '_blank', rel: 'noopener noreferrer', text: x.title.split(' — ')[0] });

function renderBrief() {
  const a = state.data.analysis;
  const byId = itemById();
  const age = hoursAgo(a.generatedAt);
  const warn = (a.failStreak ?? 0) > 0
    ? `最近 ${a.failStreak} 次 AI 更新失敗，以下是 ${ago(a.generatedAt)} 的內容，可能已過時。`
    : age > 12 ? `這份分析已超過 12 小時沒有更新（${ago(a.generatedAt)}），可能已過時。` : '';
  const root = el('div', {},
    el('p', { class: 'ai-note' }, el('span', { class: 'ai-badge', text: 'AI 整理' }),
      ` ${fmtTaipei(Date.parse(a.generatedAt))}（${ago(a.generatedAt)}）· 只依標題與來源資料判斷，沒有閱讀全文，請以原文為準`),
    warn ? el('p', { class: 'warn-bar', role: 'alert', text: warn }) : null,
    a.summary ? el('p', { class: 'lead', text: a.summary }) : null);
  if (a.actions?.length) {
    root.append(section('需要行動', el('ol', { class: 'actions' }, ...a.actions.map((x) => el('li', { class: x.urgency === 'high' ? 'high' : '' },
      el('strong', { text: x.title }), x.urgency === 'high' ? el('span', { class: 'urg', text: '緊急' }) : null,
      el('p', { text: x.why }),
      el('div', { class: 'refs' },
        ...(x.cves ?? []).map((c) => el('a', { href: nvd(c), target: '_blank', rel: 'noopener noreferrer', text: c })),
        ...(x.itemIds ?? []).map((id) => byId.get(id)).filter(Boolean).map(itemLink)))))));
  }
  if (a.highlights?.length) {
    root.append(section('焦點新聞', el('ul', { class: 'hl' }, ...[...a.highlights].sort((p, q) => q.importance - p.importance).map((h) => {
      const x = byId.get(h.itemId); if (!x) return null;
      return el('li', {},
        el('div', { class: 'hl-top' }, el('span', { class: 'stars', 'aria-label': `重要性 ${h.importance} / 5`, text: '★'.repeat(h.importance) + '☆'.repeat(5 - h.importance) }),
          el('span', { class: 'src', text: x.source }), STYPE[x.stype] ? el('span', { class: 'stype', text: STYPE[x.stype] }) : null,
          x.alsoOn?.length ? el('span', { class: 'multi', text: `${x.alsoOn.length + 1} 個來源` }) : null),
        el('h3', {}, itemLink(x)), el('p', { text: h.summary }), h.impact ? el('p', { class: 'impact', text: `對你的影響：${h.impact}` }) : null);
    }))));
  }
  if (a.divergences?.length) {
    root.append(section('說法分歧', ...a.divergences.map((d) => el('div', { class: 'div' }, el('h3', { text: d.topic }),
      el('ul', {}, ...d.claims.map((c) => el('li', {}, el('strong', { text: c.source + '：' }), c.claim))),
      el('p', { class: 'judge', text: `AI 判斷：${d.judgement}` })))));
  }
  if (a.glossary?.length) {
    root.append(section('名詞小教室', el('dl', { class: 'gloss' }, ...a.glossary.flatMap((g) => [el('dt', { text: g.term }), el('dd', { text: g.definition + (g.why ? `　為什麼重要：${g.why}` : '') })]))));
  }
  return root;
}

function renderSecurity() {
  const { kev, lifecycle } = state.data;
  const root = el('div', {}, el('p', { class: 'ai-note', text: '以下為官方資料直接整理，沒有經過 AI。' }));
  if (kev?.latest?.length) {
    root.append(section('最新已遭利用漏洞（CISA KEV）',
      el('p', { class: 'muted', text: `清單共 ${kev.count?.toLocaleString?.() ?? kev.count} 筆 · 版本 ${kev.version ?? '—'} · 列出最近新增的 ${kev.latest.length} 筆` }),
      el('div', { class: 'tbl-wrap' }, el('table', {},
        el('thead', {}, el('tr', {}, ...['CVE', '產品', '漏洞', '新增日', '修補期限'].map((h) => el('th', { scope: 'col', text: h })))),
        el('tbody', {}, ...kev.latest.map((v) => el('tr', {},
          el('td', {}, el('a', { href: nvd(v.cve), target: '_blank', rel: 'noopener noreferrer', text: v.cve }), v.ransomware ? el('span', { class: 'urg', text: '勒索軟體利用' }) : null),
          el('td', { text: `${v.vendor} ${v.product}` }), el('td', { text: v.name }), el('td', { text: v.added }), el('td', { text: v.due }))))))));
  }
  if (lifecycle?.length) {
    root.append(section('版本與支援期限（endoflife.date）',
      el('div', { class: 'tbl-wrap' }, el('table', {},
        el('thead', {}, el('tr', {}, ...['產品', '版本', '最新修補版', '支援到期'].map((h) => el('th', { scope: 'col', text: h })))),
        el('tbody', {}, ...lifecycle.flatMap((p) => p.cycles.map((c, i) => el('tr', {},
          el('td', { text: i === 0 ? p.label : '' }), el('td', { text: c.cycle + (c.lts ? '（LTS）' : '') }), el('td', { text: c.latest ?? '—' }),
          el('td', {}, c.eol ? `${c.eol}（剩 ${c.daysLeft} 天）` : '尚未訂定', c.soon ? el('span', { class: 'urg', text: '90 天內到期' }) : null)))))))));
  }
  return root;
}

function renderDash() {
  return DevDash.render({ data: state.data, history: state.data.history, analysis: state.data.analysis, store: watchStore, onChange: () => render() });
}

function render() {
  if (!visibleTabs().some((t) => t.key === state.tab)) state.tab = UrlState.DEFAULT_TAB;
  renderTabs(); renderMeta();
  const tab = visibleTabs().find((t) => t.key === state.tab);
  $('cards-ui').hidden = !!tab.panel; $('panel').hidden = !tab.panel;
  if (tab.panel) { $('panel').replaceChildren(tab.key === 'dash' ? renderDash() : tab.key === 'brief' ? renderBrief() : renderSecurity()); return; }
  $('sub-atom').href = tab.key === 'all' ? 'feed.xml' : `feeds/${tab.key}.atom.xml`; // 目前分類的訂閱連結
  $('sub-rss').href = `feeds/${tab.key}.rss.xml`;
  const pool = state.data.items.filter(tab.test);
  if (state.tag && !pool.some((x) => tagsOf(x).includes(state.tag))) state.tag = '';
  renderFilters(pool);
  const q = state.q.trim().toLowerCase();
  let list = pool.filter((x) => (!state.tag || tagsOf(x).includes(state.tag)) && (!state.source || x.source === state.source) && (!q || x.title.toLowerCase().includes(q)));
  list = [...list].sort(state.sort === 'new'
    ? (a, b) => Date.parse(b.time ?? b.firstSeen) - Date.parse(a.time ?? a.firstSeen)
    : (a, b) => b.hot - a.hot);
  registry.clear();
  $('list').replaceChildren(...list.slice(0, 120).map(card));
  $('count').textContent = `共 ${list.length} 則${list.length > 120 ? '（顯示前 120 則）' : ''}`;
  $('empty').hidden = list.length > 0;
  $('status-list').replaceChildren(...state.data.sources.map((s) =>
    el('li', { class: s.ok ? '' : 'bad', text: `${s.ok ? '✓' : '✗'} ${s.name}：${s.ok ? s.count + ' 則' : `本輪抓取失敗${s.failStreak > 1 ? `（已連續 ${s.failStreak} 輪）` : ''}，沿用舊資料`}` })));
  paintAll();
  if (tr.on) runTranslateQueue();
}

// ── 篩選狀態 ⇄ 網址 ──────────────────────────────────
// 換頁籤用 pushState（返回鍵可回到上一個頁籤），其餘篩選用 replaceState（不會塞滿瀏覽歷史）。
function currentUrl() { return location.pathname + UrlState.build(state) + location.hash; }
function writeUrl(push) {
  const url = currentUrl();
  if (url === location.pathname + location.search + location.hash) return;
  try { history[push ? 'pushState' : 'replaceState'](null, '', url); } catch { /* 沙盒或舊瀏覽器：略過，功能仍可用 */ }
}
function commit(push) { render(); writeUrl(push); }
function applyUrl() {
  Object.assign(state, UrlState.parse(location.search, visibleTabs().map((t) => t.key)));
  $('q').value = state.q;
  $('sort').value = state.sort;
}
let qTimer;
$('q').addEventListener('input', (e) => {
  state.q = e.target.value; render();
  clearTimeout(qTimer); qTimer = setTimeout(() => writeUrl(false), 300); // 打字時不要每個字都改網址
});
$('source').addEventListener('change', (e) => { state.source = e.target.value; commit(false); });
$('sort').addEventListener('change', (e) => { state.sort = e.target.value; commit(false); });
window.addEventListener('popstate', () => { if (state.data) { applyUrl(); render(); } }); // 上一頁／下一頁

const optionalJson = (url) => fetch(url, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
// AI 今日重點由「排程任務」發布到 claude/ai-analysis 分支（raw.githubusercontent.com 允許跨網域讀取）；
// 讀不到（尚未發布過、或分支不存在）就不顯示該頁籤。
const ANALYSIS_URLS = ['https://raw.githubusercontent.com/cornming/dev-intel/claude/ai-analysis/analysis.json'];
const loadAnalysis = async () => {
  for (const u of ANALYSIS_URLS) { const j = await optionalJson(u); if (j && typeof j === 'object' && !Array.isArray(j)) return j; }
  return null;
};

Promise.all([
  fetch('data/latest.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
  loadAnalysis(),
  optionalJson('data/history.json'),
  watchStore.init(),
])
  .then(([d, analysis, history]) => { d.analysis = analysis && typeof analysis === 'object' ? analysis : null; d.history = history && history.days ? history : null; return d; })
  .then((d) => { state.data = d; applyUrl(); render(); writeUrl(false); initTranslate(); setInterval(renderMeta, 60000); })
  .catch(() => { $('meta').textContent = '資料載入失敗，請稍後再試。'; });
