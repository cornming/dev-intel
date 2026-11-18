'use strict';
// 排程（台北時間）：每日 00:00、05:00、10:00、15:00、20:00。台北沒有日光節約時間，固定 UTC+8。
const SCHEDULE_HOURS = [0, 5, 10, 15, 20];
const TABS = [
  { key: 'all', label: '全部', test: () => true },
  { key: 'tw', label: '🇹🇼 台灣', test: (x) => x.region === 'tw' && x.kind !== 'job' },
  { key: 'global', label: '🌍 國際', test: (x) => x.region === 'global' && x.kind === 'news' },
  { key: 'repo', label: '⭐ 開源新星', test: (x) => x.kind === 'repo' },
  { key: 'job', label: '💼 職場', test: (x) => x.kind === 'job' },
];
const $ = (id) => document.getElementById(id);
const state = { data: null, tab: 'all', tag: '', source: '', sort: 'hot', q: '' };

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
  for (const t of TABS) {
    const n = state.data.items.filter(t.test).length;
    const b = el('button', { type: 'button', role: 'tab', 'aria-selected': String(state.tab === t.key), text: `${t.label} ${n}` });
    b.onclick = () => { state.tab = t.key; state.tag = ''; render(); };
    box.append(b);
  }
}

function renderFilters(pool) {
  const tags = new Map();
  for (const x of pool) for (const t of x.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
  const box = $('tags'); box.replaceChildren();
  for (const [t, n] of [...tags].sort((a, b) => b[1] - a[1])) {
    const b = el('button', { type: 'button', 'aria-pressed': String(state.tag === t), text: `${t} ${n}` });
    b.onclick = () => { state.tag = state.tag === t ? '' : t; render(); };
    box.append(b);
  }
  const sel = $('source'); const cur = state.source;
  sel.replaceChildren(el('option', { value: '', text: '所有來源' }));
  for (const s of [...new Set(pool.map((x) => x.source))].sort()) sel.append(el('option', { value: s, text: s }));
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';
  state.source = sel.value;
}

function card(x) {
  const [name, ...rest] = x.title.split(' — ');
  const desc = x.kind === 'repo' ? rest.join(' — ') : '';
  const info = el('div', { class: 'info' },
    el('span', { class: `src${x.region === 'tw' ? ' tw' : ''}`, text: x.source }),
    ...x.tags.map((t) => el('span', { class: 'tag', text: t })),
    x.kind === 'repo' ? el('span', { text: `⭐ ${x.score.toLocaleString()}${x.lang ? ' · ' + x.lang : ''}` })
      : x.score ? el('span', { text: `▲ ${x.score}` }) : null,
    x.discuss && x.comments ? el('a', { href: safeUrl(x.discuss), target: '_blank', rel: 'noopener noreferrer', text: `💬 ${x.comments}` }) : null,
    x.alsoOn?.length ? el('span', { text: `也在 ${x.alsoOn.join('、')}` }) : null,
    el('span', { text: ago(x.time ?? x.firstSeen) }),
    x.stale ? el('span', { class: 'stale', text: '（來源暫時無更新）' }) : null,
  );
  return el('li', { class: 'item' },
    el('h2', {}, el('a', { href: safeUrl(x.url), target: '_blank', rel: 'noopener noreferrer', text: name })),
    desc ? el('p', { class: 'desc', text: desc }) : null, info);
}

function render() {
  renderTabs(); renderMeta();
  const tab = TABS.find((t) => t.key === state.tab);
  const pool = state.data.items.filter(tab.test);
  renderFilters(pool);
  const q = state.q.trim().toLowerCase();
  let list = pool.filter((x) => (!state.tag || x.tags.includes(state.tag)) && (!state.source || x.source === state.source) && (!q || x.title.toLowerCase().includes(q)));
  list = [...list].sort(state.sort === 'new'
    ? (a, b) => Date.parse(b.time ?? b.firstSeen) - Date.parse(a.time ?? a.firstSeen)
    : (a, b) => b.hot - a.hot);
  $('list').replaceChildren(...list.slice(0, 120).map(card));
  $('count').textContent = `共 ${list.length} 則${list.length > 120 ? '（顯示前 120 則）' : ''}`;
  $('empty').hidden = list.length > 0;
  $('status-list').replaceChildren(...state.data.sources.map((s) =>
    el('li', { class: s.ok ? '' : 'bad', text: `${s.ok ? '✓' : '✗'} ${s.name}：${s.ok ? s.count + ' 則' : `本輪抓取失敗${s.failStreak > 1 ? `（已連續 ${s.failStreak} 輪）` : ''}，沿用舊資料`}` })));
}

$('q').addEventListener('input', (e) => { state.q = e.target.value; render(); });
$('source').addEventListener('change', (e) => { state.source = e.target.value; render(); });
$('sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });

fetch('data/latest.json', { cache: 'no-cache' })
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((d) => { state.data = d; render(); setInterval(renderMeta, 60000); })
  .catch(() => { $('meta').textContent = '資料載入失敗，請稍後再試。'; });
