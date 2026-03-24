import { db } from '../../config/firebase';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { DeletedNumberRecord, LifecycleEvent, NumberRecord } from '../../shared/types/data';
import { logger } from '../../core/logger/logger';

export async function getDeletedNumbers(employeeName?: string) {
    try {
        let query: any = db.collection('deletedNumbers');
        if (employeeName) {
            query = query.where("originalNumberData.assignedTo", "==", employeeName);
        }
        const snapshot = await query.get();
        return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as DeletedNumberRecord));
    } catch (error: any) {
        logger.error(`Error in getDeletedNumbers: ${error.message}`);
        throw error;
    }
}

export async function restoreNumber(deletedNumberId: string, performedBy: string) {
    try {
        const docRef = db.collection('deletedNumbers').doc(deletedNumberId);
        const snapshot = await docRef.get();

        if (!snapshot.exists) return false;
        const data = snapshot.data() as DeletedNumberRecord;

        const historyEvent: LifecycleEvent = {
            id: Math.random().toString(36).substring(2, 11),
            action: 'Restored',
            description: `Number restored to inventory via Bot.`,
            timestamp: Timestamp.now(),
            performedBy
        };

        const restoredData: any = {
            ...data.originalNumberData,
            history: [...(data.originalNumberData.history || []), historyEvent]
        };

        const batch = db.batch();
        const numberDocRef = db.collection('numbers').doc(data.originalId);
        
        batch.set(numberDocRef, restoredData);
        batch.delete(docRef);

        await batch.commit();
        return data.mobile;
    } catch (error: any) {
        logger.error(`Error in restoreNumber: ${error.message}`);
        throw error;
    }
}

export async function getDeletedNumberByMobile(mobile: string, employeeName?: string) {
    try {
        let query: any = db.collection('deletedNumbers').where("mobile", "==", mobile);
        if (employeeName) {
            query = query.where("originalNumberData.assignedTo", "==", employeeName);
        }
        const snapshot = await query.get();
        if (snapshot.empty) return null;
        return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as DeletedNumberRecord;
    } catch (error: any) {
        logger.error(`Error in getDeletedNumberByMobile: ${error.message}`);
        throw error;
    }
}
