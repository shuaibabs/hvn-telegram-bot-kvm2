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
 * Extracts a 10-digit mobile number from a string
 */
function extractMobile(text: string): string | null {
    const match = text.match(/\d{10}/);
    return match ? match[0] : null;
}

/**
 * Fetches due reminders and broadcasts them in grouped summaries to Telegram.
 * Groups common tasks (Safe Custody, Pre-bookings) to avoid notification spam.
 */
export async function processDueReminders() {
    try {
        const dueReminders = await getDueReminders();
        
        if (dueReminders.length === 0) {
            logger.info("No due reminders found in this cycle.");
            return;
        }

        logger.info(`Processing ${dueReminders.length} due reminders...`);

        // Categorize reminders
        const safeCustodyGroups: Record<string, string[]> = {}; // Date String -> Mobile Numbers
        const prebookedRtpList: string[] = [];
        const generalReminders: any[] = [];

        dueReminders.forEach(reminder => {
            const taskId = reminder.taskId || '';
            const taskName = reminder.taskName || '';

            if (taskId.startsWith('cocp-safecustody-')) {
                const dueDate = reminder.dueDate instanceof admin.firestore.Timestamp 
                    ? reminder.dueDate.toDate() 
                    : new Date(reminder.dueDate);
                const dateKey = format(dueDate, 'PPP');
                const mobile = extractMobile(taskName);
                
                if (mobile) {
                    if (!safeCustodyGroups[dateKey]) safeCustodyGroups[dateKey] = [];
                    safeCustodyGroups[dateKey].push(mobile);
                } else {
                    generalReminders.push(reminder);
                }
            } else if (taskId.startsWith('prebooked-rtp-')) {
                const mobile = extractMobile(taskName);
                if (mobile) {
                    prebookedRtpList.push(mobile);
                } else {
                    generalReminders.push(reminder);
                }
            } else {
                generalReminders.push(reminder);
            }
        });

        // 1. Safe Custody Category
        const dateKeys = Object.keys(safeCustodyGroups).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
        if (dateKeys.length > 0) {
            let scMessage = `📅 **Safe Custody Dates Arrived (COCP)**\n\n`;
            for (const dateKey of dateKeys) {
                const mobiles = safeCustodyGroups[dateKey];
                scMessage += `*Date: ${dateKey}*\n`;
                mobiles.forEach(m => scMessage += `• \`${m}\`\n`);
                scMessage += `\n`;
            }
            await broadcastWithRetry('WORK_REMINDERS', scMessage, 'BOT');
            await sleep(2000);
        }

        // 2. Pre-booked Category
        if (prebookedRtpList.length > 0) {
            let pbMessage = `📅 **Pre-Booked Numbers now RTP**\n\n`;
            prebookedRtpList.forEach(m => pbMessage += `• \`${m}\`\n`);
            pbMessage += `\nPlease update these records in the dashboard.`;
            await broadcastWithRetry('WORK_REMINDERS', pbMessage, 'BOT');
            await sleep(2000);
        }

        // 3. General Reminders Category
        if (generalReminders.length > 0) {
            let genMessage = `📅 **Other Pending Reminders**\n\n`;
            generalReminders.forEach((r, idx) => {
                const dueDate = r.dueDate instanceof admin.firestore.Timestamp ? r.dueDate.toDate() : new Date(r.dueDate);
                const assignedTo = Array.isArray(r.assignedTo) ? r.assignedTo.join(', ') : r.assignedTo;
                genMessage += `${idx + 1}. **${r.taskName}**\n`;
                genMessage += `   - Assigned to: ${assignedTo}\n`;
                genMessage += `   - Due: ${format(dueDate, 'PPP')}\n\n`;
            });
            await broadcastWithRetry('WORK_REMINDERS', genMessage, 'BOT');
        }

    } catch (error: any) {
        logger.error(`[ERROR] Reminder processing cycle failed: ${error.message}`);
    }
}

/**
 * Starts a scheduler that checks for due reminders every day at 7:00 AM.
 */
export function startReminderScheduler() {
    logger.info("⏰ Robust Reminder Scheduler initialized (Daily at 07:00 AM IST).");

    // Schedule: 07:00 AM every day in Asia/Kolkata timezone
    cron.schedule('0 7 * * *', async () => {
        logger.info("📅 Triggering scheduled daily reminder check at 07:00 AM IST...");
        await processDueReminders();
    }, {
        timezone: "Asia/Kolkata"
    });

    // Initial check after startup (30 seconds delay to allow system to settle)
    setTimeout(async () => {
        logger.info("🔄 Running initial startup reminder check...");
        await processDueReminders();
    }, 30000);
}
