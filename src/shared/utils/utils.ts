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
