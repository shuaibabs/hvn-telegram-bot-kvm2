import type { NumberRecord } from '../types/data';

// Keep validation and clipboard output equivalent to the dashboard's number-actions.ts.
export function analyzeNumberEntries(input: string, numbers: NumberRecord[]) {
    const seen = new Set<string>();
    const inventory = new Map<string, NumberRecord[]>();
    for (const number of numbers) inventory.set(number.mobile, [...(inventory.get(number.mobile) || []), number]);
    return input.split(/[,\r\n]+/).map(value => value.trim()).filter(Boolean).map(mobile => {
        if (!/^\d{10}$/.test(mobile)) return { mobile, issue: 'Invalid: enter exactly 10 digits', number: undefined };
        if (seen.has(mobile)) return { mobile, issue: 'Duplicate entry: will be skipped', number: undefined };
        seen.add(mobile);
        const matches = inventory.get(mobile) || [];
        if (matches.length > 1) return { mobile, issue: 'Multiple inventory records: resolve the duplicate first', number: undefined };
        if (!matches.length) return { mobile, issue: 'Not available in your inventory (missing, sold, pre-booked, or not assigned to you)', number: undefined };
        return { mobile, issue: '', number: matches[0] };
    });
}

export function locationClipboardText(numbers: Pick<NumberRecord, 'mobile' | 'currentLocation'>[]) {
    return numbers.map(number => `${number.mobile}\t${(number.currentLocation || 'N/A').replace(/[\r\n\t]+/g, ' ')}`).join('\n');
}

/** Telegram uses DD/MM/YYYY; ISO input is also accepted. Always store midnight IST. */
export function inventoryDateFromInput(input: string): Date | null {
    const value = input.trim().replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, '$3-$2-$1');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00+05:30`);
    const parts = value.split('-').map(Number);
    const india = new Date(date.getTime() + 330 * 60000);
    return india.getUTCFullYear() === parts[0] && india.getUTCMonth() + 1 === parts[1] && india.getUTCDate() === parts[2] ? date : null;
}
