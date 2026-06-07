import { Timestamp } from 'firebase-admin/firestore';

export const calculateDigitSum = (mobile: string): number => {
  if (!mobile) return 0;
  return mobile
    .toString()
    .replace(/\D/g, '') // remove non-digits
    .split('')
    .map(Number)
    .reduce((a, b) => a + b, 0);
};

export const calculateDigitalRoot = (mobile: string): number => {
  let sum = calculateDigitSum(mobile);
  while (sum > 9) {
    sum = sum
      .toString()
      .split('')
      .map(Number)
      .reduce((a, b) => a + b, 0);
  }
  return sum;
};

export const getCurrentTimestamp = (): Timestamp => {
  return Timestamp.now();
};

/**
 * Exact digit-placement match.
 *
 * `pattern` is a positional template (index 0 = the first digit of the number).
 * Any DIGIT in the pattern must appear at that exact position in the mobile number;
 * any non-digit character (e.g. `_`, `x`, `.`, space) is a wildcard meaning "any digit".
 * A blank pattern, or one with no fixed digits, matches everything.
 *
 * Example: pattern `9____5____` matches numbers whose 1st digit is 9 and 6th is 5.
 */
export const matchesExactPlacement = (mobile: string, pattern?: string): boolean => {
  if (!pattern || !/\d/.test(pattern)) return true;
  const m = (mobile || '').replace(/\D/g, '');
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c >= '0' && c <= '9' && m[i] !== c) return false;
  }
  return true;
};
