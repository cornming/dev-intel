import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTaxonomy, classify, compileTaxonomy, publicTaxonomy } from '../scripts/taxonomy.mjs';

const tax = await loadTaxonomy();
const raw = JSON.parse(readFileSync(new URL('../config/taxonomy.json', import.meta.url), 'utf8'));

test('字典完整性：id 不重複、公司指向存在的產業、每個產業與公司都有詞', () => {
  const ids = raw.industries.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, '產業 id 重複');
  const eids = raw.entities.map((e) => e.id);
  assert.equal(new Set(eids).size, eids.length, '公司 id 重複');
  for (const e of raw.entities) { assert.ok(e.aliases.length, `${e.name} 沒有別名`); assert.ok(e.industries.length, `${e.name} 沒有產業`); }
  for (const i of raw.industries) assert.ok(i.keywords.length, `${i.name} 沒有關鍵字`);
  assert.throws(() => compileTaxonomy({ industries: [{ id: 'a', name: 'A', keywords: ['x'], tags: [] }], entities: [{ id: 'e', name: 'E', industries: ['不存在'], aliases: ['e'] }] }), /不存在的產業/);
});

test('純英文別名要有邊界：arm 不命中 alarm、ibm 不命中 ibmx；中文別名直接比對', () => {
  const t = compileTaxonomy({ industries: [{ id: 'semi', name: '半導體', keywords: ['arm'], tags: [] }], entities: [{ id: 'ibm', name: 'IBM', industries: ['semi'], aliases: ['ibm', '輝達'] }] });
  assert.deepEqual(classify({ title: 'The alarm rang' }, t).inds, []);
  assert.deepEqual(classify({ title: 'ARM unveils a chip' }, t).inds, ['semi']);
  assert.deepEqual(classify({ title: 'ibmx news' }, t).ents, []);
  assert.deepEqual(classify({ title: 'IBM 發布新品' }, t).ents, ['ibm']);
  assert.deepEqual(classify({ title: '輝達財報' }, t).ents, ['ibm']);
});

test('中文子字串誤判：「筆電」不該命中「萬筆電子郵件」', () => {
  const r = classify({ title: 'Arara郵件服務遭駭，確認逾107萬筆電子郵件地址外洩' }, tax);
  assert.ok(!r.inds.includes('device'));
  assert.ok(r.inds.includes('sec'));
  assert.ok(classify({ title: '這台筆電的續航力很強' }, tax).inds.includes('device'));
});

// 人工標註：標題 → 應有的產業（want）／不該有的產業（not）／應有的公司（ents）
const CASES = [
  ['Redshift支援Iceberg資料表多陳述式交易', { want: ['cloud'], not: ['ecom'], ents: ['amazon'] }],
  ['Nvidia營收翻倍，黃仁勳首度表態願回任Nvidia執行長', { want: ['semi'], ents: ['nvidia'] }],
  ['Anthropic IPO 超搶手 傳最終定價高於 80 美元', { want: ['ai', 'fin'], ents: ['anthropic'] }],
  ['美國擬公布 AI 出口支持名單：NVIDIA 等 20 多家企業傳入選，可望獲哪些政府資源？', { want: ['gov'], ents: ['nvidia'] }],   // 完整的真實標題
  ['Oracle發布11月例行更新，修補640個資安漏洞', { want: ['sec'], ents: ['oracle'] }],
  ['鴻海：台灣這次有資源參與機器人標準', { want: ['mfg'], ents: ['foxconn'] }],
  ['ID.me terms required for IRS sign-in', { want: ['gov'], not: ['fin'] }],
  ['Arnis turns any place on Earth into a Minecraft world', { want: ['game'] }],
  ['(15) 研發看 MES：HOLD － 生產發現異常，怎麼把 Lot 停下來？', { want: ['mfg'] }],
  ['SNMP Tester Get OIDs', { want: ['telco'] }],
  ['Tesla 砸 30 億歐元擴建柏林超級工廠！Cybercab 2029 年投產', { want: ['auto'], ents: ['tesla'] }],
  ['The FOSDEM Pledge', { not: ['talent'] }],                       // 職場來源的標籤不代表內容
  ['Virtual Art Museum built with Three js', { not: ['talent', 'game'] }],
  ['轉職軟體工程師之前或許你該知道的產業地圖', { want: ['talent'] }],
  ['Bitcoin 突破新高，加密貨幣交易所湧入資金', { want: ['fin'] }],
  ['中華電信與 Starlink 合作衛星通訊', { want: ['telco'], ents: ['cht', 'spacex'] }],
  ['特斯拉自駕計程車在奧斯汀開跑', { want: ['auto'], ents: ['tesla'] }],
  ['蝦皮調整電商賣家手續費', { want: ['ecom'], ents: ['shopee'] }],
  ['Netflix 提高串流訂閱價格', { want: ['media'], ents: ['netflix'] }],
  ['FDA 核准新的基因療法', { want: ['health'] }],
  ['鋰電池儲能系統需求大增，太陽能裝置量創高', { want: ['energy'] }],
  ['The alarm clock app review', { not: ['semi'] }],                // arm 不命中 alarm
];

test('人工標註的產業與公司：應有的要有、不該有的不能有', () => {
  const bad = [];
  for (const [title, c] of CASES) {
    const r = classify({ title }, tax);
    for (const w of c.want ?? []) if (!r.inds.includes(w)) bad.push(`「${title}」應有產業 ${w}，實際 [${r.inds}]`);
    for (const n of c.not ?? []) if (r.inds.includes(n)) bad.push(`「${title}」不該有產業 ${n}，實際 [${r.inds}]`);
    for (const e of c.ents ?? []) if (!r.ents.includes(e)) bad.push(`「${title}」應有公司 ${e}，實際 [${r.ents}]`);
  }
  assert.deepEqual(bad, []);
});

test('classify：每則最多 2 個產業，並以分數排序；沒有證據就是空陣列', () => {
  const r = classify({ title: 'Nvidia GPU 雲端 資安 AI 駭客 資料中心 晶片 漏洞' }, tax);
  assert.ok(r.inds.length <= 2);
  assert.deepEqual(classify({ title: 'Elephant-Goldfish Model' }, tax).inds, []);
});

test('publicTaxonomy：只含名稱對照，不含比對規則', () => {
  const p = publicTaxonomy(tax);
  assert.equal(p.industries.length, raw.industries.length);
  assert.deepEqual(Object.keys(p.industries[0]).sort(), ['id', 'name']);
  assert.deepEqual(Object.keys(p.entities[0]).sort(), ['id', 'industries', 'name']);
});
