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
    return { title, link, time: Number.isNaN(t) ? null : new Date(t).toISOString() };
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

export const idFor = (url) => createHash('sha1').update(normalizeUrl(url)).digest('hex').slice(0, 12);

// 關鍵字 → 主題標籤（大小寫不分）。
// 英文一律用單字邊界 \b，避免 "ai" 命中 "maintain"；中文則直接比對詞。
// 順序＝優先順序：每則最多保留 3 個標籤，排前面的先保留。
// 刻意避免太籠統的詞（例如「工作」會誤中「工作負載」、"job" 會誤中 cron job）。
const TAG_RULES = [
  ['AI', /\b(ai|a\.i\.|llm|llms|gpt[\w-]*|claude|gemini|openai|anthropic|copilot|chatgpt|agentic|agents?|machine learning|deep learning|neural|diffusion|rag|mcp|qwen\d*|deepseek|llama|mistral|grok|prompts?|inference|fine-?tun\w*)\b|人工智慧|大型語言模型|生成式|AI ?代理|智慧體|大模型|機器學習|深度學習/i],
  ['職場', /\b(careers?|hiring|layoffs?|salary|salaries|interviews?|resume|burnout|job (search|market|hunt|offer|interview)|remote work|promotion|onboarding|offers?)\b|面試|薪水|薪資|轉職|求職|裁員|資遣|職涯|職缺|工作機會|找工作|離職|加班|上班族/i],
  ['資安', /\b(security|vulnerabilit\w*|cves?(-\d+)?|exploits?|rce|malware|ransomware|breach(es)?|zero-?days?|phishing|ddos|backdoor|cyber\w*|privacy|encryption|supply chain attack|phrack|tor)\b|資安|漏洞|駭客|惡意程式|勒索|外洩|釣魚|網路攻擊|資料遭|遭駭|隱私|加密/i],
  ['雲端', /\b(aws|azure|gcp|cloud\w*|kubernetes|k8s|docker|containers?|serverless|terraform|devops|ci\/cd|sre|redshift|datacenters?)\b|雲端|容器|資料中心/i],
  ['前端', /\b(javascript|typescript|js|ts|react|vue|svelte|solid(\.?js)?|angular|jquery|htmx|tailwind|vite|webpack|css|html|frontend|front-end|browsers?|chrome|firefox|safari|webassembly|wasm|node\.?js|deno|bun|next\.?js)\b|前端|瀏覽器/i],
  ['後端', /\b(backend|back-end|apis?|databases?|postgres\w*|mysql|mariadb|sqlite|mongodb|redis|redict|kafka|microservices?|sql|graphql|iceberg|data (lake|warehouse))\b|資料庫|後端|資料倉儲/i],
  ['語言', /\b(rust|golang|python|java|kotlin|swift|c\+\+|c#|\.net|zig|php|ruby|elixir|haskell|lua|nim|nimony|ocaml|scala|clojure|perl|lisp|compilers?|programming languages?)\b|\bgo (1\.\d+|modules?|routines?)\b|\bin go\b|\bc (language|standard|23|26)\b|\bc’s\b|java\d\w*|程式語言|編譯器/i],
  ['行動', /\b(android|ios|ipados|flutter|react native|mobile|swiftui|jetpack|apps?)\b|行動應用|手機/i],
  ['系統', /\b(windows|macos|linux|ubuntu|debian|kernel|bsd|firmware|operating systems?|unix)\b|作業系統|韌體/i],
  ['開發工具', /\b(git|github|gitlab|vim|neovim|emacs|vscode|ide|editors?|cli|terminal|shell|debugg\w*|linters?|build systems?|package managers?|npm|pip|cargo|readme)\b|開發工具|開發者|程式碼|軟體臭蟲|\bbugs?\b/i],
  ['開源', /\b(open[- ]source|oss|foss|licen[sc]es?|maintainers?|copyleft|gpl|hacktoberfest)\b|開源|開放原始碼/i],
  ['硬體', /\b(nvidia|amd|intel|tsmc|chips?|semiconductors?|gpus?|cpus?|asic|fpga|robots?|robotics|drones?|iot|hardware|quantum)\b|輝達|晶片|半導體|台積電|機器人|無人機|伺服器|量子/i],
  ['產業', /\b(revenues?|earnings|acquir\w*|acquisitions?|merger|ipo|valuation|funding|startups?|stocks?|antitrust|bitcoin|crypto\w*|blockchain)\b|營收|收購|併購|股價|目標價|財報|獲利|市值|募資|新創|比特幣|加密貨幣|區塊鏈/i],
  ['政策', /\b(laws?|legal|lawsuits?|copyright|regulations?|bans?|gdpr|court|sues?|policy|government|congress|eu)\b|法規|法院|禁令|監管|法案|政府|出口管制|訴訟/i],
];

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
export function mergeHistory(prev = [], fresh = [], now = Date.now(), ttlMs = 72 * 36e5) {
  const nowIso = new Date(now).toISOString();
  const prevById = new Map(prev.map((x) => [x.id, x]));
  const freshIds = new Set(fresh.map((x) => x.id));
  const merged = fresh.map((x) => ({ ...x, firstSeen: prevById.get(x.id)?.firstSeen ?? nowIso, stale: false }));
  for (const old of prev) {
    if (freshIds.has(old.id)) continue;
    if (now - Date.parse(old.firstSeen ?? nowIso) > ttlMs) continue;
    merged.push({ ...old, stale: true });
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
