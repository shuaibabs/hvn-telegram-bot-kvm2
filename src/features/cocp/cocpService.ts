import { db } from '../../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';
import { NumberRecord } from '../../shared/types/data';
import { logger } from '../../core/logger/logger';

/**
 * Gets numbers where numberType is 'COCP' with optional employee filtering.
 */
export const getCOCPNumbers = async (employeeName?: string): Promise<NumberRecord[]> => {
    try {
        let query: any = db.collection('numbers').where('numberType', '==', 'COCP');
        if (employeeName) {
            query = query.where('assignedTo', '==', employeeName);
        }
        const snapshot = await query.get();
        const results = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as NumberRecord));
        return results.sort((a: NumberRecord, b: NumberRecord) => (b.srNo || 0) - (a.srNo || 0));
    } catch (error: any) {
        logger.error(`Error in getCOCPNumbers: ${error.message}`);
        throw error;
    }
};

/**
 * Advanced search for COCP numbers.
 */
export const searchCOCPNumbers = async (criteria: any, employeeName?: string): Promise<NumberRecord[]> => {
    try {
        let query: any = db.collection('numbers').where('numberType', '==', 'COCP');
        if (employeeName) {
            query = query.where('assignedTo', '==', employeeName);
        }

        const snapshot = await query.get();
        let numbers = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as NumberRecord));

        const { startWith, endWith, anywhere, mustContain, notContain, onlyContain, total, sum } = criteria;

        return numbers.filter((num: NumberRecord) => {
            const mobile = num.mobile;
            if (startWith && !mobile.startsWith(startWith)) return false;
            if (endWith && !mobile.endsWith(endWith)) return false;
            if (anywhere && !mobile.includes(anywhere)) return false;

            if (mustContain) {
                const digits = mustContain.split(',').map((d: string) => d.trim()).filter(Boolean);
                if (!digits.every((d: string) => mobile.includes(d))) return false;
            }

            if (notContain) {
                const digits = notContain.split(',').map((d: string) => d.trim()).filter(Boolean);
                if (digits.some((d: string) => mobile.includes(d))) return false;
            }

            if (onlyContain) {
                const allowed = new Set(onlyContain.split(''));
                if (!mobile.split('').every(d => allowed.has(d))) return false;
            }

            if (total) {
                const simpleSum = mobile.split('').map(Number).reduce((a, b) => a + b, 0);
                if (simpleSum.toString() !== total) return false;
            }

            if (sum && num.sum.toString() !== sum) return false;

            return true;
        });
    } catch (error: any) {
        logger.error(`Error in searchCOCPNumbers: ${error.message}`);
        throw error;
    }
};

/**
 * Gets details for a specific COCP number.
 */
export const getCOCPDetails = async (mobile: string, employeeName?: string): Promise<NumberRecord | null> => {
    try {
        let queryClient: any = db.collection('numbers')
            .where('mobile', '==', mobile)
            .where('numberType', '==', 'COCP');
        
        if (employeeName) {
            queryClient = queryClient.where('assignedTo', '==', employeeName);
        }

        const snapshot = await queryClient.limit(1).get();
        if (snapshot.empty) return null;
        return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as NumberRecord;
    } catch (error: any) {
        logger.error(`Error in getCOCPDetails: ${error.message}`);
        throw error;
    }
};

/**
 * Updates COCP safe custody date.
 */
export const updateCOCPDetails = async (
    mobile: string, 
    updates: { safeCustodyDate?: Date }, 
    performedBy: string
): Promise<boolean> => {
    try {
        const snapshot = await db.collection('numbers')
            .where('mobile', '==', mobile)
            .where('numberType', '==', 'COCP')
            .limit(1)
            .get();
        
        if (snapshot.empty) return false;

        const doc = snapshot.docs[0];
        const oldData = doc.data() as NumberRecord;
        const now = Timestamp.now();

        const historyEvent = {
            id: Math.random().toString(36).substring(2, 11),
            action: 'COCP Details Updated',
            description: `Updated Safe Custody Date via BOT.`,
            timestamp: now,
            performedBy
        };

        const finalUpdates: any = { ...updates };
        if (updates.safeCustodyDate) {
            finalUpdates.safeCustodyDate = Timestamp.fromDate(updates.safeCustodyDate);
        }

        await doc.ref.update({
            ...finalUpdates,
            history: [...(oldData.history || []), historyEvent]
        });

        return true;
    } catch (error: any) {
        logger.error(`Error in updateCOCPDetails: ${error.message}`);
        throw error;
    }
};
