// 為還沒有封面圖的項目抓文章頁的 og:image。
// 原則：每篇只抓一次（結果存進資料，下一輪沿用）；有時間與數量上限；只讀頁面開頭；失敗就算了。
import { extractOgImage } from './lib.mjs';

const UA = 'Mozilla/5.0 (compatible; dev-intel/1.0; +https://github.com/cornming/dev-intel)';
// 這些站的連結只是討論串，沒有文章封面
const SKIP_HOSTS = new Set(['news.ycombinator.com', 'lobste.rs']);
const MAX_BYTES = 300000;

async function readHead(url, timeoutMs) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,*/*;q=0.8' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!/html/i.test(type)) throw new Error('非 HTML');
  const reader = res.body.getReader();
  const dec = new TextDecoder('utf-8', { fatal: false });
  let html = '', bytes = 0;
  while (bytes < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    html += dec.decode(value, { stream: true });
    if (/<\/head>/i.test(html)) break; // meta 都在 head 裡，讀到這裡就夠
  }
  reader.cancel().catch(() => {});
  return { html, finalUrl: res.url || url };
}

export function needsImage(it) {
  if (it.image || it.imgChecked) return false;
  try { return !SKIP_HOSTS.has(new URL(it.url).hostname); } catch { return false; }
}

// items 要先依重要性排序：預算用完時，優先處理排名高的
export async function enrichImages(items, { maxFetch = 120, budgetMs = 150000, concurrency = 8, perUrlMs = 8000 } = {}) {
  const queue = items.filter(needsImage).slice(0, maxFetch);
  const t0 = Date.now();
  let found = 0, done = 0, i = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (i < queue.length && Date.now() - t0 < budgetMs) {
      const it = queue[i++];
      try {
        const { html, finalUrl } = await readHead(it.url, perUrlMs);
        const img = extractOgImage(html, finalUrl);
        if (img) { it.image = img; found++; }
        it.imgChecked = true;
      } catch {
        // 暫時性失敗（逾時、5xx）不標記已查過，下一輪再試；但連續失敗的由 imgTries 限制
        it.imgTries = (it.imgTries ?? 0) + 1;
        if (it.imgTries >= 3) it.imgChecked = true;
      }
      done++;
    }
  }));
  return { queued: queue.length, done, found, ms: Date.now() - t0 };
}
