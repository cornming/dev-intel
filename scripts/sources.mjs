// 各來源抓取器：每個都回傳統一格式的項目陣列，單一來源失敗不影響其他來源。
import { parseFeed, idFor, tagsFor, cleanImageUrl } from './lib.mjs';

const UA = 'dev-intel/1.0 (+https://github.com/cornming/dev-intel)';
const TIMEOUT_MS = 20000;

async function get(url, { json = false, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: json ? 'application/json' : '*/*', ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return json ? res.json() : res.text();
}

// 職場來源的項目一律帶「職場」標籤（排最前面），其餘依關鍵字規則
function tagsOf(kind, text) {
  const t = tagsFor(text);
  return kind === 'job' ? ['職場', ...t.filter((x) => x !== '職場')].slice(0, 3) : t;
}

function mk(source, region, kind, o, order) {
  return {
    id: idFor(o.url), title: o.title, url: o.url, source, region, kind,
    score: o.score ?? 0, comments: o.comments ?? 0, discuss: o.discuss ?? null,
    time: o.time ?? null, tags: tagsOf(kind, `${o.title} ${o.extra ?? ''}`), order,
    image: cleanImageUrl(o.image) ?? null,
  };
}

async function mapLimit(arr, limit, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < arr.length) { const n = i++; out[n] = await fn(arr[n], n).catch(() => null); }
  }));
  return out;
}

const hackerNews = {
  name: 'Hacker News', weight: 1.0,
  async fetch() {
    const ids = (await get('https://hacker-news.firebaseio.com/v0/topstories.json', { json: true })).slice(0, 40);
    const rows = await mapLimit(ids, 8, (id) => get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { json: true }));
    return rows.filter((r) => r && r.title && !r.dead && !r.deleted).map((r, i) => mk('Hacker News', 'global', 'news', {
      title: r.title, url: r.url || `https://news.ycombinator.com/item?id=${r.id}`,
      score: r.score, comments: r.descendants, discuss: `https://news.ycombinator.com/item?id=${r.id}`,
      time: new Date(r.time * 1000).toISOString(),
    }, i));
  },
};

const lobsters = {
  name: 'Lobsters', weight: 0.9,
  async fetch() {
    const rows = await get('https://lobste.rs/hottest.json', { json: true });
    return rows.slice(0, 30).map((r, i) => mk('Lobsters', 'global', 'news', {
      title: r.title, url: r.url || r.comments_url, score: r.score, comments: r.comment_count,
      discuss: r.comments_url, time: r.created_at, extra: (r.tags || []).join(' '),
    }, i));
  },
};

const devto = {
  name: 'DEV', weight: 0.8,
  async fetch() {
    const rows = await get('https://dev.to/api/articles?top=1&per_page=30', { json: true });
    return rows.map((r, i) => mk('DEV', 'global', 'news', {
      title: r.title, url: r.url, score: r.positive_reactions_count, comments: r.comments_count,
      discuss: r.url, time: r.published_at, extra: (r.tag_list || []).join(' '), image: r.cover_image,
    }, i));
  },
};

// 職場類：用官方 API 的標籤分類取得（DEV 的 career、Lobsters 的 culture），歸類為 job
const devtoCareer = {
  name: 'DEV 職涯', weight: 0.8,
  async fetch() {
    const rows = await get('https://dev.to/api/articles?tag=career&top=7&per_page=20', { json: true });
    return rows.map((r, i) => mk('DEV 職涯', 'global', 'job', {
      title: r.title, url: r.url, score: r.positive_reactions_count, comments: r.comments_count,
      discuss: r.url, time: r.published_at, extra: (r.tag_list || []).join(' '), image: r.cover_image,
    }, i));
  },
};

const lobstersCulture = {
  name: 'Lobsters 職場文化', weight: 0.8,
  async fetch() {
    const rows = await get('https://lobste.rs/t/culture.json', { json: true });
    return rows.slice(0, 20).map((r, i) => mk('Lobsters 職場文化', 'global', 'job', {
      title: r.title, url: r.url || r.comments_url, score: r.score, comments: r.comment_count,
      discuss: r.comments_url, time: r.created_at, extra: (r.tags || []).join(' '),
    }, i));
  },
};

// 近 7 天新建立、星數最高的 repo（GitHub 沒有官方 trending API，這是常見替代做法）
const githubRepos = {
  name: 'GitHub 新星專案', weight: 0.9,
  async fetch() {
    const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const url = `https://api.github.com/search/repositories?q=created:%3E${since}&sort=stars&order=desc&per_page=25`;
    const token = process.env.GITHUB_TOKEN;
    // 有 token 時額度較高；token 無效（401/403）就退回匿名請求
    const data = await (token ? get(url, { json: true, headers: { authorization: `Bearer ${token}` } }) : Promise.reject(new Error('no token')))
      .catch(() => get(url, { json: true }));
    return data.items.map((r, i) => ({
      ...mk('GitHub 新星專案', 'global', 'repo', {
        title: `${r.full_name}${r.description ? ' — ' + r.description : ''}`, url: r.html_url,
        score: r.stargazers_count, comments: r.forks_count, time: r.created_at,
        extra: `${r.language ?? ''} ${(r.topics || []).join(' ')}`,
        // GitHub 官方產生的專案預覽卡（Social preview），不必另外抓頁面
        image: `https://opengraph.githubassets.com/1/${r.full_name}`,
      }, i),
      lang: r.language ?? null,
    }));
  },
};

// needTag：綜合科技媒體含大量非軟體內容（股市、消費電子），只留下命中主題標籤的項目
function rssSource({ name, url, region = 'tw', kind = 'news', weight = 0.8, limit = 25, filter, needTag = false }) {
  return {
    name, weight,
    async fetch() {
      const xml = await get(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; dev-intel/1.0)' } });
      return parseFeed(xml).filter((e) => (filter ? filter(e) : true)).slice(0, limit)
        .map((e, i) => mk(name, region, kind, { title: e.title, url: e.link, time: e.time, image: e.image }, i))
        .filter((x) => !needTag || x.tags.length > 0);
    },
  };
}

export const SOURCES = [
  hackerNews, lobsters, devto, githubRepos, devtoCareer, lobstersCulture,
  rssSource({ name: 'iThome', url: 'https://www.ithome.com.tw/rss', weight: 1.0 }),
  rssSource({ name: 'TechNews 科技新報', url: 'https://technews.tw/feed/', weight: 0.8, limit: 40, needTag: true }),
  rssSource({ name: 'TechOrange', url: 'https://feeds.feedburner.com/TechOrange', weight: 0.7, needTag: true }),
  rssSource({ name: 'GitHub Blog', url: 'https://github.blog/feed/', region: 'global', weight: 0.7, limit: 10 }),
];
