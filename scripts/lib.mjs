// 純函式：解析、正規化、分類、排序、合併。不碰網路，方便測試。
import { createHash } from 'node:crypto';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s = '') {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function cleanText(s = '') {
  return decodeEntities(
    s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

function tagContent(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

// 只接受 https 圖片（網站是 https，http 圖片會被瀏覽器擋掉），並略過追蹤像素與 gif
export function cleanImageUrl(raw, base) {
  if (!raw) return null;
  try {
    const u = new URL(decodeEntities(String(raw).trim()), base);
    if (u.protocol !== 'https:' || u.href.length > 600) return null;
    if (/(feedburner|pixel|tracker|tracking|1x1|spacer)/i.test(u.href) || /\.gif($|\?)/i.test(u.pathname)) return null;
    // Medium 的圖片 CDN 支援指定寬度；卡片只需要約 600px，原圖常超過 1.5 MB
    if (u.hostname === 'cdn-images-1.medium.com') u.pathname = u.pathname.replace(/^\/max\/\d+\//, '/max/600/');
    return u.href;
  } catch {
    return null;
  }
}

// 從 RSS/Atom 的一個項目區塊找圖：media:content → media:thumbnail → enclosure → 內文第一張 <img>
export function feedImage(block, base) {
  const text = decodeEntities(block.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
  const pats = [
    /<media:content[^>]*\burl=["']([^"']+)["']/i,
    /<media:thumbnail[^>]*\burl=["']([^"']+)["']/i,
    /<enclosure[^>]*\btype=["']image\/[^"']*["'][^>]*\burl=["']([^"']+)["']/i,
    /<enclosure[^>]*\burl=["']([^"']+)["'][^>]*\btype=["']image\//i,
    /<img[^>]*\bsrc=["']([^"']+)["']/i,
  ];
  for (const re of pats) {
    const m = text.match(re);
    const img = m && cleanImageUrl(m[1], base);
    if (img) return img;
  }
  return null;
}

// 從文章頁面 HTML 取 og:image（屬性順序不固定，所以兩種順序都試）
export function extractOgImage(html = '', baseUrl) {
  const head = html.slice(0, 300000);
  const keys = ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src'];
  for (const key of keys) {
    const k = key.replace(/[:.]/g, '\\$&');
    const a = head.match(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*\\bcontent=["']([^"']+)["']`, 'i'));
    const b = head.match(new RegExp(`<meta[^>]+\\bcontent=["']([^"']+)["'][^>]*(?:property|name)=["']${k}["']`, 'i'));
    const img = cleanImageUrl((a ?? b)?.[1], baseUrl);
    if (img) return img;
  }
  return null;
}

// 同時支援 RSS 2.0 (<item>) 與 Atom (<entry>)
export function parseFeed(xml = '') {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  return blocks.map((b) => {
    const title = cleanText(tagContent(b, 'title'));
    let link = cleanText(tagContent(b, 'link'));
    if (!link) {
      const m = b.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = m ? decodeEntities(m[1]) : '';
    }
    const date = cleanText(tagContent(b, 'pubDate') || tagContent(b, 'published') || tagContent(b, 'updated') || tagContent(b, 'dc:date'));
    const t = Date.parse(date);
    return { title, link, time: Number.isNaN(t) ? null : new Date(t).toISOString(), image: feedImage(b, link) };
  }).filter((x) => x.title && /^https?:\/\//.test(x.link));
}

export function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|ref$|ref_src$)/i.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.replace(/^www\./, '').toLowerCase();
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    const s = u.toString();
    return s.endsWith('/') ? s.slice(0, -1) : s;
  } catch {
    return raw;
  }
}

// 有些來源的連結帶追蹤參數（iT邦幫忙 ?sc=rss.qu、Medium ?source=rss-...），存起來前整個查詢字串去掉
export function stripQuery(raw) {
  try { const u = new URL(raw); u.search = ''; u.hash = ''; return u.toString(); } catch { return raw; }
}

export const idFor = (url) => createHash('sha1').update(normalizeUrl(url)).digest('hex').slice(0, 12);

// 關鍵字 → 主題標籤（大小寫不分）。
// 每條規則拆成「en」（英文詞，兩側要有邊界）與「zh」（中文詞，直接比對）。
// 邊界用 (?<![A-Za-z0-9_]) 與 (?![A-Za-z0-9_]) 而不是 \b：\b 遇到結尾是符號的詞（.NET、C#、C++）永遠不成立；
// 而且中文緊貼英文時（例如「銀行App」「AI代理」）仍然算有邊界。
// 順序＝優先順序：每則最多保留 3 個標籤，排前面的先保留。
// 原則：寧可漏標也不要亂標；避免太籠統的詞（「工作」、job、app、shell、offer、ip 等）。
const RULES = [
  ['AI', {
    en: 'ai|a\\.i\\.|llms?|gpt[\\w-]*|claude|gemini|gemma|openai|anthropic|copilot|chatgpt|codex|agentic|agents?|machine learning|deep learning|ml|nlp|neural|diffusion|rag|mcp|qwen\\d*|deepseek|llama|mistral|grok|kimi|ollama|hugging ?face|transformers?|embeddings?|prompts?|inference|fine-?tun\\w*|lora|local models?|foundation models?|generative',
    zh: '人工智慧|大型語言模型|生成式|AI ?代理|智慧體|大模型|機器學習|深度學習|語言模型',
  }],
  ['職場', {
    en: 'careers?|hiring|layoffs?|salary|salaries|interviews?|resume|burnout|job (?:search|market|hunt|offers?|interview)|counter-?offer|offer letter|remote work|promotion|onboarding|mentor(?:ing|ship)?|(?:junior|senior|staff|principal) (?:software )?(?:engineers?|developers?|devs?)|engineering managers?|tech lead|workplace|work-life|coworkers?',
    zh: '面試|薪水|薪資|轉職|求職|裁員|資遣|職涯|職缺|工作機會|找工作|離職|加班|上班族|升遷|加薪|新鮮人|履歷|轉行|工程師的',
  }],
  ['資安', {
    en: 'security|vulnerabilit\\w*|cves?(?:-\\d+)?|exploit\\w*|rce|malware|ransomware|breach(?:es)?|zero-?days?|phishing|ddos|backdoor|cyber(?:security|attacks?|crime|criminals?|threats?)|privacy|encryption|supply chain attack|phrack|tor|attacks?|attackers?|hijack\\w*|(?<!memory )leak(?:s|ed|age)?|credentials?|secrets?|iam|sso|oauth|authenticat\\w*|authoriz\\w*|threats?|gdpr|osint|pentest\\w*|red team|blue team|sandbox\\w*|spoof\\w*|cryptograph\\w*|tls|ssl|firewalls?|fuzz\\w*|csrf|xss|nosniff',
    zh: '資安|漏洞|駭客|惡意程式|勒索|外洩|釣魚|網路攻擊|資料遭|遭駭|隱私|加密|入侵|詐騙|零時差|供應鏈攻擊|身分驗證|攻擊者|安全標頭',
  }],
  ['雲端', {
    en: 'aws|azure|gcp|cloud\\w*|kubernetes|k8s|docker|containers?|serverless|terraform|devops|ci\\/cd|sre|redshift|datacenters?|github actions|lambda|bedrock|ec2|vercel|netlify|cloudflare|helm|infrastructure as code|iac',
    zh: '雲端|容器|資料中心|無伺服器',
  }],
  ['前端', {
    en: 'javascript|typescript|js|ts|react|vue|nuxt|svelte|solid(?:\\.?js)?|angular|jquery|htmx|tailwind\\w*|vite|webpack|css|html|frontend|front-end|browsers?|chrome|firefox|safari|webassembly|wasm|webgpu|node\\.?js|deno|bun|next\\.?js|three\\.?js|wordpress|pwa|web (?:apps?|sites?|dev\\w*|pages?|components?)|webdev|ui|ux|browser extensions?|chrome extensions?',
    zh: '前端|瀏覽器|網頁|網站設計',
  }],
  ['後端', {
    en: 'backend|back-end|apis?|databases?|postgres\\w*|mysql|mariadb|sqlite|mongodb|redis|redict|kafka|microservices?|sql|graphql|iceberg|data (?:lakes?|warehouses?)|orm|message queues?|spring boot|django|flask|fastapi|laravel|rails|grpc|restful|server-?side|middleware',
    zh: '資料庫|後端|資料倉儲|微服務',
  }],
  ['網路', {
    en: 'networking|(?<!neural |social )networks?|tcp|udp|ipv[46]|ip (?:address|route|routing)|dns|https?|quic|vpn|bgp|routing|routers?|latency|bandwidth|packets?|tcpdump|wireshark|mtu|smtp|imap|nginx|(?:reverse|http|socks|web) prox(?:y|ies)|proxy servers?|cdn|websockets?|webrtc|wi-?fi|5g|ethernet|snmp|nslookup|dmarc|dkim|spf',
    // 「網路」本身太籠統：網路攻擊／網路安全屬於資安，神經網路屬於 AI，社群網路、網路購物等不是技術主題
    zh: '(?<!神經|社群)網路(?!攻擊|安全|購物|詐騙|犯罪|霸凌|行銷|直播|名人|紅人|平台|新聞|媒體)|封包|網卡|路由|頻寬|延遲|郵件伺服器|代理伺服器|反解',
  }],
  ['語言', {
    en: 'rust|golang|python|java|kotlin|(?<!taylor )swift(?! (?:payment|code|bank))|c\\+\\+|c#|f#|\\.net|asp\\.net|dotnet|zig|php|ruby|elixir|haskell|lua|nim|nimony|ocaml|scala|clojure|perl|lisp|dart|jvm|powershell|compilers?|programming languages?|programming|go (?:1\\.\\d+|modules?|routines?)|in go|c (?:language|standard|23|26)|c’s|java\\d\\w*',
    zh: '程式語言|編譯器|程式設計|寫程式',
  }],
  ['行動', {
    en: 'android|ios|ipados|iphones?|ipads?|flutter|react native|swiftui|jetpack(?: compose)?|kotlin multiplatform|mobile(?: apps?| dev\\w*)?|(?:android|ios|iphone) apps?',
    zh: '行動應用|手機|行動裝置|(?<=[\\u4e00-\\u9fff])app(?![a-z])',
  }],
  ['系統', {
    en: 'windows|macos|linux|ubuntu|debian|fedora|nixos|nix|kernel|(?:free|open|net)?bsd|firmware|operating systems?|unix|systemd|wsl|gnome|kde|arch linux',
    zh: '作業系統|韌體',
  }],
  ['開發工具', {
    en: 'git|github|gitlab|vim|neovim|emacs|vscode|vs code|jetbrains|intellij|ide|editors?|cli|terminal|debugg\\w*|linters?|build systems?|package managers?|npm|pip|cargo|readme|pull requests?|code review|devtools|sdk|formatter',
    zh: '開發工具|開發者|程式碼|軟體臭蟲|除錯|程式碼審查',
  }],
  ['開源', {
    en: 'open[- ]source|oss|foss|licen[sc]es?|maintainers?|copyleft|gpl|hacktoberfest',
    zh: '開源|開放原始碼',
  }],
  ['硬體', {
    en: 'nvidia|amd|intel|tsmc|chips?|semiconductors?|gpus?|cpus?|asic|fpga|robots?|robotics|drones?|iot|hardware|quantum|rtx|raspberry pi|arduino|esp32|risc-v|sensors?|3d print\\w*',
    zh: '輝達|晶片|半導體|台積電|機器人|無人機|伺服器|量子|感測器',
  }],
  ['產業', {
    en: 'revenues?|earnings|acquir\\w*|acquisitions?|merger|ipo|valuation|funding|startups?|stocks?|antitrust|bitcoin|crypto\\w*|blockchain',
    zh: '營收|收購|併購|股價|目標價|財報|獲利|市值|募資|新創|比特幣|加密貨幣|區塊鏈',
  }],
  ['政策', {
    en: 'laws?|legal|lawsuits?|copyright|regulations?|bans?|gdpr|court|sues?|policy|government|congress|eu|fcc|ftc|doj',
    zh: '法規|法院|禁令|監管|法案|政府|出口管制|訴訟|起訴',
  }],
];

const BEFORE = '(?<![A-Za-z0-9_])';
const AFTER = '(?![A-Za-z0-9_])';
export const TAG_RULES = RULES.map(([tag, { en, zh }]) => [tag, new RegExp(`${BEFORE}(?:${en})${AFTER}${zh ? `|${zh}` : ''}`, 'i')]);

export function tagsFor(text = '') {
  return TAG_RULES.filter(([, re]) => re.test(text)).map(([t]) => t).slice(0, 3);
}

// 每個來源內以名次百分位為基準（分數單位各站不同，不能直接比），再乘來源權重並隨時間衰減
export function rankItems(items, weights = {}, now = Date.now()) {
  const bySource = new Map();
  for (const it of items) {
    if (!bySource.has(it.source)) bySource.set(it.source, []);
    bySource.get(it.source).push(it);
  }
  for (const [source, list] of bySource) {
    const hasScore = list.some((x) => x.score > 0);
    const sorted = [...list].sort((a, b) => (hasScore ? (b.score ?? 0) - (a.score ?? 0) : a.order - b.order));
    sorted.forEach((it, i) => {
      const pct = list.length > 1 ? 1 - i / (list.length - 1) : 1;
      const ageH = Math.max(0, (now - Date.parse(it.time ?? it.firstSeen ?? now)) / 36e5);
      // 沒有分數的來源（RSS）名次只代表「新舊」，不是人氣，所以上限壓低到 0.7
      const base = hasScore ? 0.15 + 0.85 * pct : 0.15 + 0.55 * pct;
      it.hot = Number((base * (weights[source] ?? 1) / (1 + ageH / 24)).toFixed(4));
    });
  }
  return items;
}

// 同一篇文章在多個站出現時合併，保留分數最高者並記下其他出處
export function dedupe(items) {
  const map = new Map();
  for (const it of items) {
    const key = normalizeUrl(it.url);
    const cur = map.get(key);
    if (!cur) { map.set(key, { ...it, alsoOn: [] }); continue; }
    const [keep, drop] = (it.score ?? 0) > (cur.score ?? 0) ? [it, cur] : [cur, it];
    const merged = { ...keep, alsoOn: [...new Set([...(cur.alsoOn ?? []), ...(it.alsoOn ?? []), drop.source])].filter((s) => s !== keep.source) };
    if (!merged.discuss && drop.discuss) merged.discuss = drop.discuss;
    map.set(key, merged);
  }
  return [...map.values()];
}

// 上一輪抓到、這輪沒抓到的項目暫時保留（避免來源暫時故障時整區消失），超過 ttl 才移除
// 被保留的舊項目沿用的是「抓取當時」的標籤；規則改過後要立刻生效，所以用目前規則重算並保留舊標籤當備援
// （舊標籤可能含來源自帶的標籤，單看標題不一定找得回來）。職場來源的項目一律以「職場」開頭。
export function retag(it) {
  const merged = [...(it.kind === 'job' ? ['職場'] : []), ...tagsFor(it.title ?? ''), ...(it.tags ?? [])];
  return [...new Set(merged)].slice(0, 3);
}

export function mergeHistory(prev = [], fresh = [], now = Date.now(), ttlMs = 72 * 36e5) {
  const nowIso = new Date(now).toISOString();
  const prevById = new Map(prev.map((x) => [x.id, x]));
  const freshIds = new Set(fresh.map((x) => x.id));
  const merged = fresh.map((x) => {
    const old = prevById.get(x.id);
    return {
      ...x, firstSeen: old?.firstSeen ?? nowIso, stale: false,
      // 圖片只抓一次：沿用上一輪的結果（含「已查過但沒有圖」）
      image: x.image ?? old?.image ?? null,
      imgChecked: !!(x.image || old?.imgChecked),
    };
  });
  for (const old of prev) {
    if (freshIds.has(old.id)) continue;
    if (now - Date.parse(old.firstSeen ?? nowIso) > ttlMs) continue;
    merged.push({ ...old, stale: true, tags: retag(old) });
  }
  return merged;
}

// 多樣性：同一來源在榜上每多出現一則就乘上 DIVERSITY，讓不同來源交錯而不是單一來源連續霸榜
export const DIVERSITY = 0.93;

export function diversify(sortedItems, factor = DIVERSITY) {
  const seen = new Map();
  for (const it of sortedItems) {
    const k = seen.get(it.source) ?? 0;
    seen.set(it.source, k + 1);
    it.hot = Number((it.hot * factor ** k).toFixed(4));
  }
  return sortedItems.sort((a, b) => b.hot - a.hot);
}

// 排名後排序；過期保留的項目打五折，再做多樣性調整，最後限制總數
export function finalize(items, weights, now = Date.now(), cap = 400) {
  rankItems(items, weights, now);
  for (const it of items) if (it.stale) it.hot = Number((it.hot * 0.5).toFixed(4));
  items.sort((a, b) => b.hot - a.hot);
  return diversify(items).slice(0, cap);
}

// 來源健康：記錄各來源「連續失敗幾輪」，連續失敗達門檻就視為異常（交給 CI 轉紅通知）
export const FAIL_THRESHOLD = 3;

export function nextStreaks(prevSources = [], results = []) {
  const prev = new Map(prevSources.map((s) => [s.name, s.failStreak ?? 0]));
  return results.map((r) => ({ ...r, failStreak: r.ok ? 0 : (prev.get(r.name) ?? 0) + 1 }));
}

export function unhealthy(sources = [], threshold = FAIL_THRESHOLD) {
  return sources.filter((s) => (s.failStreak ?? 0) >= threshold);
}

// 檢查上一輪快照格式是否可用（從已部署網站取回時，避免吃進壞資料）
export function isValidSnapshot(x) {
  return !!x && Array.isArray(x.items) && x.items.every((i) => i && typeof i.id === 'string' && typeof i.url === 'string')
    && (x.sources === undefined || Array.isArray(x.sources));
}

// ── 來源類型（借鏡「來源透明」：讓讀者知道每則來自官方、媒體還是社群）──
export const SOURCE_TYPES = {
  'Hacker News': 'community', Lobsters: 'community', DEV: 'community', 'DEV 職涯': 'community', 'Lobsters 職場文化': 'community',
  'GitHub 新星專案': 'repo', 'GitHub Blog': 'official',
  'iT邦幫忙': 'community', 'Medium 軟體工程師': 'community', 'Medium 轉職': 'community', 'Medium 職涯': 'community', INSIDE: 'media',
  iThome: 'media', 'TechNews 科技新報': 'media', TechOrange: 'media',
};
export const sourceTypeOf = (name) => SOURCE_TYPES[name] ?? 'media';

// ── AI 分析：輸入組裝與輸出驗證 ──
// 輸入只含標題與統計資料；輸出一律不信任，逐欄驗證並丟棄無法對應到真實項目的內容。
const clip = (s, n) => String(s ?? '')
  .replace(/https?:\/\/\S+/gi, '')            // 不接受 AI 產生的網址（連結只能來自我們自己的資料）
  .replace(/[<>`]/g, '')                       // 不留標記字元
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, n);

export function buildAnalysisInput(items, kev, limit = 70) {
  const top = items.filter((x) => !x.stale).slice(0, limit).map((x) => ({
    id: x.id, source: x.source, type: sourceTypeOf(x.source), title: clip(x.title, 140),
    score: x.score ?? 0, comments: x.comments ?? 0, tags: x.tags, sources: 1 + (x.alsoOn?.length ?? 0),
  }));
  const kevRows = (kev?.latest ?? []).slice(0, 8).map((v) => ({
    cve: v.cve, vendor: clip(v.vendor, 40), product: clip(v.product, 60), name: clip(v.name, 100),
    added: v.added, due: v.due, ransomware: !!v.ransomware,
  }));
  return { items: top, kev: kevRows };
}

const arr = (x, max) => (Array.isArray(x) ? x.slice(0, max) : []);
const int = (n, lo, hi, d) => (Number.isFinite(+n) ? Math.min(hi, Math.max(lo, Math.round(+n))) : d);

export function validateAnalysis(raw, validIds, validCves) {
  if (!raw || typeof raw !== 'object') return null;
  const ids = validIds instanceof Set ? validIds : new Set(validIds);
  const cves = validCves instanceof Set ? validCves : new Set(validCves);
  const seen = new Set();

  const actions = arr(raw.actions, 5).map((a) => ({
    title: clip(a?.title, 60), why: clip(a?.why, 160),
    urgency: a?.urgency === 'high' ? 'high' : 'medium',
    itemIds: arr(a?.itemIds, 3).filter((id) => ids.has(id)),
    cves: arr(a?.cves, 3).filter((c) => /^CVE-\d{4}-\d{4,}$/.test(c) && cves.has(c)),
  })).filter((a) => a.title && a.why);

  const highlights = arr(raw.highlights, 8).map((h) => ({
    itemId: h?.itemId, summary: clip(h?.summary, 160), impact: clip(h?.impact, 120), importance: int(h?.importance, 1, 5, 3),
  })).filter((h) => ids.has(h.itemId) && h.summary && !seen.has(h.itemId) && seen.add(h.itemId));

  const divergences = arr(raw.divergences, 3).map((d) => ({
    topic: clip(d?.topic, 60),
    claims: arr(d?.claims, 4).map((c) => ({ source: clip(c?.source, 30), claim: clip(c?.claim, 100) })).filter((c) => c.source && c.claim),
    judgement: clip(d?.judgement, 150),
  })).filter((d) => d.topic && d.claims.length >= 2 && d.judgement);

  const glossary = arr(raw.glossary, 6).map((g) => ({ term: clip(g?.term, 30), definition: clip(g?.definition, 120), why: clip(g?.why, 120) }))
    .filter((g) => g.term && g.definition);

  const summary = clip(raw.summary, 300);
  if (!summary && !actions.length && !highlights.length) return null;
  return { summary, actions, highlights, divergences, glossary };
}

// 同一來源有 minCount 則以上共用同一張圖，多半是網站的預設分享圖／站徽（例如 iT邦幫忙的 fbpic.jpg），不是文章封面。
// 把它們清掉（image 設為 null；imgChecked 維持 true，不會再去抓），卡片會顯示預設封面。
export function dropSharedImages(items, minCount = 3) {
  const count = new Map();
  for (const it of items) if (it.image) { const k = `${it.source}\u0000${it.image}`; count.set(k, (count.get(k) ?? 0) + 1); }
  let dropped = 0;
  for (const it of items) {
    if (it.image && count.get(`${it.source}\u0000${it.image}`) >= minCount) { it.image = null; it.imgChecked = true; dropped++; }
  }
  return dropped;
}
