import admin from 'firebase-admin';
import { db } from '../../config/firebase';
import { logger } from '../../core/logger/logger';
import { broadcast } from '../broadcast/broadcastService';

let running = false;

/** Deliver only explicitly queued activities; legacy activity delivery remains unchanged. */
export async function processActivityNotifications() {
    if (running) return;
    running = true;
    try {
        const snapshot = await db.collection('activities')
            .where('notificationStatus', 'in', ['Pending', 'Retry', 'Sending']).get();
        for (const candidate of snapshot.docs) {
            const data = await db.runTransaction(async transaction => {
                const current = await transaction.get(candidate.ref);
                const data = current.data();
                const now = Date.now();
                if (!data || !['Pending', 'Retry', 'Sending'].includes(data.notificationStatus) ||
                    (data.notificationNextAttemptAt?.toMillis() || 0) > now ||
                    (data.notificationStatus === 'Sending' && (data.notificationLeaseUntil?.toMillis() || 0) > now)) return null;
                transaction.update(candidate.ref, {
                    notificationStatus: 'Sending',
                    notificationLeaseUntil: admin.firestore.Timestamp.fromMillis(now + 10 * 60 * 1000)
                });
                return data;
            });
            if (!data) continue;
            const progress = { ...(data.notificationProgress || {}) } as Record<string, number>;
            const result = await broadcast(data.groupName || 'ACTIVITY',
                `**Action:** ${data.action}\n**Performed By:** ${data.employeeName}\n**Details:** ${data.description}`,
                data.source === 'BOT' ? 'BOT' : 'UI', {
                    progress,
                    onPartSent: async () => {
                        await candidate.ref.update({
                            notificationProgress: { ...progress },
                            notificationLeaseUntil: admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000)
                        });
                    }
                });
            const attempts = (data.notificationAttempts || 0) + 1;
            await candidate.ref.update({
                notificationStatus: result.success ? 'Sent' : 'Retry',
                notificationAttempts: attempts,
                notificationError: result.error || admin.firestore.FieldValue.delete(),
                notificationLeaseUntil: admin.firestore.FieldValue.delete(),
                notificationNextAttemptAt: result.success ? admin.firestore.FieldValue.delete()
                    : admin.firestore.Timestamp.fromMillis(Date.now() + Math.min(30 * 60 * 1000, 30000 * 2 ** Math.min(attempts - 1, 6))),
                ...(result.success ? { notificationSentAt: admin.firestore.FieldValue.serverTimestamp() } : {})
            });
            if (!result.success) logger.warn(`Activity ${candidate.id} delivery will be retried: ${result.error}`);
        }
    } catch (error: any) {
        logger.error(`Activity notification worker failed: ${error.message}`);
    } finally {
        running = false;
    }
}

export function startActivityNotificationWorker() {
    logger.info('Activity notification queue initialized (checks every 30 seconds).');
    void processActivityNotifications();
    setInterval(() => { void processActivityNotifications(); }, 30000);
}
