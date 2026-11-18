// 官方資料面板（不經過 AI）：CISA 已遭利用漏洞清單（KEV）與 endoflife.date 的版本支援期限。
const UA = 'dev-intel/1.0 (+https://github.com/cornming/dev-intel)';
const TIMEOUT_MS = 25000;

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

// 取最近新增的 N 筆；只留面板需要的欄位，檔案才不會把 1.8 MB 的完整清單帶進網站
export function pickKev(json, limit = 10) {
  const list = [...(json.vulnerabilities ?? [])].sort((a, b) => String(b.dateAdded).localeCompare(String(a.dateAdded)));
  return {
    version: json.catalogVersion ?? null,
    released: json.dateReleased ?? null,
    count: Number(json.count ?? list.length),
    latest: list.slice(0, limit).map((v) => ({
      cve: v.cveID, vendor: v.vendorProject, product: v.product, name: v.vulnerabilityName,
      added: v.dateAdded, due: v.dueDate, ransomware: v.knownRansomwareCampaignUse === 'Known',
      action: String(v.requiredAction ?? '').slice(0, 200),
    })),
  };
}

export async function fetchKev() {
  return pickKev(await getJson(KEV_URL));
}

export const PRODUCTS = [
  ['nodejs', 'Node.js'], ['python', 'Python'], ['dotnet', '.NET'], ['go', 'Go'], ['php', 'PHP'],
  ['react', 'React'], ['angular', 'Angular'], ['django', 'Django'], ['spring-boot', 'Spring Boot'],
  ['kubernetes', 'Kubernetes'], ['postgresql', 'PostgreSQL'], ['ubuntu', 'Ubuntu'],
];

const DAY = 864e5;

// 只列「仍在支援期內」的版本；eol 為 false 代表官方尚未訂定結束日
export function pickCycles(cycles, now = Date.now(), maxCycles = 3, soonDays = 90) {
  return cycles
    .filter((c) => c.eol === false || Date.parse(c.eol) > now)
    .slice(0, maxCycles)
    .map((c) => {
      const eol = c.eol === false ? null : c.eol;
      const daysLeft = eol ? Math.ceil((Date.parse(eol) - now) / DAY) : null;
      return { cycle: String(c.cycle), latest: c.latest ?? null, eol, daysLeft, soon: daysLeft !== null && daysLeft <= soonDays, lts: !!c.lts };
    });
}

export async function fetchLifecycle(now = Date.now()) {
  const rows = await Promise.all(PRODUCTS.map(async ([slug, label]) => {
    try { return { slug, label, cycles: pickCycles(await getJson(`https://endoflife.date/api/${slug}.json`), now) }; } catch { return null; }
  }));
  const ok = rows.filter((r) => r && r.cycles.length);
  if (ok.length === 0) throw new Error('沒有取得任何產品資料');
  return ok;
}
