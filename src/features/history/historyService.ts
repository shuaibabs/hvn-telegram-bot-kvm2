import { db } from '../../config/firebase';
import { NumberRecord } from '../../shared/types/data';
import { logger } from '../../core/logger/logger';

/**
 * Searches for a number across all collections and returns details/history.
 * Role-based filtering: employees only see numbers assigned to them.
 */
export const getGlobalNumberHistory = async (mobile: string, employeeName?: string): Promise<{
    found: boolean,
    location: string,
    data: any
}> => {
    try {
        // Collections to search in order
        const collections = [
            { name: 'Inventory', id: 'numbers' },
            { name: 'Sales', id: 'sales' },
            { name: 'Prebooked', id: 'prebookings' },
            { name: 'Deleted', id: 'deletedNumbers' }
        ];

        for (const coll of collections) {
            let query: any = db.collection(coll.id).where('mobile', '==', mobile);
            
            // If employee, they must be assigned to the number
            // Note: For 'Sales', 'Prebooked', 'Deleted', the original assignedTo is inside originalNumberData
            const snapshot = await query.limit(1).get();
            if (!snapshot.empty) {
                const data = snapshot.docs[0].data();
                
                // Check assignment for employees
                if (employeeName) {
                    const assignedTo = data.assignedTo || data.originalNumberData?.assignedTo;
                    if (assignedTo !== employeeName) {
                        continue; // Keep searching or stop? User requirement says "for employee users list numbers only assigned to them"
                    }
                }

                return { found: true, location: coll.name, data };
            }
        }

        return { found: false, location: 'None', data: null };
    } catch (error: any) {
        logger.error(`Error in getGlobalNumberHistory: ${error.message}`);
        throw error;
    }
};
