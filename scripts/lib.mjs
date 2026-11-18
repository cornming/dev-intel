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

// 關鍵字 → 主題標籤（大小寫不分；英文用單字邊界，避免 "ai" 命中 "maintain"）
const TAG_RULES = [
  ['AI', /\b(ai|llm|gpt|claude|gemini|openai|anthropic|copilot|agent|agents|machine learning|deep learning|diffusion|rag|mcp)\b|人工智慧|大型語言模型|生成式|AI代理|智慧體/i],
  ['資安', /\b(security|vulnerabilit\w*|cve-\d+|exploit|malware|ransomware|breach|zero-day|phishing|supply chain attack)\b|資安|漏洞|駭客|惡意程式|勒索|外洩|釣魚/i],
  ['雲端', /\b(aws|azure|gcp|cloud|kubernetes|k8s|docker|serverless|terraform|devops|ci\/cd|sre)\b|雲端|容器/i],
  ['前端', /\b(javascript|typescript|react|vue|svelte|angular|css|html|frontend|front-end|browser|webassembly|wasm|node\.?js|deno|bun|next\.?js)\b|前端|瀏覽器/i],
  ['後端', /\b(backend|api|database|postgres\w*|mysql|sqlite|redis|kafka|microservices?|sql|graphql)\b|資料庫|後端/i],
  ['語言', /\b(rust|golang|go|python|java|kotlin|swift|c\+\+|c#|\.net|zig|php|ruby|elixir|haskell|lua)\b/i],
  ['行動', /\b(android|ios|flutter|react native|mobile|swiftui|jetpack)\b|行動應用|手機/i],
  ['開源', /\b(open[- ]source|oss|foss|github|gitlab|linux|license|maintainer)\b|開源|開放原始碼/i],
  ['職場', /\b(career|hiring|layoffs?|salary|interview|remote work|burnout|job)\b|面試|薪水|薪資|轉職|求職|裁員|工作|職涯|心得|職缺|offer/i],
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
      it.hot = Number(((0.15 + 0.85 * pct) * (weights[source] ?? 1) / (1 + ageH / 24)).toFixed(4));
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

// 排名後排序；過期保留的項目打五折，並限制總數
export function finalize(items, weights, now = Date.now(), cap = 400) {
  rankItems(items, weights, now);
  for (const it of items) if (it.stale) it.hot = Number((it.hot * 0.5).toFixed(4));
  return items.sort((a, b) => b.hot - a.hot).slice(0, cap);
}
