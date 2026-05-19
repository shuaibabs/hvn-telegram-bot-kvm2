/**
 * VIP Mobile Number Category Filter Logic
 * Based on NumberATM.com categories
 *
 * Indian mobile numbers are 10 digits (e.g., 9876543210).
 * All logic below operates on the full 10-digit string.
 *
 * NOTATION used in comments:
 *   A, B, C, D, X, Y, Z  = any digit (each letter = one specific digit)
 *   Same letter           = same digit repeated
 *   0                     = literal zero
 *   n = total digits in the number
 */

// ─── Utility Helpers ──────────────────────────────────────────────────────────

/** Extract the 10-digit body (strips country code prefix if present) */
export function normalize(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

/** Check that every digit in `str` is NOT in `forbidden` set */
export function hasNoneOf(str: string, forbidden: string[]): boolean {
  return str.split("").every((d) => !forbidden.includes(d));
}

/** Return the digit sum reduced to a single digit (numerology root) */
export function numerologyRoot(n: string): number {
  let sum = n.split("").reduce((a, c) => a + parseInt(c), 0);
  while (sum > 9) sum = String(sum).split("").reduce((a, c) => a + parseInt(c), 0);
  return sum;
}

/** Count consecutive runs of the same digit */
export function longestRepeatRun(n: string): number {
  let max = 1, cur = 1;
  for (let i = 1; i < n.length; i++) {
    cur = n[i] === n[i - 1] ? cur + 1 : 1;
    if (cur > max) max = cur;
  }
  return max;
}

/** Get all substrings of exactly `len` chars */
export function substrings(n: string, len: number): string[] {
  const result: string[] = [];
  for (let i = 0; i <= n.length - len; i++) result.push(n.slice(i, i + len));
  return result;
}

/** True if `n` contains a run of exactly `count` identical digits */
export function hasRepeatBlock(n: string, count: number): boolean {
  const re = new RegExp(`(\\d)\\1{${count - 1}}`);
  return re.test(n);
}

/** All characters are the same */
export function allSame(s: string): boolean {
  return s.split("").every((c) => c === s[0]);
}

// ─── Individual Category Checkers ─────────────────────────────────────────────

/**
 * 1. NUMEROLOGY WITHOUT 2, 4, 8
 * The number contains NONE of the digits 2, 4, or 8.
 * Popular for numerological/astrological preference.
 *
 * Examples: 9999999999, 9111999999, 9777011111
 */
export function isNumerologyWithout248(number: string): boolean {
  const n = normalize(number);
  return n.length === 10 && hasNoneOf(n, ["2", "4", "8"]);
}

/**
 * 2. PENTA NUMBERS
 * Contains a group of exactly 5 identical consecutive digits anywhere.
 *
 * Pattern: *AAAAA*  (5+ same digits in a row)
 * Examples: 9999900000, 9881111119, 7700000077
 */
export function isPentaNumber(number: string): boolean {
  const n = normalize(number);
  return /(\d)\1{4}/.test(n); // 5 or more same digits in a row
}

/**
 * 3. HEXA NUMBER
 * Contains a group of exactly 6 identical consecutive digits anywhere.
 *
 * Pattern: *AAAAAA*  (6+ same digits in a row)
 * Examples: 9999999000, 7711111110
 */
export function isHexaNumber(number: string): boolean {
  const n = normalize(number);
  return /(\d)\1{5}/.test(n); // 6 or more same digits in a row
}

/**
 * 4. SEPTA — Pattern: 9XY AAA AAA A
 * The number has the form: 9 X Y [A A A] [A A A] A
 * i.e., positions 0='9', 1=any, 2=any, then digits 3-9 are all one repeated digit
 *
 * Example: 9876666666  → 9, 8, 7, then 7× '6'
 */
export function isSeptaNumber(number: string): boolean {
  const n = normalize(number);
  if (n.length !== 10 || n[0] !== "9") return false;
  // digits 3..9 (7 digits) must all be the same
  const tail = n.slice(3); // 7 chars
  return tail.length === 7 && allSame(tail);
}

/**
 * 5. ENDING AAAA NUMBERS
 * The last 4 digits are the same.
 *
 * Pattern: XXXXXX AAAA
 * Examples: 9876541111, 9999990000, 9988770000
 */
export function isEndingAAAA(number: string): boolean {
  const n = normalize(number);
  const tail = n.slice(-4);
  return allSame(tail);
}

/**
 * 6. AB AB — Pattern: XXXXXX 1212  (last 4 = ABAB)
 * The last 4 digits form an alternating pair pattern.
 *
 * Condition: n[6]===n[8] AND n[7]===n[9] AND n[6]!==n[7]
 * Examples: 9876541212, 9988773434
 */
export function isAbAbEnding(number: string): boolean {
  const n = normalize(number);
  if (n.length !== 10) return false;
  const [a, b, c, d] = [n[6], n[7], n[8], n[9]];
  return a === c && b === d && a !== b;
}

/**
 * 7. ABC ABC NUMBERS
 * A 3-digit sequence is repeated twice consecutively in the number.
 *
 * Pattern: XXXX [ABC][ABC]  or  [ABC][ABC] XXXX  or anywhere inside
 * We check: any 3-char window where that window repeats immediately after it.
 *
 * Examples: 9898989898 (98 98 98...), 9999123123, 9988456456
 */
export function isAbcAbcNumber(number: string): boolean {
  const n = normalize(number);
  for (let i = 0; i <= n.length - 6; i++) {
    const seg = n.slice(i, i + 3);
    if (n.slice(i + 3, i + 6) === seg) return true;
  }
  return false;
}

/**
 * 8. MIRROR NUMBERS
 * The number reads the same forwards and backwards (palindrome).
 *
 * Pattern: ABCDEEDCBA  (full 10-digit palindrome)
 * Examples: 9876556789, 9988008899
 */
export function isMirrorNumber(number: string): boolean {
  const n = normalize(number);
  return n === n.split("").reverse().join("");
}

/**
 * 9. SEMI MIRROR NUMBERS
 * The second half (last 5 digits) is the reverse of the first half (first 5 digits).
 * Similar to a mirror but the center pivot can differ.
 *
 * Also accepted: A 6-digit or 8-digit palindrome embedded inside the number,
 * OR the last 5 digits reversed equal the first 5.
 *
 * Strict definition used here: first half reversed = second half
 * Examples: 9876598765 → NO. 9876554321 → check. 9988776789...
 *
 * We use: digits[0..4] reversed === digits[5..9]
 */
export function isSemiMirrorNumber(number: string): boolean {
  const n = normalize(number);
  if (n.length !== 10) return false;
  const firstHalf = n.slice(0, 5);
  const secondHalf = n.slice(5);
  // Check if second half is reverse of first half (strict mirror)
  if (secondHalf === firstHalf.split("").reverse().join("")) return true;
  // OR: any 6-digit palindrome exists within the number
  for (let i = 0; i <= n.length - 6; i++) {
    const seg = n.slice(i, i + 6);
    if (seg === seg.split("").reverse().join("")) return true;
  }
  return false;
}

/**
 * 10. 123456 NUMBERS (Sequential / Ascending / Descending)
 * Contains a run of 4+ consecutive ascending OR descending digits.
 *
 * Examples: 9876123456, 9999876543, 9812345678
 */
export function isSequentialNumber(number: string): boolean {
  const n = normalize(number);
  const digits = n.split("").map(Number);
  let ascRun = 1, descRun = 1;
  for (let i = 1; i < digits.length; i++) {
    ascRun = digits[i] === digits[i - 1] + 1 ? ascRun + 1 : 1;
    descRun = digits[i] === digits[i - 1] - 1 ? descRun + 1 : 1;
    if (ascRun >= 4 || descRun >= 4) return true;
  }
  return false;
}

/**
 * 11. 786 NUMBERS
 * Contains the substring "786" anywhere (Islamic lucky number).
 *
 * Examples: 9997861234, 9878600786, 7861234567
 */
export function is786Number(number: string): boolean {
  return normalize(number).includes("786");
}

/**
 * 12. 11 12 13 NUMBERS
 * Contains any of the sub-sequences: 11, 22, 33, ... 99 (double-digit pair)
 * OR sequential pairs: 12, 23, 34, 45 etc.
 * Specifically: contains "11" "12" "13" pattern = number has pairs like 11,12,13 within it.
 *
 * Interpretation: The number contains at least one pair of consecutive identical digits
 * (like 11, 22, 33) OR a sequential trio (12, 13, 21, etc.).
 *
 * Practical definition: contains "1112", "1213", or any triple/double consecutive pair.
 * We use: contains a double digit (AA) anywhere.
 */
export function is111213Number(number: string): boolean {
  const n = normalize(number);
  // Contains any double-digit pair like 11, 22, 33 ...
  if (/(\d)\1/.test(n)) return true;
  // OR contains a run of 3 sequential digits like 123, 234, 345... (ascending or descending)
  const digits = n.split("").map(Number);
  for (let i = 0; i < digits.length - 2; i++) {
    if (
      digits[i + 1] === digits[i] + 1 &&
      digits[i + 2] === digits[i] + 2
    )
      return true;
  }
  return false;
}

/**
 * 13. UNIQUE NUMBERS
 * All 10 digits in the number are distinct (no digit repeats at all).
 *
 * Examples: 9876543210, 9012345678
 */
export function isUniqueNumber(number: string): boolean {
  const n = normalize(number);
  return new Set(n.split("")).size === 10;
}

/**
 * 14. AAA BBB
 * Contains a block of 3 same digits followed immediately by a block of 3 different same digits.
 *
 * Pattern: ...AAABBB...  (anywhere in the number)
 * Examples: 9999111222, 9966600077, 9988833300
 */
export function isAaaBbb(number: string): boolean {
  const n = normalize(number);
  // Find any position where 3 same digits followed by 3 same (different) digits
  for (let i = 0; i <= n.length - 6; i++) {
    const a = n.slice(i, i + 3);
    const b = n.slice(i + 3, i + 6);
    if (allSame(a) && allSame(b) && a[0] !== b[0]) return true;
  }
  return false;
}

/**
 * 15. XY XY XY NUMBERS
 * A 2-digit pair repeated 3 times consecutively (total 6 chars).
 *
 * Pattern: [AB][AB][AB]  anywhere in the number
 * Examples: 9999121212, 9878787878, 9900000000 → NO but 9912121212 → YES
 */
export function isXyXyXy(number: string): boolean {
  const n = normalize(number);
  for (let i = 0; i <= n.length - 6; i++) {
    const ab = n.slice(i, i + 2);
    if (n.slice(i + 2, i + 4) === ab && n.slice(i + 4, i + 6) === ab) return true;
  }
  return false;
}

/**
 * 16. DOUBLING NUMBERS
 * A digit pattern where each group doubles (or a segment that doubles).
 * e.g., 1122 → 11 then 22 (each digit used twice)
 * More broadly: contains a pair that doubles: AB → AABB or a pattern like 1248.
 *
 * Practical interpretation: contains a 4-digit block XXYY where X≠Y
 * (each digit repeated twice in succession)
 * Examples: 9911002233, 9988776655
 */
export function isDoublingNumber(number: string): boolean {
  const n = normalize(number);
  // Check for XXYY block (any two different pairs back to back)
  for (let i = 0; i <= n.length - 4; i++) {
    const [a, b, c, d] = [n[i], n[i + 1], n[i + 2], n[i + 3]];
    if (a === b && c === d && a !== c) return true;
  }
  return false;
}

/**
 * 17. ENDING AAA NUMBERS
 * The last 3 digits are the same.
 *
 * Pattern: XXXXXXX AAA
 * Examples: 9876541110, 9999990000 → (also matches AAAA), 9988774440
 */
export function isEndingAAA(number: string): boolean {
  const n = normalize(number);
  const tail = n.slice(-3);
  return allSame(tail);
}

/**
 * 18. AB XYXYXYXY
 * First 2 digits are a prefix (AB), followed by an 8-digit alternating pattern (XYXYXYXY).
 *
 * Pattern: [A][B][X][Y][X][Y][X][Y][X][Y]
 * i.e., last 8 digits alternate between X and Y (X≠Y)
 * Examples: 9812121212, 9898989898, 9834343434
 */
export function isAbXyXyXyXy(number: string): boolean {
  const n = normalize(number);
  if (n.length !== 10) return false;
  const tail = n.slice(2); // 8 chars
  const x = tail[0], y = tail[1];
  if (x === y) return false;
  for (let i = 0; i < 8; i++) {
    if (i % 2 === 0 && tail[i] !== x) return false;
    if (i % 2 === 1 && tail[i] !== y) return false;
  }
  return true;
}

/**
 * 19. ABCD ABCD NUMBERS
 * A 4-digit sequence repeated twice consecutively.
 *
 * Pattern: [ABCD][ABCD] somewhere in the number (8 chars total)
 * Examples: 9912341234, 9956785678, 9999123123 (this is ABC ABC too)
 */
export function isAbcdAbcd(number: string): boolean {
  const n = normalize(number);
  for (let i = 0; i <= n.length - 8; i++) {
    const seg = n.slice(i, i + 4);
    if (n.slice(i + 4, i + 8) === seg) return true;
  }
  return false;
}

/**
 * 20. AAAA BBBB NUMBERS
 * Contains a block of 4 same digits followed immediately by 4 same (different) digits.
 *
 * Pattern: [AAAA][BBBB] anywhere (total 8 chars, A≠B)
 * Examples: 9911112222, 9900001111
 */
export function isAAAABBBB(number: string): boolean {
  const n = normalize(number);
  for (let i = 0; i <= n.length - 8; i++) {
    const a = n.slice(i, i + 4);
    const b = n.slice(i + 4, i + 8);
    if (allSame(a) && allSame(b) && a[0] !== b[0]) return true;
  }
  return false;
}

/**
 * 21. 3 DIGITS NUMBER
 * The entire number uses only 3 distinct digits.
 *
 * Examples: 9999900111, 9876789678 → NO (6 distinct). 9911199119 → YES (1,9)
 * Strictly 3 distinct: 9998881110 → 9,8,1,0 = 4 distinct → NO
 * 9991110000 → 9,1,0 = 3 distinct → YES
 */
export function is3DigitNumber(number: string): boolean {
  const n = normalize(number);
  return new Set(n.split("")).size === 3;
}

/**
 * 22. AB AB XY XY  (alternating pair-pairs)
 * The 10-digit number splits into 5 pairs, where pairs alternate: ABABXYXY??
 * More precisely: contains a block [AB][AB][XY][XY] (8 chars) where AB≠XY.
 *
 * Pattern: first two pairs are AB,AB and next two pairs are XY,XY; AB≠XY
 * Examples: 9912121313, 9900110011
 *
 * Also interpreted as: positions form ABABXYXY in any 8-char window
 */
export function isAbAbXyXy(number: string): boolean {
  const n = normalize(number);
  for (let i = 0; i <= n.length - 8; i++) {
    const [a, b, c, d, e, f, g, h] = n.slice(i, i + 8).split("");
    const abPairMatch = a === c && b === d; // AB AB
    const xyPairMatch = e === g && f === h; // XY XY
    const pairsDistinct = !(a === e && b === f); // AB ≠ XY
    if (abPairMatch && xyPairMatch && pairsDistinct) return true;
  }
  return false;
}

/**
 * 23. AAA XY AAA
 * A block of 3 same digits, then 2 arbitrary digits, then the same 3-digit block again.
 *
 * Pattern: [AAA][X][Y][AAA]  (total 8 chars, A is same digit)
 * Examples: 9999119990, 9888129880
 *           9 888 12 888 → YES (if normalized = 9888128880 → check)
 */
export function isAaaXyAaa(number: string): boolean {
  const n = normalize(number);
  for (let i = 0; i <= n.length - 8; i++) {
    const left = n.slice(i, i + 3);
    const right = n.slice(i + 5, i + 8);
    if (allSame(left) && left === right) return true;
  }
  return false;
}

/**
 * 24. AOOB COOD / ABOO CDOO / OOOAB
 * Numbers with zeros creating symmetrical gaps.
 *
 * Three sub-patterns:
 *   a) AOOB COOD — digit, 00, digit, digit, 00, digit pattern
 *      e.g., A00B C00D somewhere in 8 chars
 *   b) ABOO CDOO — pair, 00, pair, 00 pattern
 *      e.g., AB00 CD00 somewhere in 8 chars
 *   c) OOOAB — starts or ends with 3 zeros then 2 digits
 *      e.g., 000AB anywhere
 */
export function isZeroGapPattern(number: string): boolean {
  const n = normalize(number);

  // a) A00B C00D pattern (8-char window)
  for (let i = 0; i <= n.length - 8; i++) {
    const seg = n.slice(i, i + 8);
    if (
      seg[1] === "0" && seg[2] === "0" &&
      seg[5] === "0" && seg[6] === "0" &&
      seg[0] !== "0" && seg[3] !== "0" &&
      seg[4] !== "0" && seg[7] !== "0"
    ) return true;
  }

  // b) AB00 CD00 pattern (8-char window)
  for (let i = 0; i <= n.length - 8; i++) {
    const seg = n.slice(i, i + 8);
    if (
      seg[2] === "0" && seg[3] === "0" &&
      seg[6] === "0" && seg[7] === "0"
    ) return true;
  }

  // c) 000AB — triple zero followed by 2 non-zero digits
  if (/000[1-9]{2}/.test(n)) return true;

  return false;
}

/**
 * 25. AAAA MIDDLE
 * A block of 4 same digits appears in the middle of the number (positions 3–6).
 *
 * For 10-digit numbers the "middle" is positions 3,4,5,6 (0-indexed).
 * Pattern: XXX [AAAA] XXX
 * Examples: 9871111098, 9870000098
 */
export function isAAAAMiddle(number: string): boolean {
  const n = normalize(number);
  if (n.length !== 10) return false;
  // Middle 4 digits: index 3,4,5,6
  const mid = n.slice(3, 7);
  return allSame(mid);
}

/**
 * 26. AO BO CO DO EO  (alternating digit-zero pairs)
 * The number consists of alternating digit-zero pairs.
 *
 * Pattern: A0 B0 C0 D0 E0  (every even-indexed digit is non-zero, every odd is 0)
 * For 10 digits: positions 1,3,5,7,9 are all '0'; positions 0,2,4,6,8 are non-zero.
 * Examples: 9080706050, 9070503010
 */
export function isAoBoCoDo(number: string): boolean {
  const n = normalize(number);
  if (n.length !== 10) return false;
  // odd positions (1,3,5,7,9) must be '0'; even positions must be non-'0'
  for (let i = 0; i < 10; i++) {
    if (i % 2 === 1 && n[i] !== "0") return false;
    if (i % 2 === 0 && n[i] === "0") return false;
  }
  return true;
}

/**
 * 27. AAA MIDDLE  (3 same digits in the middle)
 * A block of 3 same digits appears around the center of the 10-digit number.
 *
 * "Middle" = positions 3,4,5 OR 4,5,6 (the two central triplet windows).
 * Examples: 9876111098, 9870000098 → also matches AAAA middle
 */
export function isAAAMiddle(number: string): boolean {
  const n = normalize(number);
  if (n.length !== 10) return false;
  const mid1 = n.slice(3, 6); // positions 3,4,5
  const mid2 = n.slice(4, 7); // positions 4,5,6
  return allSame(mid1) || allSame(mid2);
}

/**
 * 28. AOO BOO / AOO BOO COO  (digit followed by two zeros, repeated)
 * Pattern of [digit][00] repeated 2 or 3 times.
 *
 * For 2 repetitions (AOO BOO) — 6-char window: X00 Y00
 * For 3 repetitions (AOO BOO COO) — 9-char window: X00 Y00 Z00
 * Examples: 9900800700, 9500600700
 */
export function isAooBoo(number: string): boolean {
  const n = normalize(number);

  // AOO BOO COO (9 chars)
  for (let i = 0; i <= n.length - 9; i++) {
    const seg = n.slice(i, i + 9);
    if (
      seg[1] === "0" && seg[2] === "0" &&
      seg[4] === "0" && seg[5] === "0" &&
      seg[7] === "0" && seg[8] === "0"
    ) return true;
  }

  // AOO BOO (6 chars)
  for (let i = 0; i <= n.length - 6; i++) {
    const seg = n.slice(i, i + 6);
    if (
      seg[1] === "0" && seg[2] === "0" &&
      seg[4] === "0" && seg[5] === "0" &&
      seg[0] !== "0" && seg[3] !== "0"
    ) return true;
  }

  return false;
}

/**
 * 29. START A OOO B END A OOO B
 * The number starts with a digit A, has 3 zeros, another digit B,
 * and the same pattern repeats at the end.
 *
 * Pattern: [A][000][B]...[A][000][B]  — the prefix A000B appears twice
 * For 10 digits: A000B A000B exactly = AOOOB AOOOB
 * Examples: 9000190001, 8000280002
 */
export function isStartAOOOBEndAOOOB(number: string): boolean {
  const n = normalize(number);
  if (n.length !== 10) return false;
  // Strict: first 5 = last 5 AND has pattern X000Y
  const first = n.slice(0, 5);
  const last = n.slice(5);
  if (first !== last) return false;
  // Pattern check: X 000 Y
  return first[1] === "0" && first[2] === "0" && first[3] === "0";
}

// ─── Category Map & Master Filter ─────────────────────────────────────────────

export type CategoryKey =
  | "numerology-without-2-4-8"
  | "penta-numbers"
  | "hexa-number"
  | "septa"
  | "ending-aaaa"
  | "ab-ab"
  | "abc-abc"
  | "mirror"
  | "semi-mirror"
  | "sequential-123456"
  | "786"
  | "11-12-13"
  | "unique"
  | "aaa-bbb"
  | "xy-xy-xy"
  | "doubling"
  | "ending-aaa"
  | "ab-xyxyxyxy"
  | "abcd-abcd"
  | "aaaa-bbbb"
  | "3-digits"
  | "ab-ab-xy-xy"
  | "aaa-xy-aaa"
  | "zero-gap"
  | "aaaa-middle"
  | "ao-bo-co-do"
  | "aaa-middle"
  | "aoo-boo"
  | "start-a-ooo-b";

export interface CategoryDefinition {
  key: CategoryKey;
  label: string;
  description: string;
  check: (number: string) => boolean;
}

export const CATEGORIES: CategoryDefinition[] = [
  {
    key: "numerology-without-2-4-8",
    label: "Numerology Without 2 4 8",
    description: "No digit 2, 4, or 8 appears anywhere in the number.",
    check: isNumerologyWithout248,
  },
  {
    key: "penta-numbers",
    label: "Penta Numbers",
    description: "5 or more consecutive identical digits.",
    check: isPentaNumber,
  },
  {
    key: "hexa-number",
    label: "Hexa Number",
    description: "6 or more consecutive identical digits.",
    check: isHexaNumber,
  },
  {
    key: "septa",
    label: "Septa (9XY AAA AAA A)",
    description: "Starts with 9XY followed by 7 identical digits.",
    check: isSeptaNumber,
  },
  {
    key: "ending-aaaa",
    label: "Ending AAAA Numbers",
    description: "Last 4 digits are all the same.",
    check: isEndingAAAA,
  },
  {
    key: "ab-ab",
    label: "AB AB (XXXXXX 1212)",
    description: "Last 4 digits form an alternating pair (ABAB).",
    check: isAbAbEnding,
  },
  {
    key: "abc-abc",
    label: "ABC ABC Numbers",
    description: "A 3-digit sequence repeated consecutively.",
    check: isAbcAbcNumber,
  },
  {
    key: "mirror",
    label: "Mirror Numbers",
    description: "Full 10-digit palindrome (reads same forwards & backwards).",
    check: isMirrorNumber,
  },
  {
    key: "semi-mirror",
    label: "Semi Mirror Numbers",
    description: "Second half is the reverse of first half, or contains a 6-digit palindrome.",
    check: isSemiMirrorNumber,
  },
  {
    key: "sequential-123456",
    label: "123456 Numbers",
    description: "Contains 4+ consecutive ascending or descending digits.",
    check: isSequentialNumber,
  },
  {
    key: "786",
    label: "786 Numbers",
    description: "Contains the lucky/holy sequence '786'.",
    check: is786Number,
  },
  {
    key: "11-12-13",
    label: "11 12 13 Numbers",
    description: "Contains a double-digit pair or sequential triple.",
    check: is111213Number,
  },
  {
    key: "unique",
    label: "Unique Numbers",
    description: "All 10 digits are distinct (each digit 0–9 appears exactly once).",
    check: isUniqueNumber,
  },
  {
    key: "aaa-bbb",
    label: "AAA BBB",
    description: "A block of 3 same digits immediately followed by 3 different same digits.",
    check: isAaaBbb,
  },
  {
    key: "xy-xy-xy",
    label: "XY XY XY Numbers",
    description: "A 2-digit pair repeated 3 times consecutively.",
    check: isXyXyXy,
  },
  {
    key: "doubling",
    label: "Doubling Numbers",
    description: "Contains an XXYY block (two consecutive double-digit pairs).",
    check: isDoublingNumber,
  },
  {
    key: "ending-aaa",
    label: "Ending AAA Numbers",
    description: "Last 3 digits are all the same.",
    check: isEndingAAA,
  },
  {
    key: "ab-xyxyxyxy",
    label: "AB XYXYXYXY",
    description: "First 2 digits are a prefix; last 8 digits are a strict alternating XY pattern.",
    check: isAbXyXyXyXy,
  },
  {
    key: "abcd-abcd",
    label: "ABCD ABCD Numbers",
    description: "A 4-digit sequence repeated consecutively.",
    check: isAbcdAbcd,
  },
  {
    key: "aaaa-bbbb",
    label: "AAAA BBBB Numbers",
    description: "4 same digits immediately followed by 4 different same digits.",
    check: isAAAABBBB,
  },
  {
    key: "3-digits",
    label: "3 Digits Number",
    description: "The entire 10-digit number uses only 3 distinct digits.",
    check: is3DigitNumber,
  },
  {
    key: "ab-ab-xy-xy",
    label: "AB AB XY XY",
    description: "An 8-char block where two alternating pairs are followed by two other alternating pairs.",
    check: isAbAbXyXy,
  },
  {
    key: "aaa-xy-aaa",
    label: "AAA XY AAA",
    description: "3 same digits, 2 arbitrary digits, then the same 3 digits again.",
    check: isAaaXyAaa,
  },
  {
    key: "zero-gap",
    label: "AOOB COOD / ABOO CDOO / OOOAB",
    description: "Zeros used as symmetrical gaps (A00B pattern, AB00 pattern, or 000AB).",
    check: isZeroGapPattern,
  },
  {
    key: "aaaa-middle",
    label: "AAAA Middle",
    description: "4 identical digits appear in the middle (positions 3–6) of the number.",
    check: isAAAAMiddle,
  },
  {
    key: "ao-bo-co-do",
    label: "AO BO CO DO EO",
    description: "Alternating digit-zero pairs across the full 10-digit number.",
    check: isAoBoCoDo,
  },
  {
    key: "aaa-middle",
    label: "AAA Middle",
    description: "3 identical digits appear in the central positions (3–5 or 4–6).",
    check: isAAAMiddle,
  },
  {
    key: "aoo-boo",
    label: "AOO BOO / AOO BOO COO",
    description: "Digit followed by two zeros, repeated 2 or 3 times.",
    check: isAooBoo,
  },
  {
    key: "start-a-ooo-b",
    label: "START A OOO B END A OOO B",
    description: "Number is exactly A000B A000B (same 5-char pattern repeated twice).",
    check: isStartAOOOBEndAOOOB,
  },
];

/**
 * Returns all categories a given number belongs to.
 */
export function getCategories(number: string): CategoryKey[] {
  return CATEGORIES.filter((cat) => cat.check(number)).map((cat) => cat.key);
}

/**
 * Returns true if the number belongs to at least one of the given categories.
 */
export function matchesAnyCategory(
  number: string,
  categories: CategoryKey[]
): boolean {
  return categories.some((key) => {
    const def = CATEGORIES.find((c) => c.key === key);
    return def ? def.check(number) : false;
  });
}

/**
 * Returns true if the number belongs to ALL of the given categories.
 */
export function matchesAllCategories(
  number: string,
  categories: CategoryKey[]
): boolean {
  return categories.every((key) => {
    const def = CATEGORIES.find((c) => c.key === key);
    return def ? def.check(number) : false;
  });
}

/**
 * Filter an array of number strings to those matching ANY of the given categories.
 */
export function filterNumbers(
  numbers: string[],
  categories: CategoryKey[]
): string[] {
  if (categories.length === 0) return numbers;
  return numbers.filter((n) => matchesAnyCategory(n, categories));
}
