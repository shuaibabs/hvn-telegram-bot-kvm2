import { format, parse, isValid } from 'date-fns';
import { Timestamp } from 'firebase-admin/firestore';

export const DATE_FORMAT = 'dd/MM/yyyy';

/**
 * Formats a Date or Firestore Timestamp into a DD/MM/YYYY string.
 */
export function formatToDDMMYYYY(date: Date | Timestamp | null | undefined): string {
    if (!date) return 'N/A';
    
    if (date instanceof Timestamp) {
        return format(date.toDate(), DATE_FORMAT);
    }
    
    if (date instanceof Date) {
        return format(date, DATE_FORMAT);
    }

    return 'N/A';
}

/**
 * Parses a string in DD/MM/YYYY format into a Date object.
 * Returns null if invalid.
 */
export function parseFromDDMMYYYY(dateStr: string): Date | null {
    if (!dateStr) return null;
    
    try {
        const parsedDate = parse(dateStr, DATE_FORMAT, new Date());
        return isValid(parsedDate) ? parsedDate : null;
    } catch {
        return null;
    }
}
