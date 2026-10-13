import { db } from '../../config/firebase';
import { Reminder } from '../../shared/types/data';
import { logger } from '../../core/logger/logger';
import admin from 'firebase-admin';
import { activateScheduledRtp } from '../inventory/scheduledRtpService';
import { custodyTasks, isReminderDue, planSystemReminders, reminderAccountName, reminderDate } from '../../shared/utils/systemReminders';

export async function getReminderById(id: string): Promise<Reminder | null> {
    try {
        const doc = await db.collection('reminders').doc(id).get();
        if (!doc.exists) return null;
        const reminder = { id: doc.id, ...doc.data() } as Reminder;
        return (await enrichReminderAccounts([reminder]))[0];
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

    const custodyTask = custodyTasks.find(task => reminder.taskId!.startsWith(task.prefix));
    if (custodyTask) {
        const numberId = reminder.taskId.slice(custodyTask.prefix.length);
        const number = await getNumberById(numberId) || (await getPrebookingById(numberId))?.originalNumberData;
        if (number?.numberType === 'COCP' && isReminderDue(number[custodyTask.field])) {
            return {
                canBeDone: false,
                message: `The ${custodyTask.label} Date for ${number.mobile} has not been updated to a future date.`
            };
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
            reminders: await enrichReminderAccounts(allPending.slice(offset, offset + limit)),
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
        const enriched = (await enrichReminderAccounts([{ ...data, id: '', taskName: data.taskName || '' } as Reminder]))[0];
        const mobile = data.mobile || data.taskName?.match(/\b\d{10}\b/)?.[0];

        const dueDate = data.dueDate instanceof Date 
            ? admin.firestore.Timestamp.fromDate(data.dueDate) 
            : data.dueDate;

        const newReminder = {
            ...data,
            accountName: enriched.accountName || 'N/A',
            ...(mobile ? { mobile } : {}),
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

export async function getDueReminders() {
    try {
        // Reconcile dates on the server even when no administrator has the dashboard open.
        await syncSystemReminders();
        // Fetch all pending reminders
        const snapshot = await db.collection('reminders').where('status', '==', 'Pending').get();
        const pendingReminders = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as Reminder));
        
        // Filter those that are due today or in the past
        const dueReminders = pendingReminders.filter(r => {
            return isReminderDue(r.dueDate);
        });

        // Sort by due date
        dueReminders.sort((a: any, b: any) => {
            const timeA = reminderDate(a.dueDate)!.getTime();
            const timeB = reminderDate(b.dueDate)!.getTime();
            return timeA - timeB;
        });

        return await enrichReminderAccounts(dueReminders);
    } catch (error: any) {
        logger.error(`Error in getDueReminders: ${error.message}`);
        throw error;
    }
}

let synchronization: Promise<void> | null = null;
const sourceQueries = () => ({
    numbers: db.collection('numbers'), prebookings: db.collection('prebookings'),
    reminders: db.collection('reminders'), users: db.collection('users').where('role', '==', 'admin')
});
const sourceCache: Partial<Record<keyof ReturnType<typeof sourceQueries>, admin.firestore.QuerySnapshot>> = {};
let monitoring = false;

export function startSystemReminderMonitor() {
    if (monitoring) return;
    monitoring = true;
    for (const [name, query] of Object.entries(sourceQueries())) {
        const key = name as keyof typeof sourceCache;
        query.onSnapshot(snapshot => {
            sourceCache[key] = snapshot;
            if (Object.keys(sourceCache).length === 4) {
                void syncSystemReminders().catch(error => logger.error(`Reminder synchronization failed: ${error.message}`));
            }
        }, error => {
            delete sourceCache[key];
            logger.error(`Reminder monitor for ${key} failed: ${error.message}`);
        });
    }
    // Evaluate the cached dates at midnight without re-reading unchanged inventories.
    setInterval(() => {
        void syncSystemReminders().catch(error => logger.error(`Reminder synchronization failed: ${error.message}`));
    }, 60000);
}

export function syncSystemReminders(): Promise<void> {
    if (!synchronization) synchronization = synchronizeSystemReminders().finally(() => { synchronization = null; });
    return synchronization;
}

async function synchronizeSystemReminders() {
    const queries = sourceQueries();
    const [numbers, prebookings, reminders, users] = await Promise.all([
        sourceCache.numbers || queries.numbers.get(), sourceCache.prebookings || queries.prebookings.get(),
        sourceCache.reminders || queries.reminders.get(), sourceCache.users || queries.users.get()
    ]);
    const mapDocs = (snapshot: admin.firestore.QuerySnapshot) => snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    const inventory = mapDocs(numbers);
    await activateScheduledRtp(inventory as any);
    const admins = [...new Set(users.docs.map(doc => doc.data().displayName).filter(Boolean))] as string[];
    if (!admins.length) logger.warn('No admin display names found; new system reminders cannot be assigned.');
    const plan = planSystemReminders(inventory as any, mapDocs(prebookings) as any, mapDocs(reminders) as any, admins);
    let srNo = reminders.docs.reduce((max, doc) => Math.max(max, doc.data().srNo || 0), 0);
    const existingReminders = new Map(reminders.docs.map(doc => [doc.id, doc.data()]));
    const operations = [
        ...plan.updates.map(update => ({ ...update, create: false })),
        ...plan.creates.map(create => ({ ...create, create: true }))
    ];
    if (!operations.length) return;
    const lastActivity = await db.collection('activities').orderBy('srNo', 'desc').limit(1).get();
    let activitySrNo = lastActivity.empty ? 0 : lastActivity.docs[0].data().srNo || 0;
    // Stay below Firestore's per-batch write limit for large inventories.
    for (let offset = 0; offset < operations.length; offset += 449) {
        const batch = db.batch();
        const chunk = operations.slice(offset, offset + 449);
        for (const operation of chunk) {
            const ref = db.collection('reminders').doc(operation.id);
            const data: admin.firestore.DocumentData = { ...operation.data };
            if (data.dueDate instanceof Date) data.dueDate = admin.firestore.Timestamp.fromDate(data.dueDate);
            if (operation.create) {
                batch.set(ref, { ...data, srNo: ++srNo, createdBy: 'system', createdAt: admin.firestore.FieldValue.serverTimestamp() });
            } else {
                data.completionDate = data.status === 'Done'
                    ? admin.firestore.FieldValue.serverTimestamp() : admin.firestore.FieldValue.delete();
                batch.update(ref, data);
            }
        }
        batch.set(db.collection('activities').doc(), {
            employeeName: 'System', action: 'Synchronized Number Reminders', groupName: 'WORK_REMINDERS',
            description: chunk.map(operation => {
                const data = { ...existingReminders.get(operation.id), ...operation.data };
                const dueDate = reminderDate(data.dueDate)?.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) || 'N/A';
                return `${operation.create ? 'Created' : 'Updated'}: ${data.taskName || operation.id}; Account: ${data.accountName || 'N/A'}; Due: ${dueDate} (IST); Status: ${data.status}.`;
            }).join('\n'),
            source: 'BOT', createdBy: 'system', srNo: ++activitySrNo,
            timestamp: admin.firestore.FieldValue.serverTimestamp(), notificationStatus: 'Pending'
        });
        await batch.commit();
    }
    if (operations.length) logger.info(`System reminders synchronized: ${plan.creates.length} created, ${plan.updates.length} updated.`);
}

async function enrichReminderAccounts(reminders: Reminder[]): Promise<Reminder[]> {
    if (!reminders.length) return reminders;
    const [numbers, prebookings] = await Promise.all([db.collection('numbers').get(), db.collection('prebookings').get()]);
    const inventory = numbers.docs.map(doc => ({ ...doc.data(), id: doc.id })) as any;
    const booked = prebookings.docs.map(doc => ({ ...doc.data(), id: doc.id })) as any;
    return reminders.map(reminder => ({ ...reminder, accountName: reminderAccountName(reminder, inventory, booked) }));
}
