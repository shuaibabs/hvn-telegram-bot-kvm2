import { db } from '../../config/firebase';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { PreBookingRecord, NumberRecord } from '../../shared/types/data';
import { logger } from '../../core/logger/logger';

export type PrebookSearchCriteria = {
    startWith?: string;
    anywhere?: string;
    endWith?: string;
    mustContain?: string;
    notContain?: string;
    onlyContain?: string;
    total?: string;
    sum?: string;
};

/**
 * Gets pre-booked numbers with optional employee filtering.
 */
export const getPrebookingNumbers = async (employeeName?: string): Promise<PreBookingRecord[]> => {
    try {
        let query: any = db.collection('prebookings');
        if (employeeName) {
            query = query.where('originalNumberData.assignedTo', '==', employeeName);
        }
        const snapshot = await query.get();
        const results = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as PreBookingRecord));
        return results.sort((a: PreBookingRecord, b: PreBookingRecord) => (b.srNo || 0) - (a.srNo || 0));
    } catch (error: any) {
        logger.error(`Error in getPrebookingNumbers: ${error.message}`);
        throw error;
    }
};

/**
 * Advanced search for pre-booked numbers.
 */
export const searchPrebookingNumbers = async (criteria: PrebookSearchCriteria, employeeName?: string): Promise<PreBookingRecord[]> => {
    try {
        let query: any = db.collection('prebookings');
        if (employeeName) {
            query = query.where('originalNumberData.assignedTo', '==', employeeName);
        }

        const snapshot = await query.get();
        let prebookings = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as PreBookingRecord));

        const { startWith, endWith, anywhere, mustContain, notContain, onlyContain, total, sum } = criteria;

        return prebookings.filter((pb: PreBookingRecord) => {
            const mobile = pb.mobile;
            if (startWith && !mobile.startsWith(startWith)) return false;
            if (endWith && !mobile.endsWith(endWith)) return false;
            if (anywhere && !mobile.includes(anywhere)) return false;

            if (mustContain) {
                const digits = mustContain.split(',').map(d => d.trim()).filter(Boolean);
                if (!digits.every(d => mobile.includes(d))) return false;
            }

            if (notContain) {
                const digits = notContain.split(',').map(d => d.trim()).filter(Boolean);
                if (digits.some(d => mobile.includes(d))) return false;
            }

            if (onlyContain) {
                const allowed = new Set(onlyContain.split(''));
                if (!mobile.split('').every(d => allowed.has(d))) return false;
            }

            if (total) {
                const simpleSum = mobile.split('').map(Number).reduce((a, b) => a + b, 0);
                if (simpleSum.toString() !== total) return false;
            }

            if (sum && pb.sum.toString() !== sum) return false;

            return true;
        });
    } catch (error: any) {
        logger.error(`Error in searchPrebookingNumbers: ${error.message}`);
        throw error;
    }
};

/**
 * Gets details for a specific pre-booked number.
 */
export const getPrebookingDetails = async (mobile: string, employeeName?: string): Promise<PreBookingRecord | null> => {
    try {
        let query: any = db.collection('prebookings').where('mobile', '==', mobile);
        if (employeeName) {
            query = query.where('originalNumberData.assignedTo', '==', employeeName);
        }
        const snapshot = await query.limit(1).get();
        if (snapshot.empty) return null;
        return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as PreBookingRecord;
    } catch (error: any) {
        logger.error(`Error in getPrebookingDetails: ${error.message}`);
        throw error;
    }
};

/**
 * Cancels a pre-booking and moves the number back to inventory.
 */
export const cancelPrebooking = async (prebookingId: string, performedBy: string): Promise<boolean> => {
    try {
        const pbRef = db.collection('prebookings').doc(prebookingId);
        const pbDoc = await pbRef.get();
        if (!pbDoc.exists) return false;

        const pbData = pbDoc.data() as PreBookingRecord;
        const now = Timestamp.now();

        // Prepare history cycle
        const historyEvent = {
            id: Math.random().toString(36).substring(2, 11),
            action: 'Pre-booking Cancelled',
            description: 'Pre-booking was cancelled.',
            timestamp: now,
            performedBy
        };

        const originalData = pbData.originalNumberData;
        const numberData: any = {
            ...originalData,
            history: [...(originalData.history || []), historyEvent]
        };

        const batch = db.batch();
        batch.set(db.collection('numbers').doc(), numberData);
        batch.delete(pbRef);

        // Add activity log
        const activityRef = db.collection('activities').doc();
        batch.set(activityRef, {
            employeeName: performedBy,
            action: 'Cancelled Pre-Booking',
            description: `Pre-booking for number ${pbData.mobile} cancelled.`,
            timestamp: FieldValue.serverTimestamp(),
            createdBy: 'BOT',
            source: 'BOT',
            groupName: 'PREBOOKING'
        });

        await batch.commit();
        return true;
    } catch (error: any) {
        logger.error(`Error in cancelPrebooking: ${error.message}`);
        throw error;
    }
};
