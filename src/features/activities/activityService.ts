import { db } from '../../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';
import { Activity } from '../../shared/types/data';
import { activitySchema } from '../../shared/utils/validation';
import TelegramBot from 'node-telegram-bot-api';
import { env } from '../../config/env';
import { escapeMarkdown } from '../../shared/utils/telegram';
import { logger } from '../../core/logger/logger';
import { formatToDDMMYYYY } from '../../shared/utils/dateUtils';

export const logActivity = async (
    bot: TelegramBot,
    data: Omit<Activity, 'id' | 'srNo' | 'timestamp'>,
    shouldBroadcast: boolean = false
) => {
    try {
        const activitiesRef = db.collection('activities');

        // Get last srNo
        const lastActivity = await activitiesRef.orderBy('srNo', 'desc').limit(1).get();
        const lastSrNo = lastActivity.empty ? 0 : lastActivity.docs[0].data().srNo;
        const nextSrNo = lastSrNo + 1;
        const newDocRef = activitiesRef.doc();

        const newActivity: Activity = {
            ...data,
            id: newDocRef.id,
            srNo: nextSrNo,
            timestamp: Timestamp.now(),
            source: data.source || 'BOT',
            groupName: data.groupName || 'ACTIVITY'
        };

        // Validate
        const validation = activitySchema.safeParse(newActivity);
        if (!validation.success) {
            throw new Error(`Activity validation failed: ${validation.error.errors.map(e => e.message).join(', ')}`);
        }

        await newDocRef.set(newActivity);

        // Notification Message
        const message = `📊 *Activity Log #${nextSrNo}*\n\n` +
            `🔹 *Action:* ${escapeMarkdown(newActivity.action)}\n` +
            `🔹 *Target:* ${escapeMarkdown(newActivity.employeeName)}\n` +
            `🔹 *Description:* ${escapeMarkdown(newActivity.description)}\n` +
            `👤 *By:* ${escapeMarkdown(newActivity.createdBy)}\n` +
            `⏰ *Time:* ${escapeMarkdown(formatToDDMMYYYY(newActivity.timestamp))}`;

        // Send to specific feature group if applicable
        const targetGroupKey = `TG_GROUP_${newActivity.groupName}` as keyof typeof env;
        const targetGroupId = env[targetGroupKey] as string | undefined;

        if (targetGroupId) {
            await bot.sendMessage(targetGroupId, message, { parse_mode: 'Markdown' });
        } else if (env.TG_GROUP_ACTIVITY) {
            // Fallback to general activity group
            await bot.sendMessage(env.TG_GROUP_ACTIVITY, message, { parse_mode: 'Markdown' });
        }

        // Always broadcast to Master Channel if requested
        if (shouldBroadcast && env.TG_MASTER_CHANNEL) {
            await bot.sendMessage(env.TG_MASTER_CHANNEL, message, { parse_mode: 'Markdown' });
        }

        return newActivity;
    } catch (error: any) {
        logger.error('Error logging activity: ' + error.message);
        throw error;
    }
};

export const getRecentActivities = async (limit: number = 10): Promise<Activity[]> => {
    const snapshot = await db.collection('activities')
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

    return snapshot.docs.map(doc => doc.data() as Activity);
};

export const getAllActivities = async (): Promise<Activity[]> => {
    const snapshot = await db.collection('activities')
        .orderBy('timestamp', 'desc')
        .get();

    return snapshot.docs.map(doc => doc.data() as Activity);
};

export const deleteActivity = async (id: string) => {
    await db.collection('activities').doc(id).delete();
};

export const clearAllActivities = async () => {
    const snapshot = await db.collection('activities').get();
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
};
