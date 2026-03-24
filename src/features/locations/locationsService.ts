import { db } from '../../config/firebase';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { NumberRecord, LifecycleEvent } from '../../shared/types/data';
import { logger } from '../../core/logger/logger';

export async function getFilteredLocations(filters: { type?: string; location?: string }, employeeName?: string) {
    try {
        let query: any = db.collection('numbers');

        if (employeeName) {
            query = query.where("assignedTo", "==", employeeName);
        }

        if (filters.type && filters.type !== 'all') {
            query = query.where("locationType", "==", filters.type);
        }

        if (filters.location && filters.location !== 'all') {
            query = query.where("currentLocation", "==", filters.location);
        }

        const snapshot = await query.get();
        return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as NumberRecord));
    } catch (error: any) {
        logger.error(`Error in getFilteredLocations: ${error.message}`);
        throw error;
    }
}

export async function getAllUniqueLocations(employeeName?: string) {
    try {
        let query: any = db.collection('numbers');
        if (employeeName) {
            query = query.where("assignedTo", "==", employeeName);
        }
        const snapshot = await query.get();
        const locations = snapshot.docs.map((doc: any) => (doc.data() as NumberRecord).currentLocation).filter(Boolean);
        return [...new Set(locations)].sort();
    } catch (error: any) {
        logger.error(`Error in getAllUniqueLocations: ${error.message}`);
        throw error;
    }
}

export async function checkInNumber(mobile: string, performedBy: string, employeeName?: string) {
    try {
        let query: any = db.collection('numbers').where("mobile", "==", mobile);
        if (employeeName) {
            query = query.where("assignedTo", "==", employeeName);
        }
        
        const snapshot = await query.get();
        if (snapshot.empty) return null;

        const docRef = snapshot.docs[0].ref;
        const numData = snapshot.docs[0].data() as NumberRecord;

        const historyEvent: LifecycleEvent = {
            id: Math.random().toString(36).substring(2, 11),
            action: 'Checked In',
            description: `SIM Checked In at ${numData.currentLocation} via Bot.`,
            timestamp: Timestamp.now(),
            performedBy
        };

        await docRef.update({
            checkInDate: Timestamp.now(),
            history: FieldValue.arrayUnion(historyEvent)
        });

        return mobile;
    } catch (error: any) {
        logger.error(`Error in checkInNumber: ${error.message}`);
        throw error;
    }
}

export async function updateLocation(mobile: string, data: { locationType: string; currentLocation: string }, performedBy: string, employeeName?: string) {
    try {
        let query: any = db.collection('numbers').where("mobile", "==", mobile);
        if (employeeName) {
            query = query.where("assignedTo", "==", employeeName);
        }

        const snapshot = await query.get();
        if (snapshot.empty) return null;

        const docRef = snapshot.docs[0].ref;

        const historyEvent: LifecycleEvent = {
            id: Math.random().toString(36).substring(2, 11),
            action: 'Location Updated',
            description: `Location changed to ${data.currentLocation} (${data.locationType}) via Bot.`,
            timestamp: Timestamp.now(),
            performedBy
        };

        await docRef.update({
            locationType: data.locationType,
            currentLocation: data.currentLocation,
            history: FieldValue.arrayUnion(historyEvent)
        });

        return mobile;
    } catch (error: any) {
        logger.error(`定期 updateLocation: ${error.message}`);
        throw error;
    }
}

export async function getNumberByMobile(mobile: string, employeeName?: string) {
    try {
        let query: any = db.collection('numbers').where("mobile", "==", mobile);
        if (employeeName) {
            query = query.where("assignedTo", "==", employeeName);
        }
        const snapshot = await query.get();
        if (snapshot.empty) return null;
        return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as NumberRecord;
    } catch (error: any) {
        logger.error(`Error in getNumberByMobile: ${error.message}`);
        throw error;
    }
}
