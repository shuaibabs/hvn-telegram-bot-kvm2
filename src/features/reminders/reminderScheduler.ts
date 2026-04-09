import { getDueReminders } from './remindersService';
import { broadcast } from '../broadcast/broadcastService';
import { format } from 'date-fns';
import { logger } from '../../core/logger/logger';
import admin from 'firebase-admin';
import * as cron from 'node-cron';

/**
 * Helper to wait for a specified duration
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Broadcasts a message with automatic retry logic for 429 Rate Limit errors.
 */
async function broadcastWithRetry(group: string, message: string, source: 'BOT' | 'UI' = 'BOT', maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        const result = await broadcast(group, message, source);
        if (result.success) return true;

        // Check for Telegram 429 error
        if (result.error?.includes('429')) {
            // Extract seconds from: "ETEGRAM: 429 Too Many Requests: retry after 32"
            const match = result.error.match(/retry after (\d+)/);
            const waitSeconds = match ? parseInt(match[1]) : 30; // Default to 30s
            
            logger.warn(`⚠️ Rate limited by Telegram. Waiting ${waitSeconds}s before retry (Attempt ${i + 1}/${maxRetries})...`);
            await sleep((waitSeconds + 2) * 1000); // Wait requested time + 2s buffer
            continue; // Try again
        }
        
        // Fatal or non-retryable error
        logger.error(`❌ Non-retryable broadcast failure: ${result.error}`);
        break; 
    }
    return false;
}

/**
 * Fetches due reminders and broadcasts them in small batches to Telegram.
 * Batches are used to respect rate limits while keeping notifications clear.
 */
export async function processDueReminders() {
    try {
        const dueReminders = await getDueReminders();
        
        if (dueReminders.length === 0) {
            logger.info("No due reminders found in this cycle.");
            return;
        }

        const BATCH_SIZE = 5;
        const totalBatches = Math.ceil(dueReminders.length / BATCH_SIZE);
        logger.info(`Found ${dueReminders.length} due reminders. Pushing in ${totalBatches} batches...`);

        for (let i = 0; i < dueReminders.length; i += BATCH_SIZE) {
            const batch = dueReminders.slice(i, i + BATCH_SIZE);
            const currentBatchNum = Math.floor(i / BATCH_SIZE) + 1;

            let message = `⚠️ **Daily Task Reminder** (Batch ${currentBatchNum}/${totalBatches})\n\n`;
            message += `You have ${batch.length} pending task(s) in this update:\n\n`;

            batch.forEach((reminder: any, index) => {
                const dueDate = reminder.dueDate instanceof admin.firestore.Timestamp 
                    ? reminder.dueDate.toDate() 
                    : new Date(reminder.dueDate);
                
                const formattedDate = format(dueDate, 'PPP');
                const assignedTo = Array.isArray(reminder.assignedTo) 
                    ? reminder.assignedTo.join(', ') 
                    : reminder.assignedTo;

                message += `${index + 1}. **${reminder.taskName}**\n`;
                message += `   - Assigned to: ${assignedTo}\n`;
                message += `   - Due Date: ${formattedDate}\n\n`;
            });

            message += `Please complete these tasks to dismiss notifications.`;

            // Broadcast to WORK_REMINDERS group with robust retry logic
            await broadcastWithRetry('WORK_REMINDERS', message, 'BOT');

            // Rate limit protection: wait 5 seconds between batches
            if (i + BATCH_SIZE < dueReminders.length) {
                await sleep(5000);
            }
        }

    } catch (error: any) {
        logger.error(`[ERROR] Reminder processing cycle failed: ${error.message}`);
    }
}

/**
 * Starts a scheduler that checks for due reminders every day at 7:00 AM.
 */
export function startReminderScheduler() {
    logger.info("⏰ Robust Reminder Scheduler initialized (Daily at 07:00 AM).");

    // Schedule: 07:00 AM every day
    cron.schedule('0 7 * * *', async () => {
        logger.info("📅 Triggering scheduled daily reminder check at 07:00 AM...");
        await processDueReminders();
    });

    // Initial check after startup (30 seconds delay to allow system to settle)
    setTimeout(async () => {
        logger.info("🔄 Running initial startup reminder check...");
        await processDueReminders();
    }, 30000);
}
