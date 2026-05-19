import { db } from '../../config/firebase';
import { NumberRecord } from '../../shared/types/data';
import { CATEGORIES, CategoryKey } from '../../shared/utils/vipNumberFilters';

/**
 * Fetch all active inventory numbers.
 */
export async function getInventoryNumbers(): Promise<NumberRecord[]> {
    const snapshot = await db.collection('numbers').get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as NumberRecord));
}

/**
 * Get all categories with matching number counts.
 */
export async function getCategoriesWithCounts() {
    const numbers = await getInventoryNumbers();
    return CATEGORIES.map(cat => {
        const count = numbers.filter(num => cat.check(num.mobile)).length;
        return {
            ...cat,
            count
        };
    });
}

/**
 * Get all numbers matching a specific category.
 */
export async function getNumbersInCategory(categoryKey: CategoryKey): Promise<NumberRecord[]> {
    const cat = CATEGORIES.find(c => c.key === categoryKey);
    if (!cat) return [];
    const numbers = await getInventoryNumbers();
    return numbers.filter(num => cat.check(num.mobile));
}
