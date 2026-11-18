'use strict';
// 儀表板首頁：產業關注度、台灣與國際落差、公司排行、事件脈絡、趨勢、我的追蹤。
// 原則：每個數字都能點開看到「原始文章與連結」（證據面板）；「關注度」＝被收錄的文章數，不是市場規模。
(function (root) {
  const D = root.DevDashData, W = root.DevWatch;
  const STYPE = { official: '官方', media: '媒體', community: '社群', repo: '開源專案' };
  const NS = 'http://www.w3.org/2000/svg';

  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);   // onclick 等事件：用監聽器，不能變成字串屬性
      else n.setAttribute(k, v === true ? '' : v);
    }
    n.append(...kids.filter((x) => x != null && x !== false));
    return n;
  };
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
  const fmtTime = (ms) => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(ms);
  const ago = (ms, now) => { const m = Math.max(0, Math.round((now - ms) / 6e4)); return m < 60 ? `${m} 分鐘前` : m < 1440 ? `${Math.floor(m / 60)} 小時前` : `${Math.floor(m / 1440)} 天前`; };
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  // ───────── 證據面板：點任何數字，列出背後的原始文章與連結 ─────────
  let drawer;
  function ensureDrawer() {
    if (drawer) return drawer;
    const panel = el('div', { class: 'ev-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ev-title', tabindex: '-1' });
    const back = el('div', { class: 'ev-back', hidden: true }, panel);
    document.body.append(back);
    back.addEventListener('click', (e) => { if (e.target === back) closeDrawer(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !back.hidden) closeDrawer(); });
    drawer = { back, panel, opener: null };
    return drawer;
  }
  function closeDrawer() { if (!drawer) return; drawer.back.hidden = true; document.body.classList.remove('ev-open'); drawer.opener?.focus?.(); }

  function openEvidence({ title, sub, items, now, watch, store, onChange, limit = 60 }) {
    const d = ensureDrawer(); d.opener = document.activeElement;
    const list = el('ol', { class: 'ev-list' });
    for (const x of items.slice(0, limit)) {
      const t = D.timeOf(x);
      list.append(el('li', {},
        el('a', { href: safeUrl(x.url), target: '_blank', rel: 'noopener noreferrer', text: x.title.split(' — ')[0] }),
        el('div', { class: 'ev-meta' },
          el('span', { class: `ev-src ${x.region === 'tw' ? 'tw' : 'gl'}`, text: x.source }),
          STYPE[x.stype] ? el('span', { text: STYPE[x.stype] }) : null,
          el('span', { text: x.region === 'tw' ? '台灣' : '國際' }),
          t ? el('span', { text: `${fmtTime(t)}（${ago(t, now)}）` }) : null,
          x.discuss && x.comments ? el('a', { href: safeUrl(x.discuss), target: '_blank', rel: 'noopener noreferrer', text: `💬 ${x.comments}` }) : null)));
    }
    const head = el('div', { class: 'ev-head' }, el('div', {}, el('h2', { id: 'ev-title', text: title }), el('p', { class: 'ev-sub', text: `${sub ? sub + '　' : ''}共 ${items.length} 篇${items.length > limit ? `，依熱度顯示前 ${limit} 篇` : ''}。每則都連到原始出處。` })));
    const actions = el('div', { class: 'ev-actions' });
    if (watch && store) {
      const btn = el('button', { type: 'button', class: 'btn' });
      const sync = () => { const on = store.has(watch.type, watch.value); btn.textContent = on ? '★ 已追蹤（點擊取消）' : '☆ 加入我的追蹤'; btn.setAttribute('aria-pressed', String(on)); };
      btn.onclick = async () => { store.has(watch.type, watch.value) ? await store.remove(watch.type, watch.value) : await store.add(watch); sync(); onChange?.(); };
      sync(); actions.append(btn);
    }
    actions.append(el('button', { type: 'button', class: 'btn', text: '關閉', onclick: closeDrawer }));
    head.append(actions);
    d.panel.replaceChildren(head, list);
    d.back.hidden = false; document.body.classList.add('ev-open'); d.panel.focus();
  }

  // ───────── 小元件 ─────────
  function bars(tw, gl, max) {
    return el('div', { class: 'track', 'aria-hidden': 'true' },
      el('i', { class: 'seg a', style: `width:${(tw / max) * 100}%` }), el('i', { class: 'seg b', style: `width:${(gl / max) * 100}%` }));
  }
  const legend = () => el('div', { class: 'legend' }, el('span', {}, el('i', { class: 'sw a' }), '台灣來源'), el('span', {}, el('i', { class: 'sw b' }), '國際來源'));
  const card = (cls, title, lede, ...kids) => el('section', { class: `dcard ${cls}` }, el('h2', { text: title }), lede ? el('p', { class: 'lede', text: lede }) : null, ...kids);

  function spark(series, w = 110, h = 26) {
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('class', 'spark'); svg.setAttribute('role', 'img');
    const max = Math.max(1, ...series.map((p) => p.v)); const step = series.length > 1 ? (w - 4) / (series.length - 1) : 0;
    const pts = series.map((p, i) => `${2 + i * step},${h - 3 - (p.v / max) * (h - 8)}`);
    svg.setAttribute('aria-label', `近 ${series.length} 天：${series.map((p) => p.v).join('、')} 篇`);
    const line = document.createElementNS(NS, 'polyline'); line.setAttribute('points', pts.join(' ')); line.setAttribute('fill', 'none'); line.setAttribute('stroke', 'var(--c-tw)'); line.setAttribute('stroke-width', '2'); line.setAttribute('stroke-linejoin', 'round');
    svg.append(line); return svg;
  }

  // ───────── 主體 ─────────
  function render(ctx) {
    const { data, history, analysis, store, onChange } = ctx;
    const now = ctx.now ?? Date.now();
    const items = data.items; // 與「全部」頁籤同一個總數（含來源暫時沒有更新、但仍在近 3 天內的報導），避免出現兩個不同的總數
    const byId = new Map(items.map((x) => [x.id, x]));
    const indName = Object.fromEntries((data.taxonomy?.industries ?? []).map((i) => [i.id, i.name]));
    const entMap = Object.fromEntries((data.taxonomy?.entities ?? []).map((e) => [e.id, e]));
    const nTw = items.filter((x) => x.region === 'tw').length, nGl = items.length - nTw;
    const indRows = D.rank(items, 'industry', now), entRows = D.rank(items, 'entity', now);
    const trendOf = (kind, key) => D.trend(history, kind, key, now);
    const rootEl = el('div', { class: 'dash' });
    const ev = (o) => openEvidence({ now, store, onChange, ...o });

    // 說明列：指標定義與資料限制（解讀前要知道的事）
    const days = D.completeDays(history, now).length;
    const nSrc = new Set(items.map((x) => x.source)).size;
    const comm = items.filter((x) => x.stype === 'community').length;
    rootEl.append(el('div', { class: 'note', role: 'note' },
      el('span', {}, el('b', { text: '關注度＝被收錄的文章數' }), '（一則文章可同時屬於多個產業與公司）。這不是市場規模、營收或市占，也沒有股價或財務資料。'),
      el('span', {}, el('b', { text: '來源偏向：' }), `開發者社群占 ${pct(comm, items.length)}%，所以反映的是「開發者圈的關注度」。`),
      el('span', {}, el('b', { text: '只依標題：' }), '沒有讀全文。點任何數字都能看到原始文章與連結。')));

    // KPI
    const topInd = indRows[0], topEnt = entRows[0];
    const last24 = items.filter((x) => now - D.timeOf(x) < 864e5);
    const kpi = (v, l, n, onClick) => {
      const body = [el('div', { class: 'v', text: v }), el('div', { class: 'l', text: l }), el('div', { class: 'n', text: n })];
      return onClick ? el('button', { type: 'button', class: 'dcard kpi btn-card', onclick: onClick }, ...body) : el('div', { class: 'dcard kpi' }, ...body);
    };
    const row0 = el('div', { class: 'kpis' },
      kpi(items.length.toLocaleString('en-US'), '收錄文章', `近 24 小時發布 ${last24.length} 篇`, () => ev({ title: '所有收錄文章', sub: '依熱度排序。', items: [...items].sort((a, b) => b.hot - a.hot) })),
      kpi(String(nSrc), '涵蓋來源', `台灣 ${nTw} 篇／國際 ${nGl} 篇`),
      topInd ? kpi((indName[topInd.key] || topInd.key).replace('與', '與'), '最受關注的產業', `${topInd.total} 篇，占 ${pct(topInd.total, items.length)}%`, () => ev({ title: indName[topInd.key], items: topInd.items, watch: { type: 'industry', value: topInd.key, label: indName[topInd.key] }, onChange })) : null,
      topEnt ? kpi(entMap[topEnt.key]?.name.split('／')[0] || topEnt.key, '最常被提到的公司', `${topEnt.total} 篇，${new Set(topEnt.items.map((x) => x.source)).size} 個來源`, () => ev({ title: entMap[topEnt.key]?.name, items: topEnt.items, watch: { type: 'entity', value: topEnt.key, label: entMap[topEnt.key]?.name } })) : null);
    rootEl.append(row0);

    // ── 我的追蹤 ──
    rootEl.append(watchCard({ items, data, indName, entMap, store, now, ev, onChange }));

    // ── 產業關注度 ──
    const grid = el('div', { class: 'cols' }); rootEl.append(grid);
    const max = Math.max(1, ...indRows.map((r) => r.total));
    const c1 = card('c-7', '各產業的關注度', '條長＝文章數；右側「＋N」是近 24 小時發布的篇數。點一列看原始文章。', legend());
    for (const r of indRows) {
      const tr = trendOf('industry', r.key);
      const arrow = tr.daily && tr.daily.change != null ? el('span', { class: `chg ${tr.daily.change > 0 ? 'up' : tr.daily.change < 0 ? 'down' : ''}`, title: `昨日 ${tr.daily.last} 篇，前 ${tr.daily.n} 日均 ${tr.daily.avg} 篇`, text: `${tr.daily.change > 0 ? '▲' : tr.daily.change < 0 ? '▼' : '＝'}${Math.abs(tr.daily.change)}%` }) : null;
      c1.append(el('button', { type: 'button', class: 'rowbtn', 'aria-label': `${indName[r.key]}：${r.total} 篇，台灣 ${r.tw}、國際 ${r.gl}。查看文章`, onclick: () => ev({ title: indName[r.key] || r.key, sub: `台灣 ${r.tw}、國際 ${r.gl}。`, items: r.items, watch: { type: 'industry', value: r.key, label: indName[r.key] }, onChange }) },
        el('span', { class: 'nm', text: indName[r.key] || r.key }), bars(r.tw, r.gl, max), el('span', { class: 'num', text: String(r.total) }), el('span', { class: 'new', text: r.last24 ? `＋${r.last24}` : '' }), arrow));
    }
    const none = (data.taxonomy?.industries ?? []).filter((i) => !indRows.some((r) => r.key === i.id)).map((i) => i.name);
    if (none.length) c1.append(el('p', { class: 'lede', style: 'margin-top:10px', text: `目前沒有相關文章：${none.join('、')}。（來源以軟體與科技為主，這些產業只有少量或沒有報導。）` }));
    grid.append(c1);

    // ── 台灣與國際落差 ──
    const gaps = D.gap(indRows, nTw, nGl, 8); const mg = Math.max(1, ...gaps.map((g) => Math.abs(g.gap)));
    const c2 = card('c-5', '台灣與國際的注意力落差', '各自占自己總量的比例相減（百分點）。往右＝台灣更重視，往左＝國際更重視。');
    c2.append(el('div', { class: 'axis-cap' }, el('span', { text: '← 國際更重視' }), el('span', { text: '台灣更重視 →' })));
    for (const g of gaps) {
      const w = (Math.abs(g.gap) / mg) * 50, right = g.gap >= 0;
      c2.append(el('button', { type: 'button', class: 'gaprow', 'aria-label': `${indName[g.key]}：台灣占 ${pct(g.tw, nTw)}%，國際占 ${pct(g.gl, nGl)}%，落差 ${g.gap.toFixed(1)} 個百分點`, onclick: () => ev({ title: `${indName[g.key]}（台灣 ${g.tw}／國際 ${g.gl}）`, sub: `台灣占 ${pct(g.tw, nTw)}%、國際占 ${pct(g.gl, nGl)}%。`, items: g.items, onChange }) },
        el('span', { class: 'nm', text: indName[g.key] }), el('span', { class: 'dtrack' }, el('i', { class: `dbar ${right ? 'a' : 'b'}`, style: `${right ? 'left' : 'right'}:50%;width:${w}%` })), el('span', { class: 'num', text: `${g.gap > 0 ? '+' : ''}${g.gap.toFixed(1)}` })));
    }
    c2.append(el('p', { class: 'lede', style: 'margin-top:10px', text: '提醒：這同時反映來源組成（台灣來源多為媒體、國際多為開發者社群），不能直接解讀成市場差異。' }));
    grid.append(c2);

    // ── 公司排行 ──
    const grid2 = el('div', { class: 'cols' }); rootEl.append(grid2);
    const emax = Math.max(1, ...entRows.slice(0, 10).map((r) => r.total));
    const c3 = card('c-6', '最常被提到的公司與產品', `公司字典（${data.taxonomy?.entities.length ?? 0} 個）涵蓋 ${pct(items.filter((x) => x.ents?.length).length, items.length)}% 的文章。點一列看原始文章。`, legend());
    for (const r of entRows.slice(0, 10)) {
      const e = entMap[r.key];
      c3.append(el('button', { type: 'button', class: 'rowbtn ent', 'aria-label': `${e?.name}：${r.total} 篇。查看文章`, onclick: () => ev({ title: e?.name || r.key, sub: `台灣 ${r.tw}、國際 ${r.gl}。`, items: r.items, watch: { type: 'entity', value: r.key, label: e?.name }, onChange }) },
        el('span', { class: 'nm', text: e?.name || r.key }), bars(r.tw, r.gl, emax), el('span', { class: 'num', text: String(r.total) }), el('span', { class: 'new', text: r.last24 ? `＋${r.last24}` : '' }),
        el('span', { class: 'dchips' }, ...(e?.industries || []).slice(0, 2).map((i) => el('span', { class: 'pill', text: (indName[i] || i).slice(0, 6) })))));
    }
    grid2.append(c3);

    // ── 主要事件（AI 分群，附引用）──
    grid2.append(eventsCard({ analysis, byId, indName, now, ev, onChange }));

    // ── 趨勢 ──
    rootEl.append(trendCard({ history, indRows, indName, now, trendOf, days, ev, onChange }));

    // ── AI 今日重點摘要（附引用）──
    if (analysis && !analysis.empty && analysis.summary) rootEl.append(briefCard({ analysis, byId, now, ev }));

    // ── 指標說明 ──
    rootEl.append(el('details', { class: 'dcard defs' }, el('summary', { text: '指標與資料說明（解讀前請先讀）' }),
      el('ul', {},
        el('li', {}, el('b', { text: '關注度：' }), '被收錄的文章篇數。一則文章可屬於最多 2 個產業，所以各產業加總會大於文章總數。'),
        el('li', {}, el('b', { text: '產業與公司：' }), '依標題比對 config/taxonomy.json 的字典，只看標題、粗分類，不是產業研究。'),
        el('li', {}, el('b', { text: '台灣／國際：' }), '依來源所在地區；台灣來源為 iThome、科技新報、TechOrange、INSIDE、iT邦幫忙、Medium 繁中標籤。'),
        el('li', {}, el('b', { text: '資料窗：' }), '本站持續收錄各來源最近的熱門內容，不是全市場的完整資料。'),
        el('li', {}, el('b', { text: '趨勢：' }), '以每日累積的歷史計算。上線當天（存量）與今天（只過一部分）不納入；完整日 ≥ 3 天才顯示「昨日 vs 日均」，≥ 14 天才顯示週成長。'),
        el('li', {}, el('b', { text: '來源構成：' }), `社群 ${comm}、媒體 ${items.filter((x) => x.stype === 'media').length}、開源專案 ${items.filter((x) => x.stype === 'repo').length}、官方 ${items.filter((x) => x.stype === 'official').length}（篇）。`))));
    return rootEl;
  }

  // ───────── 我的追蹤 ─────────
  function watchCard({ items, data, indName, entMap, store, now, ev, onChange }) {
    const c = el('section', { class: 'dcard watch' });
    const list = store.all();
    const tools = el('div', { class: 'wtools' });
    const addBtn = el('button', { type: 'button', class: 'btn', 'aria-expanded': 'false', text: '＋ 新增追蹤' });
    const exp = el('button', { type: 'button', class: 'btn', text: '匯出' });
    const impIn = el('input', { type: 'file', accept: 'application/json,.json', hidden: true, 'aria-label': '匯入追蹤清單檔案' });
    const imp = el('button', { type: 'button', class: 'btn', text: '匯入' });
    tools.append(addBtn, exp, imp, impIn);
    c.append(el('div', { class: 'whead' }, el('div', {}, el('h2', { text: `我的追蹤（${list.length}）` }), el('p', { class: 'lede', text: '追蹤你關心的產業、主題、公司或關鍵字，這裡會列出最新動態與原始出處。' })), tools));

    const form = el('form', { class: 'wform', hidden: true });
    const typeSel = el('select', { 'aria-label': '追蹤類型' }, ...W.TYPES.map((t) => el('option', { value: t, text: W.TYPE_LABEL[t] })));
    const valHolder = el('span', { class: 'wval' });
    const submit = el('button', { type: 'submit', class: 'btn primary', text: '追蹤' });
    const msg = el('span', { class: 'wmsg', role: 'status' });
    const topics = [...new Set(items.flatMap((x) => (x.tags?.length ? x.tags : ['其他'])))].sort();
    const opts = {
      industry: (data.taxonomy?.industries ?? []).map((i) => [i.id, i.name]),
      topic: topics.map((t) => [t, t]),
      entity: (data.taxonomy?.entities ?? []).map((e) => [e.id, e.name]),
    };
    let valEl;
    const buildVal = () => {
      const t = typeSel.value;
      valEl = t === 'keyword' ? el('input', { type: 'text', maxlength: '30', placeholder: '例如：黃仁勳、Rust、漏洞', 'aria-label': '關鍵字', required: true })
        : el('select', { 'aria-label': `選擇${W.TYPE_LABEL[t]}` }, ...opts[t].map(([v, n]) => el('option', { value: v, text: n })));
      valHolder.replaceChildren(valEl);
    };
    typeSel.onchange = buildVal; buildVal();
    form.append(typeSel, valHolder, submit, msg);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const t = typeSel.value; const v = valEl.value.trim(); if (!v) return;
      const label = t === 'keyword' ? v : (opts[t].find(([x]) => x === v)?.[1] ?? v);
      const added = await store.add({ type: t, value: v, label });
      if (added) onChange?.(); else msg.textContent = store.all().length >= W.MAX_WATCH ? `最多追蹤 ${W.MAX_WATCH} 個` : '已經在追蹤清單中';
    };
    addBtn.onclick = () => { form.hidden = !form.hidden; addBtn.setAttribute('aria-expanded', String(!form.hidden)); if (!form.hidden) (valEl.focus?.()); };
    c.append(form);

    exp.onclick = () => {
      const url = URL.createObjectURL(new Blob([store.export()], { type: 'application/json' }));
      const a = el('a', { href: url, download: 'dev-intel-watchlist.json' }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    imp.onclick = () => impIn.click();
    impIn.onchange = async () => {
      const f = impIn.files?.[0]; if (!f) return;
      if (f.size > 100000) { msg.textContent = '檔案太大'; form.hidden = false; return; }
      const parsed = W.parseImport(await f.text());
      if (!parsed) { form.hidden = false; msg.textContent = '匯入失敗：檔案格式不正確'; return; }
      await store.replace([...store.all(), ...parsed]); onChange?.();
    };

    if (!list.length) {
      c.append(el('p', { class: 'dempty', text: '還沒有追蹤任何項目。按「＋ 新增追蹤」，或在任何證據面板（點產業、公司的數字）裡按「☆ 加入我的追蹤」。' }));
    } else {
      const rows = list.map((w) => ({ w, s: W.summarize(items, w, now) })).sort((a, b) => b.s.last24 - a.s.last24 || b.s.total - a.s.total);
      const grid = el('div', { class: 'wgrid' });
      for (const { w, s } of rows) {
        const lab = w.type === 'industry' ? (indName[w.value] || w.label) : w.type === 'entity' ? (entMap[w.value]?.name || w.label) : w.label;
        grid.append(el('article', { class: 'wcard' },
          el('div', { class: 'wtop' }, el('span', { class: 'pill', text: W.TYPE_LABEL[w.type] }), el('strong', { text: lab }), el('button', { type: 'button', class: 'x', 'aria-label': `取消追蹤 ${lab}`, text: '✕', onclick: async () => { await store.remove(w.type, w.value); onChange?.(); } })),
          el('div', { class: 'wstat' }, el('button', { type: 'button', class: 'linklike', onclick: () => ev({ title: lab, sub: `${W.TYPE_LABEL[w.type]}：${lab}。`, items: s.items, watch: w }), text: `${s.total} 篇` }), el('span', { text: s.last24 ? `近 24 小時 ＋${s.last24}` : '近 24 小時無新增' }), el('span', { text: `台灣 ${s.tw}／國際 ${s.gl}` })),
          s.items.length ? el('ul', { class: 'wtop3' }, ...s.items.slice(0, 3).map((x) => el('li', {}, el('a', { href: safeUrl(x.url), target: '_blank', rel: 'noopener noreferrer', text: x.title.split(' — ')[0] }), el('span', { class: 'dsrc', text: ` ・${x.source}` })))) : el('p', { class: 'dempty', text: '目前沒有符合的文章。' })));
      }
      c.append(grid);
    }
    c.append(el('p', { class: 'lede wfoot', text: store.kind === 'local'
      ? '目前追蹤清單只存在這個瀏覽器（清除瀏覽資料會一併清掉）。登入與跨裝置同步需要接外部帳號服務，規劃中；現在可用「匯出／匯入」手動搬移。'
      : '追蹤清單已與你的帳號同步。' }));
    return c;
  }

  // ───────── 主要事件 ─────────
  function eventsCard({ analysis, byId, indName, now, ev, onChange }) {
    const c = card('c-6', '近期主要事件（AI 分群）', '把報導同一件事的文章放在一起，看出誰先報導、如何擴散。AI 只依標題判斷，請以原文為準。');
    const events = (analysis && !analysis.empty && analysis.events) || [];
    if (!events.length) { c.append(el('p', { class: 'dempty', text: '尚無事件分群。AI 排程任務執行後會在這裡列出（每個事件都附上引用的原始文章）。' })); return c; }
    const gen = Date.parse(analysis.generatedAt), age = (now - gen) / 36e5;
    c.append(el('p', { class: 'aibadge' }, el('span', { class: 'tagai', text: 'AI 整理' }), ` ${fmtTime(gen)}（${ago(gen, now)}）`, age > 12 || (analysis.failStreak ?? 0) > 0 ? el('span', { class: 'stale', text: ' ・可能已過時' }) : null));
    for (const e of events.slice(0, 5)) {
      const its = e.itemIds.map((id) => byId.get(id)).filter(Boolean).sort((a, b) => D.timeOf(a) - D.timeOf(b));
      if (its.length < 2) continue;
      const srcs = new Set(its.map((x) => x.source));
      const firstGl = its.find((x) => x.region !== 'tw'), firstTw = its.find((x) => x.region === 'tw');
      let lead = null;
      if (firstGl && firstTw) { const h = (D.timeOf(firstTw) - D.timeOf(firstGl)) / 36e5; lead = h >= 0 ? `國際（${firstGl.source}）先於台灣（${firstTw.source}）${h < 1 ? Math.round(h * 60) + ' 分鐘' : h.toFixed(1) + ' 小時'}` : `台灣（${firstTw.source}）先於國際（${firstGl.source}）${(-h).toFixed(1)} 小時`; }
      // 產業標籤：AI 有填就用；沒填則由事件內文章已分類的產業推導（出現最多的前 2 個），更一致也不依賴 AI
      const cnt = new Map(); for (const x of its) for (const i of x.inds || []) cnt.set(i, (cnt.get(i) || 0) + 1);
      const evInds = (e.industries && e.industries.length ? e.industries : [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([i]) => i));
      c.append(el('div', { class: 'event' },
        el('h3', { text: e.name }), el('p', { class: 'esum', text: e.summary }),
        el('div', { class: 'dchips' }, el('span', { class: 'pill', text: `${its.length} 篇` }), el('span', { class: 'pill', text: `${srcs.size} 個來源` }), el('span', { class: 'pill', text: `台灣 ${its.filter((x) => x.region === 'tw').length}／國際 ${its.filter((x) => x.region !== 'tw').length}` }), ...evInds.map((i) => el('span', { class: 'pill alt', text: indName[i] || i }))),
        lead ? el('p', { class: 'dlead', text: lead }) : null,
        el('ol', { class: 'cites' }, ...its.slice(0, 4).map((x, i) => el('li', {}, el('span', { class: 'cn', text: `[${i + 1}]` }), el('a', { href: safeUrl(x.url), target: '_blank', rel: 'noopener noreferrer', text: x.title.split(' — ')[0] }), el('span', { class: 'dsrc', text: ` ・${x.source}・${fmtTime(D.timeOf(x))}` })))),
        its.length > 4 ? el('button', { type: 'button', class: 'linklike', text: `查看全部 ${its.length} 篇`, onclick: () => ev({ title: e.name, sub: e.summary, items: its, onChange }) }) : null));
    }
    return c;
  }

  // ───────── 趨勢 ─────────
  function trendCard({ history, indRows, indName, now, trendOf, days, ev, onChange }) {
    const c = card('full', '趨勢與動能', '看哪個產業比平常更受關注（昨日 vs 之前日均）。');
    if (days < 3) {
      const start = history?.startedAt ? D.taipeiDay(Date.parse(history.startedAt)) : D.taipeiDay(now);
      c.append(el('div', { class: 'accum' }, el('strong', { text: `歷史累積中：目前有 ${days} 個完整日` }),
        el('p', { text: `本站從 ${start} 開始每天累積。上線當天（存量）與今天（只過一部分）不納入計算，所以還不能比較。滿 3 個完整日會顯示「昨日 vs 日均」，滿 14 個完整日會顯示週成長。` })));
      return c;
    }
    const tbl = el('table', {}, el('thead', {}, el('tr', {}, ...['產業', '近期走勢', '昨日', '前日均', '變化', '週成長'].map((h) => el('th', { scope: 'col', text: h })))), el('tbody'));
    for (const r of indRows.slice(0, 10)) {
      const t = trendOf('industry', r.key);
      tbl.tBodies[0].append(el('tr', {}, el('td', { text: indName[r.key] }), el('td', {}, spark(t.series)), el('td', { class: 'n', text: t.daily ? String(t.daily.last) : '—' }), el('td', { class: 'n', text: t.daily ? String(t.daily.avg) : '—' }),
        el('td', { class: 'n', text: t.daily?.change != null ? `${t.daily.change > 0 ? '+' : ''}${t.daily.change}%` : '—' }), el('td', { class: 'n', text: t.weekly?.change != null ? `${t.weekly.change > 0 ? '+' : ''}${t.weekly.change}%` : (days >= 14 ? '—' : '需 14 天') })));
    }
    c.append(el('div', { class: 'tbl-wrap' }, tbl), el('p', { class: 'lede', style: 'margin-top:8px', text: `依 ${days} 個完整日計算；樣本天數越少越不穩定，請謹慎解讀。` }));
    return c;
  }

  // ───────── AI 今日重點摘要（附引用）─────────
  function briefCard({ analysis, byId, now, ev }) {
    const c = card('full', 'AI 今日重點', null);
    const gen = Date.parse(analysis.generatedAt);
    c.append(el('p', { class: 'aibadge' }, el('span', { class: 'tagai', text: 'AI 整理' }), ` ${fmtTime(gen)}（${ago(gen, now)}）・只依標題與來源資料判斷，請以原文為準`));
    c.append(el('p', { class: 'lead2', text: analysis.summary }));
    const acts = (analysis.actions || []).slice(0, 3);
    if (acts.length) c.append(el('ol', { class: 'acts' }, ...acts.map((a) => el('li', { class: a.urgency === 'high' ? 'high' : '' },
      el('strong', { text: a.title }), a.urgency === 'high' ? el('span', { class: 'urg', text: '緊急' }) : null, el('p', { text: a.why }),
      el('div', { class: 'dchips' }, ...(a.cves || []).map((cv) => el('a', { href: `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cv)}`, target: '_blank', rel: 'noopener noreferrer', text: cv })),
        ...(a.itemIds || []).map((id) => byId.get(id)).filter(Boolean).map((x) => el('a', { href: safeUrl(x.url), target: '_blank', rel: 'noopener noreferrer', text: `${x.title.split(' — ')[0].slice(0, 28)}…（${x.source}）` })))))));
    return c;
  }

  root.DevDash = { render, openEvidence, closeDrawer };
})(typeof self !== 'undefined' ? self : globalThis);
