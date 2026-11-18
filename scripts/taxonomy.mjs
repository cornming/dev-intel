// 產業分類與公司字典：依 config/taxonomy.json 為每則項目標上「公司」與「產業」。
// 分類只看標題（加上本站的主題標籤當輔助）；這是「關注度」分析用的粗分類，不是產業研究報告。
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tagsFor } from './lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 純英文／數字詞：兩側不可緊貼英數字（避免 "arm" 命中 "alarm"）；含中文或符號開頭的詞直接比對
function matcher(alias) {
  if (alias.startsWith('re:')) return new RegExp(alias.slice(3), 'i'); // 原始正規表示式（排除中文子字串誤判用）
  const a = alias.trim().toLowerCase();
  const body = escapeRe(a).replace(/\\? /g, '\\s+');
  return /^[a-z0-9][a-z0-9 .\-‑]*[a-z0-9]$|^[a-z0-9]$/.test(a)
    ? new RegExp(`(?<![a-z0-9_])${body}(?![a-z0-9_])`, 'i')
    : new RegExp(body, 'i');
}

export function compileTaxonomy(raw) {
  const industries = raw.industries.map((i) => ({ ...i, kw: i.keywords.map(matcher) }));
  const entities = raw.entities.map((e) => ({ ...e, res: e.aliases.map(matcher) }));
  const byId = new Map(industries.map((i) => [i.id, i]));
  for (const e of entities) for (const id of e.industries) if (!byId.has(id)) throw new Error(`公司「${e.name}」指向不存在的產業 ${id}`);
  return { industries, entities, order: industries.map((i) => i.id) };
}

export async function loadTaxonomy() {
  return compileTaxonomy(JSON.parse(await readFile(resolve(ROOT, 'config/taxonomy.json'), 'utf8')));
}

// 回傳 { ents: [公司 id], inds: [產業 id，最多 2 個，依分數高到低] }
export function classify(item, tax, maxInds = 2) {
  const text = `${item.title ?? ''}`;
  const ents = tax.entities.filter((e) => e.res.some((re) => re.test(text)));
  const score = new Map();
  const add = (id, n) => score.set(id, (score.get(id) ?? 0) + n);
  // 公司的第一個產業是主要產業（2 分），其餘 1 分：例如 Amazon 的 Redshift 應歸雲端，不該連帶歸電商
  for (const e of ents) e.industries.forEach((id, i) => add(id, i === 0 ? 2 : 1));
  const tags = tagsFor(text); // 一律由標題重算：來源自帶的標籤（例如職場來源每篇都帶「職場」）不代表這則的內容
  for (const ind of tax.industries) {
    const hits = ind.kw.filter((re) => re.test(text)).length;
    if (hits) add(ind.id, Math.min(hits, 3));
    for (const t of tags) if (ind.tags.includes(t)) add(ind.id, 1);
  }
  const inds = [...score.entries()].filter(([, s]) => s >= 1)
    .sort((a, b) => b[1] - a[1] || tax.order.indexOf(a[0]) - tax.order.indexOf(b[0]))
    .slice(0, maxInds).map(([id]) => id);
  return { ents: ents.map((e) => e.id), inds };
}

// 給前端用的名稱對照（不含比對規則）
export const publicTaxonomy = (tax) => ({
  industries: tax.industries.map(({ id, name }) => ({ id, name })),
  entities: tax.entities.map(({ id, name, industries }) => ({ id, name, industries })),
});
