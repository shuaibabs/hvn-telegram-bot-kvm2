import { db } from '../../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';
import { NumberRecord } from '../../shared/types/data';
import { logger } from '../../core/logger/logger';
import { matchesExactPlacement } from '../../shared/utils/utils';

/**
 * Gets numbers where numberType is 'COCP' with optional employee filtering.
 */
export const getCOCPNumbers = async (employeeName?: string): Promise<NumberRecord[]> => {
    try {
        let invQuery: any = db.collection('numbers').where('numberType', '==', 'COCP');
        let pbQuery: any = db.collection('prebookings').where('originalNumberData.numberType', '==', 'COCP');

        if (employeeName) {
            invQuery = invQuery.where('assignedTo', '==', employeeName);
            pbQuery = pbQuery.where('originalNumberData.assignedTo', '==', employeeName);
        }

        const [invSnapshot, pbSnapshot] = await Promise.all([invQuery.get(), pbQuery.get()]);

        const invResults = invSnapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as NumberRecord));
        const pbResults = pbSnapshot.docs.map((doc: any) => {
            const data = doc.data();
            return {
                ...data.originalNumberData,
                id: doc.id,
            } as unknown as NumberRecord;
        });

        const results = [...invResults, ...pbResults];
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
        let invQuery: any = db.collection('numbers').where('numberType', '==', 'COCP');
        let pbQuery: any = db.collection('prebookings').where('originalNumberData.numberType', '==', 'COCP');

        if (employeeName) {
            invQuery = invQuery.where('assignedTo', '==', employeeName);
            pbQuery = pbQuery.where('originalNumberData.assignedTo', '==', employeeName);
        }

        const [invSnapshot, pbSnapshot] = await Promise.all([invQuery.get(), pbQuery.get()]);

        const invResults = invSnapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as NumberRecord));
        const pbResults = pbSnapshot.docs.map((doc: any) => {
            const data = doc.data();
            return {
                ...data.originalNumberData,
                id: doc.id,
                status: 'Pre-Booked'
            } as unknown as NumberRecord;
        });

        let numbers = [...invResults, ...pbResults];

        const { startWith, endWith, anywhere, mustContain, notContain, onlyContain, total, sum, minPrice, maxPrice, exactPlacement } = criteria;

        return numbers.filter((num: NumberRecord) => {
            const mobile = num.mobile;
            if (startWith && !mobile.startsWith(startWith)) return false;
            if (endWith && !mobile.endsWith(endWith)) return false;
            if (anywhere && !mobile.includes(anywhere)) return false;
            if (exactPlacement && !matchesExactPlacement(mobile, exactPlacement)) return false;

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

            if (minPrice && Number(num.salePrice) < Number(minPrice)) return false;
            if (maxPrice && Number(num.salePrice) > Number(maxPrice)) return false;

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
        // Check inventory first
        let invQuery: any = db.collection('numbers')
            .where('mobile', '==', mobile)
            .where('numberType', '==', 'COCP');
        if (employeeName) invQuery = invQuery.where('assignedTo', '==', employeeName);
        
        const invSnapshot = await invQuery.limit(1).get();
        if (!invSnapshot.empty) {
            return { id: invSnapshot.docs[0].id, ...invSnapshot.docs[0].data() } as NumberRecord;
        }

        // Check prebookings
        let pbQuery: any = db.collection('prebookings')
            .where('mobile', '==', mobile)
            .where('originalNumberData.numberType', '==', 'COCP');
        if (employeeName) pbQuery = pbQuery.where('originalNumberData.assignedTo', '==', employeeName);

        const pbSnapshot = await pbQuery.limit(1).get();
        if (!pbSnapshot.empty) {
            const data = pbSnapshot.docs[0].data();
            return { 
                ...data.originalNumberData, 
                id: pbSnapshot.docs[0].id, 
            } as unknown as NumberRecord;
        }

        return null;
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
    updates: { safeCustodyDate?: Date; unsafeCustodyDate?: Date }, 
    performedBy: string
): Promise<boolean> => {
    try {
        let snapshot = await db.collection('numbers')
            .where('mobile', '==', mobile)
            .where('numberType', '==', 'COCP')
            .limit(1)
            .get();
        
        let collectionName = 'numbers';
        let isPreBooking = false;

        if (snapshot.empty) {
            snapshot = await db.collection('prebookings')
                .where('mobile', '==', mobile)
                .where('originalNumberData.numberType', '==', 'COCP')
                .limit(1)
                .get();
            if (!snapshot.empty) {
                collectionName = 'prebookings';
                isPreBooking = true;
            }
        }
        
        if (snapshot.empty) return false;

        const doc = snapshot.docs[0];
        const rawData = doc.data();
        const oldData = isPreBooking ? rawData.originalNumberData : rawData;
        const now = Timestamp.now();

        const updatedFields = [];
        if (updates.safeCustodyDate) updatedFields.push('Safe Custody Date');
        if (updates.unsafeCustodyDate) updatedFields.push('Unsafe Custody Date');

        const historyEvent = {
            id: Math.random().toString(36).substring(2, 11),
            action: 'COCP Details Updated',
            description: `Updated ${updatedFields.join(' and ')} via BOT.`,
            timestamp: now,
            performedBy
        };

        const finalUpdates: any = {};
        if (updates.safeCustodyDate) {
            finalUpdates[isPreBooking ? 'originalNumberData.safeCustodyDate' : 'safeCustodyDate'] = Timestamp.fromDate(updates.safeCustodyDate);
        }
        if (updates.unsafeCustodyDate) {
            finalUpdates[isPreBooking ? 'originalNumberData.unsafeCustodyDate' : 'unsafeCustodyDate'] = Timestamp.fromDate(updates.unsafeCustodyDate);
        }

        const history = [...(oldData.history || []), historyEvent];
        finalUpdates[isPreBooking ? 'originalNumberData.history' : 'history'] = history;

        await doc.ref.update(finalUpdates);

        return true;
    } catch (error: any) {
        logger.error(`Error in updateCOCPDetails: ${error.message}`);
        throw error;
    }
};
