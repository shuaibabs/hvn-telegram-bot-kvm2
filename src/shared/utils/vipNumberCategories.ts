/**
 * VIP Mobile Number — Two-Level Category → Subcategory taxonomy & filtering.
 *
 * Mirrors the live taxonomy of https://www.vipnumbershop.com
 * (source of truth: GET /api/web/categories — 31 categories, 148 unique subcategories).
 *
 * Each subcategory is matched by a pure pattern function keyed by its numeric id
 * (ids are SHARED across categories, so the matcher belongs to the id, not the pair).
 * Patterns were reverse-engineered & validated against real numbers returned by the
 * site's /api/web/categories/search endpoint (see scripts/validateSubcategories.mjs).
 *
 * This module is intentionally SELF-CONTAINED (no imports) so the bot copy
 * (telegram-bot/src/shared/utils) and the UI copy (ui-app/src/lib) are byte-identical.
 *
 * Indian mobile numbers are 10 digits. All matchers operate on the normalized
 * 10-digit string. Notation in comments: A B C D X Y Z = digit placeholders
 * (same letter = same digit), 0 = literal zero, * / . = one filler digit.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type CategoryId = number;
export type SubcategoryId = number;

export interface Subcategory {
  id: SubcategoryId;
  name: string;
}

export interface Category {
  id: CategoryId;
  name: string;
  slug: string;
  subcategories: Subcategory[];
}

// ─── Normalization & low-level helpers ──────────────────────────────────────────

/** Extract the 10-digit body (strips +91 / leading 0 country prefixes). */
export function normalize(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

function allSame(s: string): boolean {
  return s.length > 0 && s.split("").every((c) => c === s[0]);
}

function digitsOf(n: string): number[] {
  return n.split("").map((d) => parseInt(d, 10));
}

/** Contains a run of `k`+ identical consecutive digits. */
function hasRunLen(n: string, k: number): boolean {
  return new RegExp(`(\\d)\\1{${k - 1}}`).test(n);
}

/** Longest consecutive run of any single digit. */
function longestRun(n: string): number {
  let max = 1, cur = 1;
  for (let i = 1; i < n.length; i++) {
    cur = n[i] === n[i - 1] ? cur + 1 : 1;
    if (cur > max) max = cur;
  }
  return max;
}

/** Longest consecutive run of a specific digit. */
function longestRunOf(n: string, d: string): number {
  let max = 0, cur = 0;
  for (const ch of n) {
    cur = ch === d ? cur + 1 : 0;
    if (cur > max) max = cur;
  }
  return max;
}

function freqOf(n: string, d: string): number {
  let c = 0;
  for (const ch of n) if (ch === d) c++;
  return c;
}

function distinctDigits(n: string): number {
  return new Set(n.split("")).size;
}

/** A 4-char window that is an alternating pair XYXY with X != Y. */
function isXYXY(s: string): boolean {
  return s.length === 4 && s[0] === s[2] && s[1] === s[3] && s[0] !== s[1];
}

/** ABAB alternating pair block at index i (n[i]==n[i+2], n[i+1]==n[i+3], distinct). */
function altPairAt(n: string, i: number): boolean {
  return i + 3 < n.length && n[i] === n[i + 2] && n[i + 1] === n[i + 3] && n[i] !== n[i + 1];
}

/** AAABBB (two distinct triples) starting at index i. */
function aaabbbAt(n: string, i: number): boolean {
  if (i + 6 > n.length) return false;
  const a = n.slice(i, i + 3), b = n.slice(i + 3, i + 6);
  return allSame(a) && allSame(b) && a[0] !== b[0];
}

/**
 * Run of EXACTLY `runLen` identical digits, immediately followed by exactly `trail`
 * digits to the end of the number. The digit before the run (if any) must differ,
 * and the first trailing digit must differ (so the run is exactly `runLen`, not more).
 * If `digit` is given, the run must be that digit.
 *
 * e.g. runWithTrailing(n,5,1)       → xxxxxA   (penta + 1 trailing)
 *      runWithTrailing(n,5,3,"0")   → 00000abc (five zeros + 3 trailing)
 *      runWithTrailing(n,4,0)       → Tetra Last (exactly 4 identical at end)
 */
function runWithTrailing(n: string, runLen: number, trail: number, digit?: string): boolean {
  const start = n.length - trail - runLen;
  if (start < 0) return false;
  const run = n.slice(start, start + runLen);
  if (!allSame(run)) return false;
  const d = run[0];
  if (digit && d !== digit) return false;
  if (start > 0 && n[start - 1] === d) return false;          // exact run (left boundary)
  if (trail > 0 && n[start + runLen] === d) return false;     // exact run (right boundary)
  return true;
}

/** Exactly `k` identical digits at the very end. */
function endsWithRun(n: string, k: number): boolean {
  return runWithTrailing(n, k, 0);
}

/** Exactly `k` identical digits at the very start. */
function startsWithRun(n: string, k: number): boolean {
  return allSame(n.slice(0, k)) && n[k] !== n[0];
}

/** A `blockLen`-digit block (not all-same) repeated `times` consecutively starting at i. */
function blockRepeatAt(n: string, i: number, blockLen: number, times: number): boolean {
  if (i + blockLen * times > n.length) return false;
  const block = n.slice(i, i + blockLen);
  if (allSame(block)) return false;
  for (let k = 1; k < times; k++) {
    if (n.slice(i + blockLen * k, i + blockLen * (k + 1)) !== block) return false;
  }
  return true;
}

/** A `blockLen`-digit block (not all-same) repeated `times` consecutively anywhere. */
function repeatBlock(n: string, blockLen: number, times: number): boolean {
  for (let i = 0; i + blockLen * times <= n.length; i++) {
    if (blockRepeatAt(n, i, blockLen, times)) return true;
  }
  return false;
}

/** `count` consecutive blocks of length `blockLen`, each internally identical (AABB.. / AAABBB..). */
function consecutiveBlocksSame(n: string, blockLen: number, count: number): boolean {
  for (let start = 0; start + blockLen * count <= n.length; start++) {
    let ok = true;
    for (let k = 0; k < count; k++) {
      if (!allSame(n.slice(start + blockLen * k, start + blockLen * (k + 1)))) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

const couplesRun = (n: string, count: number) => consecutiveBlocksSame(n, 2, count);
const triplingRun = (n: string, count: number) => consecutiveBlocksSame(n, 3, count);

/** XY*XY — alternating pair split by one filler digit (X != Y). */
function xyStarXy(n: string): boolean {
  for (let i = 0; i + 5 <= n.length; i++) {
    if (n[i] !== n[i + 1] && n[i] === n[i + 3] && n[i + 1] === n[i + 4]) return true;
  }
  return false;
}

/** XY0XY — alternating pair split by a literal zero (X != Y). */
function xy0xy(n: string): boolean {
  for (let i = 0; i + 5 <= n.length; i++) {
    if (n[i + 2] === "0" && n[i] !== n[i + 1] && n[i] === n[i + 3] && n[i + 1] === n[i + 4]) return true;
  }
  return false;
}

/** First 5 digits equal the last 5 (vipnumbershop "Mirror" = ABCDE ABCDE). */
function firstHalfEqualsSecond(n: string): boolean {
  return n.length === 10 && n.slice(0, 5) === n.slice(5);
}

function isPalindrome(n: string): boolean {
  return n === n.split("").reverse().join("");
}

/** Last 5 are the reverse of the first 5 (classic semi-mirror). */
function reversedHalf(n: string): boolean {
  return n.length === 10 && n.slice(5) === n.slice(0, 5).split("").reverse().join("");
}

/** Hamming distance between first 5 and last 5 digits. */
function hammingFirstLast(n: string): number {
  let d = 0;
  for (let i = 0; i < 5; i++) if (n[i] !== n[i + 5]) d++;
  return d;
}

/**
 * A single digit recurs at >= minCount positions of the same parity (stride-2),
 * e.g. 1x2x3x4x5x style or zero-repeating. If `digit` is given it must be that digit.
 */
function alternatingDigit(n: string, minCount: number, digit?: string): boolean {
  for (const par of [0, 1]) {
    const slots: string[] = [];
    for (let i = par; i < n.length; i += 2) slots.push(n[i]);
    if (digit) {
      if (slots.filter((c) => c === digit).length >= minCount) return true;
    } else {
      const m: Record<string, number> = {};
      for (const c of slots) m[c] = (m[c] || 0) + 1;
      if (Math.max(0, ...Object.values(m)) >= minCount) return true;
    }
  }
  return false;
}

/** "Broken" run: a digit occurs `count`+ times overall but its longest run is below `count`. */
function brokenRun(n: string, count: number, digit?: string): boolean {
  if (digit) return freqOf(n, digit) >= count && longestRunOf(n, digit) < count;
  const m: Record<string, number> = {};
  for (const c of n) m[c] = (m[c] || 0) + 1;
  for (const d of Object.keys(m)) {
    if (m[d] >= count && longestRunOf(n, d) < count) return true;
  }
  return false;
}

/** Longest run of digits strictly ascending (+1) or descending (-1). */
function monotonicRun(n: string, len: number): boolean {
  const d = digitsOf(n);
  let asc = 1, desc = 1;
  for (let i = 1; i < d.length; i++) {
    asc = d[i] === d[i - 1] + 1 ? asc + 1 : 1;
    desc = d[i] === d[i - 1] - 1 ? desc + 1 : 1;
    if (asc >= len || desc >= len) return true;
  }
  return false;
}

/** Numerology base: no digits 2, 4 or 8 anywhere. */
function numerology(n: string): boolean {
  return !/[248]/.test(n);
}

const containsAny = (n: string, subs: string[]) => subs.some((s) => n.includes(s));

/** Greedy count of non-overlapping doubled pairs (AA) — "couples". */
function countCouples(n: string): number {
  let c = 0;
  for (let i = 0; i < n.length - 1; ) { if (n[i] === n[i + 1]) { c++; i += 2; } else i++; }
  return c;
}

/** Greedy count of non-overlapping triples (AAA) — "trippling". */
function countTriples(n: string): number {
  let c = 0;
  for (let i = 0; i < n.length - 2; ) { if (n[i] === n[i + 1] && n[i + 1] === n[i + 2]) { c++; i += 3; } else i++; }
  return c;
}

/** Number of maximal runs of length >= minLen. */
function countMaxRuns(n: string, minLen: number): number {
  let c = 0, i = 0;
  while (i < n.length) { let j = i; while (j < n.length && n[j] === n[i]) j++; if (j - i >= minLen) c++; i = j; }
  return c;
}

/** A maximal run of EXACTLY runLen with at least minTrail digits after it. */
function maximalRunWithTrailing(n: string, runLen: number, minTrail: number, digit?: string): boolean {
  let i = 0;
  while (i < n.length) {
    let j = i; while (j < n.length && n[j] === n[i]) j++;
    if (j - i === runLen && (!digit || n[i] === digit) && n.length - j >= minTrail) return true;
    i = j;
  }
  return false;
}

/** A `len`-char block (not all-same) that occurs at least `times` times anywhere. */
function blockTimes(n: string, len: number, times: number): boolean {
  for (let i = 0; i + len <= n.length; i++) {
    const b = n.slice(i, i + len);
    if (allSame(b)) continue;
    let c = 0, idx = 0;
    while ((idx = n.indexOf(b, idx)) !== -1) { c++; idx++; }
    if (c >= times) return true;
  }
  return false;
}

/** Number of distinct 2-digit groups among the 5 fixed pairs. */
function distinctPairs(n: string): number {
  return new Set([n.slice(0, 2), n.slice(2, 4), n.slice(4, 6), n.slice(6, 8), n.slice(8, 10)]).size;
}

/** Count non-overlapping occurrences of a literal substring. */
function countSub(n: string, s: string): number {
  let c = 0, idx = 0;
  while ((idx = n.indexOf(s, idx)) !== -1) { c++; idx += s.length; }
  return c;
}

/** `count` consecutive groups of `groupLen` digits forming an arithmetic progression (constant nonzero diff). */
function arithGroups(n: string, groupLen: number, count: number): boolean {
  const span = groupLen * count;
  for (let i = 0; i + span <= n.length; i++) {
    const g: number[] = [];
    for (let k = 0; k < count; k++) g.push(parseInt(n.slice(i + k * groupLen, i + (k + 1) * groupLen), 10));
    const diff = g[1] - g[0];
    if (diff === 0) continue;
    let ok = true;
    for (let k = 2; k < count; k++) if (g[k] - g[k - 1] !== diff) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

// ─── Subcategory matchers (keyed by subcategory id) ─────────────────────────────
// All functions receive an already-normalized 10-digit string.

export const SUBCATEGORY_MATCHERS: Record<SubcategoryId, (n: string) => boolean> = {
  // Numerology
  183: (n) => numerology(n),

  // ── Penta family (run of 5) ──
  155: (n) => endsWithRun(n, 5),                                   // Penta Last
  157: (n) => endsWithRun(n, 5),                                   // Special Penta Last (curated → best-effort)
  91: (n) => runWithTrailing(n, 5, 0, "0"),                        // 00000 Last
  95: (n) => runWithTrailing(n, 5, 3) || runWithTrailing(n, 5, 4), // xxxxxABC / ABCD
  13: (n) => runWithTrailing(n, 5, 3, "0"),                        // 00000abc
  11: (n) => runWithTrailing(n, 5, 1, "0"),                        // 00000X
  16: (n) => runWithTrailing(n, 5, 2, "0"),                        // 00000xy
  94: (n) => runWithTrailing(n, 5, 2),                             // xxxxxAB
  9: (n) => n.endsWith("000001"),                                  // 000001
  14: (n) => runWithTrailing(n, 5, 4, "0"),                        // 00000abcd
  93: (n) => runWithTrailing(n, 5, 1),                             // xxxxxA

  // ── Doublling / couples ──
  63: (n) => countCouples(n) >= 5,                                // 5 Couples (AABBCCDDEE)
  158: (n) => couplesRun(n, 4),                                    // 4 Couple (Joint) — consecutive
  59: (n) => countCouples(n) >= 4,                                 // 4 Couples
  52: (n) => countCouples(n) >= 3,                                 // 3 Couples
  47: (n) => countCouples(n) >= 2,                                 // 2 Couples

  // ── XYXYXY ──
  62: (n) => blockTimes(n, 2, 4),                                  // 4 Times xy (xy appears 4×)
  106: (n) => blockTimes(n, 2, 4) && !repeatBlock(n, 2, 4),        // 4 Times XY - Broken
  125: (n) => blockRepeatAt(n, 4, 2, 3),                           // xyxyxy Last
  126: (n) => blockRepeatAt(n, 0, 2, 3),                           // xyxyxy Start
  129: (n) => repeatBlock(n, 2, 3),                                // xyxyxyAB
  130: (n) => repeatBlock(n, 2, 3),                                // xyxyxyABC
  128: (n) => repeatBlock(n, 2, 3),                                // xyxyxyA
  142: (n) => blockTimes(n, 2, 3) && !repeatBlock(n, 2, 3),        // 3 Times xy - broken

  // ── 00xy00 / mask family (uppercase letters = nonzero digit) ──
  35: (n) => /00[1-9]00/.test(n),                                 // 00x00
  108: (n) => /[1-9]00[1-9]00/.test(n),                           // x00x00
  161: (n) => /[1-9][1-9]00[1-9][1-9]00/.test(n) || /00[1-9][1-9]00[1-9][1-9]/.test(n), // 00xy00xy
  164: (n) => /00[1-9][1-9]00/.test(n) || /[1-9]00[1-9]00/.test(n), // 1+-00xy00
  162: (n) => /[1-9][1-9]00[1-9][1-9]00/.test(n),                 // ab00xy00
  163: (n) => /[1-9]00[1-9][1-9]00\d/.test(n),                    // a00b-x00y
  36: (n) => /00[1-9][1-9]00[1-9][1-9]/.test(n),                  // 00ab00xy

  // ── Mirror category ──
  84: (n) => firstHalfEqualsSecond(n),                            // Mirror (ABCDE ABCDE)
  104: (n) => isPalindrome(n) || n.slice(0, 3) === n.slice(7) || firstHalfEqualsSecond(n), // Ulta-Pulta
  5: (n) => n.includes("00") && hammingFirstLast(n) <= 2,         // Semi Mirror with 00
  103: (n) => hammingFirstLast(n) <= 2,                           // Tripplate Semi Mirror (curated → best-effort)
  160: (n) => repeatBlock(n, 2, 3) || repeatBlock(n, 3, 2) || /[1-9]00[1-9]00/.test(n) || firstHalfEqualsSecond(n), // Unique for Customer Care (curated)

  // ── Semi Mirror category ── (first5 ≈ last5 by Hamming distance: 0 Mirror, ≤1, ≤2)
  40: (n) => hammingFirstLast(n) <= 1,                            // 1+ Semi Mirror
  61: (n) => hammingFirstLast(n) <= 2 || reversedHalf(n),         // 4 Digits Semi Mirror
  70: (n) => xyStarXy(n),                                         // Full Symmery xy*xy
  78: (n) => hammingFirstLast(n) <= 2,                            // 5 Digits Semi Mirror
  140: (n) => altPairAt(n, 0) && altPairAt(n, 5),                 // abab-*-xyxy-*

  // ── Tetra family (run of 4) ──
  51: (n) => endsWithRun(n, 4),                                   // Tetra Last
  44: (n) => endsWithRun(n, 4),                                   // Tetra Last (Special) → best-effort
  90: (n) => runWithTrailing(n, 4, 0, "0"),                       // 0000 Last
  8: (n) => runWithTrailing(n, 4, 0, "0"),                        // 0000 Special → best-effort
  76: (n) => countMaxRuns(n, 4) >= 2 || repeatBlock(n, 4, 2),     // 2 Times Tetra (two 4-runs)
  19: (n) => runWithTrailing(n, 4, 1, "0"),                       // 0000x
  17: (n) => n.endsWith("00001"),                                // 00001
  24: (n) => runWithTrailing(n, 4, 2, "0"),                       // 0000xy
  22: (n) => runWithTrailing(n, 4, 4, "0"),                       // 0000abcd
  137: (n) => startsWithRun(n, 4),                               // Start Tetra
  25: (n) => { for (let i = 0; i + 8 <= n.length; i++) if (n.slice(i, i + 4) === "0000" && isXYXY(n.slice(i + 4, i + 8))) return true; return false; }, // 0000xyxy
  21: (n) => runWithTrailing(n, 4, 3, "0"),                       // 0000abc
  26: (n) => n.endsWith("0001"),                                 // 0001
  100: (n) => runWithTrailing(n, 4, 1),                          // xxxxA
  101: (n) => runWithTrailing(n, 4, 2),                          // xxxxAB
  102: (n) => maximalRunWithTrailing(n, 4, 3),                   // xxxxABC etc. (tetra + 3+ trailing)
  159: (n) => maximalRunWithTrailing(n, 4, 4),                   // xxxxABCD (tetra + 4+ trailing)

  // ── xxxyyy (tripling) ──
  57: (n) => countTriples(n) >= 3,                              // 3 Times Trippling (AAABBBCCC)
  114: (n) => aaabbbAt(n, 4),                                    // xxxyyy Last
  115: (n) => triplingRun(n, 2),                                // xxxyyy Middle (AAABBB anywhere)
  50: (n) => countTriples(n) >= 2,                              // 2 Times Trippling (two triples)
  111: (n) => /(\d)\1\1.{1,2}(\d)\2\2/.test(n),                 // xxx*yyy
  182: (n) => aaabbbAt(n, 0),                                   // xxxyyy Start

  // ── xyzxyz ──
  58: (n) => blockTimes(n, 3, 3),                              // 3 Times xyz (xyz appears 3×)
  73: (n) => repeatBlock(n, 3, 2),                              // AbcAbc-xyxy
  132: (n) => blockRepeatAt(n, 4, 3, 2),                        // xyzxyz Last
  133: (n) => repeatBlock(n, 3, 2),                             // xyzxyz Middle
  143: (n) => repeatBlock(n, 3, 2) || /(\d)(\d)(\d).{1,2}\1\2\3/.test(n), // xyz*xyz
  151: (n) => blockRepeatAt(n, 0, 3, 2),                        // xyzxyz Start

  // ── Hexa (run of 6) ──
  82: (n) => brokenRun(n, 6),                                   // Broken Hexa Digits
  83: (n) => brokenRun(n, 6, "0"),                              // Broken Hexa Zeros
  86: (n) => endsWithRun(n, 6),                                 // Hexa Last
  87: (n) => hasRunLen(n, 6) && !endsWithRun(n, 6),             // Hexa Middle
  88: (n) => n.endsWith("000000"),                             // Hexa Zeros Last (6+ zeros at end)
  89: (n) => n.includes("000000") && !n.endsWith("000000"),    // hexa Zeros middle

  // ── ABAB-XYXY ──
  72: (n) => altPairAt(n, 0) && altPairAt(n, 4),               // abab-xyxy-**
  1: (n) => altPairAt(n, 2) && altPairAt(n, 6),                // **-abab-xyxy
  71: (n) => altPairAt(n, 0) && altPairAt(n, 6),               // abab-**-xyxy
  2: (n) => altPairAt(n, 1) && altPairAt(n, 6),                // *-abab-*-xyxy
  3: (n) => altPairAt(n, 1) && altPairAt(n, 5),               // *-abab-xyxy*

  // ── abcd-abcd ──
  74: (n) => distinctPairs(n) <= 2,                            // AB-CD-AB-CD-AB (≤2 distinct pairs)
  75: (n) => /^(\d)(\d)(\d)(\d)\1\2\3\4\d\d$/.test(n),          // AbcdAbcd-xy
  109: (n) => /^\d(\d)(\d)(\d)(\d)\1\2\3\4\d$/.test(n),         // X-abcd-abcd-Y
  120: (n) => /^\d\d(\d)(\d)(\d)(\d)\1\2\3\4$/.test(n),         // XY-abcd-abcd
  139: (n) => /^(\d)(\d)(\d)(\d)\d\d\1\2\3\4$/.test(n),         // abcd-xy-abcd
  146: (n) => /^(\d)(\d)(\d)(\d)\d\1\2\3\4\d$/.test(n),         // abcd*-abcd*
  147: (n) => /^.(\d)(\d)(\d)(\d).\1\2\3\4$/.test(n),           // *ABCD*ABCD
  150: (n) => /^\d(\d)(\d)(\d)(\d)\d\1\2\3\4$/.test(n),         // x-abcd-y-abcd
  110: (n) => repeatBlock(n, 4, 2),                            // 4 Digits Repeating

  // ── Ascending / Descending (single-digit runs + 2-/3-digit arithmetic groups) ──
  48: (n) => arithGroups(n, 2, 3),                            // 2 Digits AD (6D) — e.g. 15·16·17, 50·60·70
  53: (n) => monotonicRun(n, 5),                             // 3 Digits AD (5+D)
  98: (n) => monotonicRun(n, 5),                              // One Digit Asending (5d)
  99: (n) => monotonicRun(n, 3) || arithGroups(n, 2, 3),     // Short Asending
  165: (n) => monotonicRun(n, 6) || arithGroups(n, 2, 4) || arithGroups(n, 2, 3), // 8-9 Digits Asending
  60: (n) => monotonicRun(n, 4) || arithGroups(n, 2, 3),     // 4 Digit Asending
  79: (n) => monotonicRun(n, 4) || arithGroups(n, 2, 3),    // Asending-Desending (symmetry cats)

  // ── Minimum-digit ──
  49: (n) => distinctDigits(n) === 2,                         // 2 Digit Numbers
  54: (n) => distinctDigits(n) === 3,                         // 3 Digit Numbers
  55: (n) => n.includes("0") && new Set(n.replace(/0/g, "").split("")).size === 3, // 3 digits with 0 (3 non-zero + zero)

  // ── Septa / Octa ──
  96: (n) => brokenRun(n, 7),                                 // Septa Octa Broken
  97: (n) => hasRunLen(n, 7),                                 // Septa Octa

  // ── 10-digit symmetry extras ──
  46: (n) => alternatingDigit(n, 4),                         // 1x2x3x4x5x
  69: (n) => (n.match(/[1-9]00/g) || []).length >= 3,        // A00-B00-C00 (3 "d00" groups)
  118: (n) => /[1-9][1-9]000[1-9][1-9]000/.test(n),          // AB000-XY000
  135: (n) => alternatingDigit(n, 4, "0"),                   // Zero repeating

  // ── 000 family ──
  6: (n) => runWithTrailing(n, 3, 0, "0"),                   // End with 000
  7: (n) => /[1-9]000[1-9]/.test(n),                         // 000 Middle
  28: (n) => runWithTrailing(n, 3, 1, "0"),                  // 000x
  32: (n) => runWithTrailing(n, 3, 2, "0"),                  // 000xy
  33: (n) => runWithTrailing(n, 3, 3, "0"),                  // 000xyz
  37: (n) => /00[1-9][1-9]000/.test(n),                      // 00xy000
  124: (n) => { for (let i = 0; i + 7 <= n.length; i++) if (isXYXY(n.slice(i, i + 4)) && n.slice(i + 4, i + 7) === "000") return true; return false; }, // xyxy000
  141: (n) => /([1-9])\1[0]{3}$/.test(n),                    // xx000 (pair then 000 at end)
  148: (n) => /(\d)(\d)000\1\2/.test(n),                     // xy000xy
  31: (n) => runWithTrailing(n, 3, 2, "0"),                  // 000xy (Special)

  // ── 786 ──
  18: (n) => n.includes("000786"),                           // 000786
  34: (n) => n.includes("00786"),                            // 00786
  39: (n) => n.includes("0786"),                             // 0786
  64: (n) => n.endsWith("786"),                              // 786 End
  65: (n) => countSub(n, "786") >= 2 || /786.786/.test(n),   // 786*786
  66: (n) => n.includes("786") && n.includes("13"),          // 786+13
  67: (n) => n.includes("786") && n.includes("92"),          // 786+92
  68: (n) => n.includes("786786"),                           // 786786
  138: (n) => { const i = n.indexOf("786"); return i > 0 && i < 7; }, // 786 Middle
  144: (n) => n.startsWith("786"),                           // 786 start

  // ── 13 family ──
  10: (n) => n.includes("0000013"),                          // 0000013
  27: (n) => n.includes("00013"),                            // 00013 / 000013
  38: (n) => n.includes("01313"),                            // 01313
  42: (n) => n.includes("13000"),                            // 13000
  43: (n) => n.includes("1313"),                             // 1313
  45: (n) => /13.13/.test(n),                                // 13x13
  56: (n) => countSub(n, "13") >= 3,                         // 3 times 13

  // ── xyxy (2 times) / xy*xy ──
  122: (n) => repeatBlock(n, 2, 2),                          // xyxy
  123: (n) => repeatBlock(n, 2, 2) && n.includes("0"),       // xyxy0 / 00
  121: (n) => repeatBlock(n, 2, 2),                          // xy-a-xyxy → best-effort
  4: (n) => { for (let i = 0; i + 5 <= n.length; i++) if (n[i] === "0" && isXYXY(n.slice(i + 1, i + 5))) return true; return false; }, // 0/00xyxy
  29: (n) => { for (let i = 0; i + 7 <= n.length; i++) if (n.slice(i, i + 3) === "000" && isXYXY(n.slice(i + 3, i + 7))) return true; return false; }, // 000xyxy
  117: (n) => xyStarXy(n),                                   // xy*xy
  119: (n) => xy0xy(n),                                      // xy0xy

  // ── Special Charactors/Digits (curated → substring heuristics) ──
  41: (n) => containsAny(n, ["1008", "108"]),               // 108-1008
  77: (n) => containsAny(n, ["302", "307", "751", "720", "420"]), // Acts
  85: (n) => containsAny(n, ["855", "5911"]),               // Vichle 855-5911
  134: (n) => /(19[5-9]\d|20[0-2]\d)/.test(n),              // Years/Words

  // ── Normal Fancy ──
  92: () => false,                                          // Others (catch-all → none)
  131: (n) => /[1-9][1-9][1-9]00$/.test(n),                 // xyz00
  149: (n) => endsWithRun(n, 3),                            // End xxx
};

// ─── Category-level "All" matchers (broad). Fallback = OR of subcategory matchers. ─

export const CATEGORY_MATCHERS: Record<CategoryId, (n: string) => boolean> = {
  71: (n) => numerology(n),                                 // Numerology Numbers
  66: (n) => hasRunLen(n, 5),                               // Penta Numbers
  18: (n) => couplesRun(n, 2),                              // Doublling
  34: (n) => repeatBlock(n, 2, 3),                          // XYXYXY
  16: (n) => isPalindrome(n) || firstHalfEqualsSecond(n),  // Mirror
  67: (n) => hasRunLen(n, 4),                               // Tetra Numbers
  22: (n) => triplingRun(n, 2),                             // xxxyyy
  39: (n) => repeatBlock(n, 3, 2),                          // xyzxyz
  31: (n) => hasRunLen(n, 6),                               // Hexa
  37: (n) => repeatBlock(n, 4, 2),                          // abcd-abcd
  43: (n) => monotonicRun(n, 4) || arithGroups(n, 2, 3),    // Asending Desending
  3: (n) => distinctDigits(n) <= 3,                         // Minimum Digit Numbers
  15: (n) => hasRunLen(n, 7),                               // Septa/Octa
  41: (n) => alternatingDigit(n, 4),                        // Single digit repeating
  4: (n) => n.includes("000"),                              // 000
  14: (n) => n.includes("000000") || /[1-9]00[1-9]00[1-9]00/.test(n), // Hexa Zero
  19: (n) => n.includes("786"),                             // 786
  20: (n) => containsAny(n, ["00786", "0786"]),            // 00786
  23: (n) => {                                              // xxyyy xxxyy (AAABB / AABBB, A≠B)
    for (let i = 0; i + 5 <= n.length; i++) {
      const a = n[i];
      if (a === n[i + 1] && a === n[i + 2] && n[i + 3] === n[i + 4] && n[i + 3] !== a) return true; // AAABB
      if (a === n[i + 1] && n[i + 2] === n[i + 3] && n[i + 3] === n[i + 4] && n[i + 2] !== a) return true; // AABBB
    }
    return false;
  },
  24: (n) => n.includes("13") && n.includes("0"),          // 13 with Zeros
  25: (n) => n.includes("13"),                             // 13 Repeating
  32: (n) => repeatBlock(n, 2, 2),                          // xyxy (2 times)
  33: (n) => xyStarXy(n),                                   // xy*xy
  46: (n) => /00[1-9]00/.test(n),                          // 00x00
};

// ─── Taxonomy (verbatim from /api/web/categories) ──────────────────────────────

export const CATEGORY_TAXONOMY: Category[] = [
  { id: 71, name: "Numerology Numbers", slug: "numerology-numbers", subcategories: [{ id: 183, name: "Numerology Numbers" }] },
  { id: 66, name: "Penta Numbers", slug: "penta-vip-mobile-no", subcategories: [{ id: 155, name: "Penta Last" }, { id: 157, name: "Special Penta Last" }, { id: 91, name: "00000 Last" }, { id: 95, name: "xxxxxABC / ABCD" }, { id: 13, name: "00000abc" }, { id: 11, name: "00000X" }, { id: 16, name: "00000xy" }, { id: 94, name: "xxxxxAB" }, { id: 9, name: "000001" }, { id: 14, name: "00000abcd" }, { id: 93, name: "xxxxxA" }] },
  { id: 18, name: "Doublling (AABBCC)", slug: "doublling-aabbcc", subcategories: [{ id: 63, name: "5 Couples" }, { id: 158, name: "4 Couple (Joint)" }, { id: 59, name: "4 Couples" }, { id: 52, name: "3 Couples" }, { id: 47, name: "2 Couples" }] },
  { id: 34, name: "XYXYXY", slug: "vip-mobile-number", subcategories: [{ id: 62, name: "4 Times xy" }, { id: 106, name: "4 Times XY - Broken" }, { id: 125, name: "xyxyxy Last" }, { id: 126, name: "xyxyxy Start" }, { id: 129, name: "xyxyxyAB" }, { id: 130, name: "xyxyxyABC" }, { id: 128, name: "xyxyxyA" }, { id: 142, name: "3 Times xy - broken" }] },
  { id: 49, name: "00xy00", slug: "00xy00-fancy-number", subcategories: [{ id: 35, name: "00x00" }, { id: 108, name: "x00x00" }, { id: 161, name: "00xy00xy" }, { id: 164, name: "1+-00xy00" }, { id: 162, name: "ab00xy00" }, { id: 163, name: "a00b-x00y" }, { id: 36, name: "00ab00xy" }] },
  { id: 16, name: "Mirror", slug: "customer-care-numbers", subcategories: [{ id: 84, name: "Mirror" }, { id: 104, name: "Ulta-Pulta" }, { id: 5, name: "Semi Mirror with 00" }, { id: 103, name: "Tripplate Semi Mirror" }, { id: 160, name: "Unique for Customer Care" }] },
  { id: 17, name: "Semi Mirror", slug: "semi-mirror-vip-mobile-number", subcategories: [{ id: 40, name: "1+ Semi Mirror" }, { id: 104, name: "Ulta-Pulta" }, { id: 5, name: "Semi Mirror with 00" }, { id: 61, name: "4 Digits Semi Mirror" }, { id: 70, name: "Full Symmery xy*xy" }, { id: 78, name: "5 Digits Semi Mirror" }, { id: 103, name: "Tripplate Semi Mirror" }, { id: 140, name: "abab-*-xyxy-*" }] },
  { id: 67, name: "Tetra Numbers - XXXX", slug: "choice-mobile-number", subcategories: [{ id: 51, name: "Tetra Last" }, { id: 44, name: "Tetra Last (Special)" }, { id: 90, name: "0000 Last" }, { id: 8, name: "0000 Special" }, { id: 76, name: "2 Times Tetra" }, { id: 19, name: "0000x" }, { id: 17, name: "00001" }, { id: 24, name: "0000xy" }, { id: 22, name: "0000abcd" }, { id: 137, name: "Start Tetra" }, { id: 25, name: "0000xyxy" }, { id: 9, name: "000001" }, { id: 21, name: "0000abc" }, { id: 26, name: "0001" }, { id: 100, name: "xxxxA" }, { id: 101, name: "xxxxAB" }, { id: 102, name: "xxxxABC etc." }, { id: 159, name: "xxxxABCD" }] },
  { id: 22, name: "xxxyyy", slug: "unforgettable-vip-number", subcategories: [{ id: 57, name: "3 Times Trippling" }, { id: 114, name: "xxxyyy Last" }, { id: 115, name: "xxxyyy Middle" }, { id: 50, name: "2 Times Trippling" }, { id: 111, name: "xxx*yyy" }, { id: 182, name: "xxxyyy Start" }] },
  { id: 39, name: "xyzxyz", slug: "xyzxyz-fancy-number", subcategories: [{ id: 58, name: "3 Times xyz" }, { id: 73, name: "AbcAbc-xyxy" }, { id: 132, name: "xyzxyz Last" }, { id: 133, name: "xyzxyz Middle" }, { id: 143, name: "xyz*xyz" }, { id: 151, name: "xyzxyz Start" }] },
  { id: 31, name: "Hexa", slug: "buy-vip-mobile-number-online", subcategories: [{ id: 82, name: "Broken Hexa Digits" }, { id: 83, name: "Broken Hexa Zeros" }, { id: 86, name: "Hexa Last" }, { id: 87, name: "Middle" }, { id: 88, name: "Hexa Zeros Last" }, { id: 89, name: "hexa Zeros middle" }] },
  { id: 38, name: "ABAB-XYXY", slug: "vip-number-india", subcategories: [{ id: 72, name: "abab-xyxy-**" }, { id: 1, name: "**-abab-xyxy" }, { id: 71, name: "abab-**-xyxy" }, { id: 2, name: "*-abab-*-xyxy" }, { id: 3, name: "*-abab-xyxy*" }, { id: 140, name: "abab-*-xyxy-*" }] },
  { id: 37, name: "abcd-abcd", slug: "abcd-abcd-fancy-number", subcategories: [{ id: 74, name: "AB-CD-AB-CD-AB" }, { id: 75, name: "AbcdAbcd-xy" }, { id: 109, name: "X-abcd-abcd-Y" }, { id: 120, name: "XY-abcd-abcd" }, { id: 139, name: "abcd-xy-abcd" }, { id: 146, name: "abcd*-abcd*" }, { id: 147, name: "*ABCD*ABCD" }, { id: 150, name: "x-abcd-y-abcd" }] },
  { id: 43, name: "Asending Desending", slug: "ascending-descending-fancy-number", subcategories: [{ id: 48, name: "2 Digits AD (6D)" }, { id: 53, name: "3 Digits AD (5+D)" }, { id: 98, name: "One Digit Asending (5d)" }, { id: 99, name: "Short Asending" }, { id: 165, name: "8-9 Digits Asending" }, { id: 60, name: "4 Digit Asending" }] },
  { id: 3, name: "Minimum Digit Numbers", slug: "2-digit-mobile-numbers", subcategories: [{ id: 49, name: "2 Digit Numbers" }, { id: 54, name: "3 Digit Numbers" }, { id: 55, name: "3 digits with 0" }] },
  { id: 15, name: "Septa/Octa", slug: "septa-octa-vip-number-for-sale", subcategories: [{ id: 96, name: "Septa Octa Broken" }, { id: 97, name: "Septa Octa" }] },
  { id: 1, name: "10 Digits symmetry", slug: "best-mobile-number", subcategories: [{ id: 104, name: "Ulta-Pulta" }, { id: 46, name: "1x2x3x4x5x" }, { id: 63, name: "5 Couples" }, { id: 69, name: "A00-B00-C00" }, { id: 70, name: "Full Symmery xy*xy" }, { id: 73, name: "AbcAbc-xyxy" }, { id: 74, name: "AB-CD-AB-CD-AB" }, { id: 79, name: "Asending-Desending" }, { id: 118, name: "AB000-XY000" }, { id: 151, name: "xyzxyz Start" }] },
  { id: 2, name: "8 9 Digits symmetry", slug: "8-9-digits-symmetry", subcategories: [{ id: 76, name: "2 Times Tetra" }, { id: 25, name: "0000xyxy" }, { id: 72, name: "abab-xyxy-**" }, { id: 1, name: "**-abab-xyxy" }, { id: 71, name: "abab-**-xyxy" }, { id: 2, name: "*-abab-*-xyxy" }, { id: 3, name: "*-abab-xyxy*" }, { id: 59, name: "4 Couples" }, { id: 62, name: "4 Times xy" }, { id: 75, name: "AbcdAbcd-xy" }, { id: 79, name: "Asending-Desending" }, { id: 109, name: "X-abcd-abcd-Y" }, { id: 110, name: "4 Digits Repeating" }, { id: 120, name: "XY-abcd-abcd" }, { id: 139, name: "abcd-xy-abcd" }, { id: 140, name: "abab-*-xyxy-*" }, { id: 147, name: "*ABCD*ABCD" }, { id: 150, name: "x-abcd-y-abcd" }] },
  { id: 41, name: "Single digit repeating", slug: "repeating-fancy-mobile-numbers", subcategories: [{ id: 46, name: "1x2x3x4x5x" }, { id: 135, name: "Zero repeating" }] },
  { id: 4, name: "000", slug: "vip-number-000", subcategories: [{ id: 6, name: "End with 000" }, { id: 7, name: "000 Middle" }, { id: 26, name: "0001" }, { id: 28, name: "000x" }, { id: 31, name: "000xy (Special)" }, { id: 32, name: "000xy" }, { id: 33, name: "000xyz" }, { id: 37, name: "00xy000" }, { id: 42, name: "13000" }, { id: 124, name: "xyxy000" }, { id: 141, name: "xx000" }, { id: 148, name: "xy000xy" }] },
  { id: 14, name: "Hexa Zero", slug: "Hexa-vip-mobile-number", subcategories: [{ id: 69, name: "A00-B00-C00" }, { id: 83, name: "Broken Hexa Zeros" }, { id: 88, name: "Hexa Zeros Last" }, { id: 89, name: "hexa Zeros middle" }, { id: 118, name: "AB000-XY000" }] },
  { id: 19, name: "786", slug: "786-vip-mobile-numbers", subcategories: [{ id: 18, name: "000786" }, { id: 34, name: "00786" }, { id: 39, name: "0786" }, { id: 64, name: "786 End" }, { id: 65, name: "786*786" }, { id: 66, name: "786+13" }, { id: 67, name: "786+92" }, { id: 68, name: "786786" }, { id: 138, name: "786 Middle" }, { id: 144, name: "786 start" }] },
  { id: 20, name: "00786", slug: "fancy-mobile-number-00786", subcategories: [{ id: 18, name: "000786" }, { id: 34, name: "00786" }, { id: 39, name: "0786" }, { id: 65, name: "786*786" }, { id: 68, name: "786786" }] },
  { id: 23, name: "xxyyy xxxyy", slug: "online-VIP-mobile-number", subcategories: [] },
  { id: 24, name: "13 with Zeros", slug: "prepaid-fancy-numbers", subcategories: [{ id: 10, name: "0000013" }, { id: 27, name: "00013 / 000013" }, { id: 38, name: "01313" }, { id: 42, name: "13000" }] },
  { id: 25, name: "13 Repeating", slug: "vip-number-1313", subcategories: [{ id: 10, name: "0000013" }, { id: 27, name: "00013 / 000013" }, { id: 38, name: "01313" }, { id: 42, name: "13000" }, { id: 43, name: "1313" }, { id: 45, name: "13x13" }, { id: 56, name: "3 times 13" }] },
  { id: 32, name: "xyxy (2 times)", slug: "vip-mobile-number-india", subcategories: [{ id: 25, name: "0000xyxy" }, { id: 4, name: "0/00xyxy" }, { id: 29, name: "000xyxy" }, { id: 121, name: "xy-a-xyxy" }, { id: 122, name: "xyxy" }, { id: 123, name: "xyxy0 / 00" }] },
  { id: 33, name: "xy*xy", slug: "xy-xy-fancy-mobile-number", subcategories: [{ id: 70, name: "Full Symmery xy*xy" }, { id: 117, name: "xy*xy" }, { id: 119, name: "xy0xy" }] },
  { id: 42, name: "Special Charactors/Digits", slug: "vip-number-sim-card", subcategories: [{ id: 41, name: "108-1008" }, { id: 77, name: "Acts-302-307-751-720 etc" }, { id: 85, name: "Vichle 855-5911" }, { id: 134, name: "Years Words Etc." }] },
  { id: 45, name: "Normal Fancy Numbers", slug: "golden-mobile-number", subcategories: [{ id: 92, name: "Others" }, { id: 122, name: "xyxy" }, { id: 123, name: "xyxy0 / 00" }, { id: 131, name: "xyz00" }, { id: 149, name: "End xxx" }] },
  { id: 46, name: "00x00", slug: "00x00-fancy-number", subcategories: [{ id: 35, name: "00x00" }, { id: 108, name: "x00x00" }, { id: 36, name: "00ab00xy" }] },
];

// ─── Public API ─────────────────────────────────────────────────────────────────

const CATEGORY_BY_ID = new Map<CategoryId, Category>(CATEGORY_TAXONOMY.map((c) => [c.id, c]));

export function getCategoryById(catId: CategoryId): Category | undefined {
  return CATEGORY_BY_ID.get(catId);
}

export function getSubcategoriesForCategory(catId: CategoryId): Subcategory[] {
  return CATEGORY_BY_ID.get(catId)?.subcategories ?? [];
}

export function getSubcategoryName(catId: CategoryId, subId: SubcategoryId): string | undefined {
  return getSubcategoriesForCategory(catId).find((s) => s.id === subId)?.name;
}

/** True if a mobile number matches a specific subcategory. */
export function matchesSubcategory(mobile: string, subId: SubcategoryId): boolean {
  const n = normalize(mobile);
  if (n.length !== 10) return false;
  const fn = SUBCATEGORY_MATCHERS[subId];
  return fn ? fn(n) : false;
}

/**
 * True if a number belongs to a category.
 * Uses the broad category matcher when defined; otherwise the union (OR) of the
 * category's subcategory matchers (this powers the per-category "All" tab).
 */
export function matchesCategory(mobile: string, catId: CategoryId): boolean {
  const n = normalize(mobile);
  if (n.length !== 10) return false;
  const broad = CATEGORY_MATCHERS[catId];
  if (broad) return broad(n);
  const subs = getSubcategoriesForCategory(catId);
  return subs.some((s) => {
    const fn = SUBCATEGORY_MATCHERS[s.id];
    return fn ? fn(n) : false;
  });
}

/** Filter a list of records by a subcategory. `getMobile` extracts the number string. */
export function filterBySubcategory<T>(items: T[], subId: SubcategoryId, getMobile: (item: T) => string): T[] {
  return items.filter((it) => matchesSubcategory(getMobile(it), subId));
}

/** Filter a list of records by a category (broad / union of its subcategories). */
export function filterByCategory<T>(items: T[], catId: CategoryId, getMobile: (item: T) => string): T[] {
  return items.filter((it) => matchesCategory(getMobile(it), catId));
}

/** For "check a number": every category it belongs to, with the matching subcategories. */
export function getMatchingCategories(mobile: string): { category: Category; subcategories: Subcategory[] }[] {
  const n = normalize(mobile);
  if (n.length !== 10) return [];
  const result: { category: Category; subcategories: Subcategory[] }[] = [];
  for (const category of CATEGORY_TAXONOMY) {
    const matchedSubs = category.subcategories.filter((s) => {
      const fn = SUBCATEGORY_MATCHERS[s.id];
      return fn ? fn(n) : false;
    });
    if (matchedSubs.length > 0 || matchesCategory(n, category.id)) {
      result.push({ category, subcategories: matchedSubs });
    }
  }
  return result;
}
