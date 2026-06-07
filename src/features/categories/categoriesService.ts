import { db } from '../../config/firebase';
import { NumberRecord } from '../../shared/types/data';
import {
    CATEGORY_TAXONOMY,
    Category,
    Subcategory,
    CategoryId,
    SubcategoryId,
    getCategoryById,
    matchesCategory,
    matchesSubcategory,
} from '../../shared/utils/vipNumberCategories';

/**
 * Fetch all active inventory numbers.
 */
export async function getInventoryNumbers(): Promise<NumberRecord[]> {
    const snapshot = await db.collection('numbers').get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as NumberRecord));
}

/**
 * Get all top-level categories with how many in-stock numbers match each.
 */
export async function getCategoriesWithCounts(): Promise<(Category & { count: number })[]> {
    const numbers = await getInventoryNumbers();
    return CATEGORY_TAXONOMY.map(cat => ({
        ...cat,
        count: numbers.filter(num => matchesCategory(num.mobile, cat.id)).length,
    }));
}

/**
 * Get the subcategories of a category, each with its in-stock match count, plus
 * the category-level total (the "All" entry).
 */
export async function getSubcategoriesWithCounts(
    catId: CategoryId
): Promise<{ category: Category; allCount: number; subcategories: (Subcategory & { count: number })[] }> {
    const category = getCategoryById(catId);
    if (!category) return { category: { id: catId, name: 'Unknown', slug: '', subcategories: [] }, allCount: 0, subcategories: [] };
    const numbers = await getInventoryNumbers();
    const allCount = numbers.filter(num => matchesCategory(num.mobile, catId)).length;
    const subcategories = category.subcategories.map(sub => ({
        ...sub,
        count: numbers.filter(num => matchesSubcategory(num.mobile, sub.id)).length,
    }));
    return { category, allCount, subcategories };
}

/**
 * Get all in-stock numbers matching a whole category (its "All" tab).
 */
export async function getNumbersInCategory(catId: CategoryId): Promise<NumberRecord[]> {
    const numbers = await getInventoryNumbers();
    return numbers.filter(num => matchesCategory(num.mobile, catId));
}

/**
 * Get all in-stock numbers matching a specific subcategory.
 */
export async function getNumbersInSubcategory(subId: SubcategoryId): Promise<NumberRecord[]> {
    const numbers = await getInventoryNumbers();
    return numbers.filter(num => matchesSubcategory(num.mobile, subId));
}
