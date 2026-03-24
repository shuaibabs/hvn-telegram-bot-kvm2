import { db } from '../../config/firebase';
import { Reminder } from '../../shared/types/data';
import { logger } from '../../core/logger/logger';
import admin from 'firebase-admin';
import { isToday, isPast } from 'date-fns';

export async function getReminderById(id: string): Promise<Reminder | null> {
    try {
        const doc = await db.collection('reminders').doc(id).get();
        if (!doc.exists) return null;
        return { id: doc.id, ...doc.data() } as Reminder;
    } catch (error: any) {
        logger.error(`Error in getReminderById: ${error.message}`);
        throw error;
    }
}

export async function getNumberById(id: string) {
    try {
        const doc = await db.collection('numbers').doc(id).get();
        if (!doc.exists) return null;
        return doc.data();
    } catch (error: any) {
        logger.error(`Error in getNumberById: ${error.message}`);
        throw error;
    }
}

export async function getPrebookingById(id: string) {
    try {
        const doc = await db.collection('prebookings').doc(id).get();
        if (!doc.exists) return null;
        return doc.data();
    } catch (error: any) {
        logger.error(`Error in getPrebookingById: ${error.message}`);
        throw error;
    }
}

export async function canMarkReminderDone(reminder: Reminder): Promise<{ canBeDone: boolean; message: string }> {
    if (!reminder.taskId) {
        return { canBeDone: true, message: "" };
    }

    if (reminder.taskId.startsWith('cocp-safecustody-')) {
        const numberId = reminder.taskId.replace('cocp-safecustody-', '');
        const number = await getNumberById(numberId);
        if (number && number.safeCustodyDate) {
            const custodyDate = (number.safeCustodyDate as admin.firestore.Timestamp).toDate();
            if (isToday(custodyDate) || isPast(custodyDate)) {
                return { 
                    canBeDone: false, 
                    message: `The Safe Custody Date for ${number.mobile} has not been updated to a future date.` 
                };
            }
        }
    } else if (reminder.taskId.startsWith('prebooked-rtp-')) {
        const preBookingId = reminder.taskId.replace('prebooked-rtp-', '');
        const preBooking = await getPrebookingById(preBookingId);
        if (preBooking) {
            return { 
                canBeDone: false, 
                message: `The Pre-Booked number ${preBooking.mobile} has not been marked as sold yet.` 
            };
        }
    }

    return { canBeDone: true, message: "" };
}

export async function getPendingReminders(assignedTo?: string, limit: number = 5, offset: number = 0) {
    try {
        let query: any = db.collection('reminders').where('status', '==', 'Pending');
        
        if (assignedTo) {
            query = query.where('assignedTo', 'array-contains', assignedTo);
        }

        const snapshot = await query.get();
        const allPending = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as Reminder));
        
        // Sort in-memory to avoid composite index requirement
        allPending.sort((a: any, b: any) => {
            const timeA = a.dueDate instanceof admin.firestore.Timestamp ? a.dueDate.toMillis() : new Date(a.dueDate as any).getTime();
            const timeB = b.dueDate instanceof admin.firestore.Timestamp ? b.dueDate.toMillis() : new Date(b.dueDate as any).getTime();
            return timeA - timeB;
        });

        return {
            reminders: allPending.slice(offset, offset + limit),
            total: allPending.length
        };
    } catch (error: any) {
        logger.error(`Error in getPendingReminders: ${error.message}`);
        throw error;
    }
}

export async function addReminder(data: Partial<Reminder>) {
    try {
        const remindersRef = db.collection('reminders');
        const snapshot = await remindersRef.orderBy('srNo', 'desc').limit(1).get();
        const lastSrNo = snapshot.empty ? 0 : snapshot.docs[0].data().srNo || 0;

        const dueDate = data.dueDate instanceof Date 
            ? admin.firestore.Timestamp.fromDate(data.dueDate) 
            : data.dueDate;

        const newReminder = {
            ...data,
            dueDate,
            srNo: lastSrNo + 1,
            status: 'Pending',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        const docRef = await remindersRef.add(newReminder);
        return { id: docRef.id, ...newReminder };
    } catch (error: any) {
        logger.error(`Error in addReminder: ${error.message}`);
        throw error;
    }
}

export async function markReminderAsDone(id: string, note?: string) {
    try {
        const docRef = db.collection('reminders').doc(id);
        const updateData: any = {
            status: 'Done',
            completionDate: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (note) {
            updateData.notes = note;
        }
        await docRef.update(updateData);
        return true;
    } catch (error: any) {
        logger.error(`Error in markReminderAsDone: ${error.message}`);
        throw error;
    }
}
