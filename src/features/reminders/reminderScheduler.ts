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

        // Construct the summary message
        let messages: string[] = [];
        let currentMessage = `⚠️ **Daily Task Summary**\n\n`;

        // 1. Safe Custody Section
        const dateKeys = Object.keys(safeCustodyGroups).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
        for (const dateKey of dateKeys) {
            const mobiles = safeCustodyGroups[dateKey];
            let section = `📅 **Safe Custody Date Arrived (${dateKey})**\n`;
            mobiles.forEach(m => section += `• \`${m}\`\n`);
            section += `\n`;

            if ((currentMessage + section).length > 3500) {
                messages.push(currentMessage);
                currentMessage = section;
            } else {
                currentMessage += section;
            }
        }

        // 2. Pre-booked Section
        if (prebookedRtpList.length > 0) {
            let section = `📅 **Pre-Booked Numbers now RTP**\n`;
            prebookedRtpList.forEach(m => section += `• \`${m}\`\n`);
            section += `\n`;

            if ((currentMessage + section).length > 3500) {
                messages.push(currentMessage);
                currentMessage = section;
            } else {
                currentMessage += section;
            }
        }

        // 3. General Section
        if (generalReminders.length > 0) {
            let section = `📅 **Other Pending Tasks**\n`;
            generalReminders.forEach((r, idx) => {
                const dueDate = r.dueDate instanceof admin.firestore.Timestamp ? r.dueDate.toDate() : new Date(r.dueDate);
                const assignedTo = Array.isArray(r.assignedTo) ? r.assignedTo.join(', ') : r.assignedTo;
                section += `${idx + 1}. **${r.taskName}**\n`;
                section += `   - Assigned to: ${assignedTo}\n`;
                section += `   - Due: ${format(dueDate, 'PPP')}\n\n`;
            });

            if ((currentMessage + section).length > 3500) {
                messages.push(currentMessage);
                currentMessage = section;
            } else {
                currentMessage += section;
            }
        }

        currentMessage += `Please check the dashboard to manage these tasks.`;
        messages.push(currentMessage);

        // Broadcast summary message(s)
        for (let i = 0; i < messages.length; i++) {
            const label = messages.length > 1 ? ` (Part ${i + 1}/${messages.length})` : '';
            await broadcastWithRetry('WORK_REMINDERS', messages[i] + label, 'BOT');
            
            if (i < messages.length - 1) {
                await sleep(3000); // 3s delay between summary parts
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
