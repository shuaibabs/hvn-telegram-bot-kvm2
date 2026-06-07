/**
 * Dev tool: validate every subcategory matcher against the LIVE vipnumbershop.com data.
 *
 * For each (category, subcategory) it fetches sample numbers from the site's search API,
 * drops the few promoted "star" numbers injected at the top, and reports the % of the
 * remaining numbers that the corresponding matcher accepts. Use this whenever you tweak a
 * pattern in src/shared/utils/vipNumberCategories.ts to make sure it still fits real data.
 *
 * Run:  node scripts/validateSubcategories.mjs
 * Requires Node >= 22.6 (TypeScript type-stripping). On Node 24 it works out of the box;
 * on 22.x run with:  node --experimental-strip-types scripts/validateSubcategories.mjs
 */
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'shared', 'utils', 'vipNumberCategories.ts')).href;
const { CATEGORY_TAXONOMY, matchesSubcategory } = await import(modUrl);

const BASE = 'https://www.vipnumbershop.com/api/web';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const THRESHOLD = 0.8;

async function fetchSubcategory(categoryName, subId) {
  const qs = new URLSearchParams({
    category: categoryName, id: String(subId),
    page: '1', paginate: '60', seller: 'PREMIUM,BASIC', comingsoon: 'yes',
  });
  try {
    const r = await fetch(`${BASE}/categories/search?${qs}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.data || []).map((x) => x.number).filter(Boolean);
  } catch {
    return [];
  }
}

// First parent category for each subcategory id.
const parent = new Map();
for (const c of CATEGORY_TAXONOMY) for (const s of c.subcategories) if (!parent.has(s.id)) parent.set(s.id, { name: c.name, sub: s.name });

const low = [];
let checked = 0, empty = 0;
for (const [subId, { name, sub }] of parent) {
  const all = await fetchSubcategory(name, subId);
  if (all.length === 0) { empty++; continue; }
  const test = all.length > 6 ? all.slice(3) : all; // drop promoted "star" numbers
  const ok = test.filter((n) => matchesSubcategory(n, subId)).length;
  const rate = ok / test.length;
  checked++;
  if (rate < THRESHOLD) low.push({ subId, sub, rate: Math.round(rate * 100), n: test.length });
}

low.sort((a, b) => a.rate - b.rate);
console.log(`Checked ${checked} subcategories (${empty} had no live data).`);
console.log(`Below ${THRESHOLD * 100}% match rate: ${low.length}`);
for (const x of low) console.log(`  [${x.subId}] ${x.sub.padEnd(26)} ${x.rate}%  (n=${x.n})`);
if (low.length === 0) console.log('All sampled subcategories meet the threshold. ✅');
