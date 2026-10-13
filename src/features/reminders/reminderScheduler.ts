import { getDueReminders, startSystemReminderMonitor } from './remindersService';
import { broadcast } from '../broadcast/broadcastService';
import { logger } from '../../core/logger/logger';
import * as cron from 'node-cron';
import { custodyTasks, indiaDay, reminderDate } from '../../shared/utils/systemReminders';

/**
 * Helper to wait for a specified duration
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The broadcast service retries individual failed parts without repeating delivered parts.
 */
async function broadcastReminder(group: string, message: string) {
    const result = await broadcast(group, message, 'BOT');
    if (!result.success) logger.error(`❌ Reminder broadcast failed: ${result.error}`);
    return result.success;
}

const formatReminderDate = (value: Parameters<typeof reminderDate>[0]) => reminderDate(value)!.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric'
});
let processing = false;

/**
 * Extracts a 10-digit mobile number from a string
 */
function extractMobile(text: string): string | null {
    const match = text.match(/\d{10}/);
    return match ? match[0] : null;
}

/**
 * Fetches due reminders and broadcasts them in grouped summaries to Telegram.
 * Groups custody and pre-booking tasks into summaries.
 */
export async function processDueReminders() {
    if (processing) {
        logger.warn('Reminder check already running; skipping overlapping cycle.');
        return;
    }
    processing = true;
    try {
        const dueReminders = await getDueReminders();
        
        if (dueReminders.length === 0) {
            logger.info("No due reminders found in this cycle.");
            return;
        }

        logger.info(`Processing ${dueReminders.length} due reminders...`);

        // Categorize reminders
        const custodyGroups: Record<string, Record<string, Set<string>>> = {};
        const prebookedRtpList: string[] = [];
        const generalReminders: any[] = [];

        dueReminders.forEach(reminder => {
            const taskId = reminder.taskId || '';
            const taskName = reminder.taskName || '';

            const custodyTask = custodyTasks.find(task => taskId.startsWith(task.prefix));
            if (custodyTask) {
                const dateKey = indiaDay(reminder.dueDate)!;
                const mobile = reminder.mobile || extractMobile(taskName);
                
                if (mobile) {
                    const groups = custodyGroups[custodyTask.label] ||= {};
                    if (!groups[dateKey]) groups[dateKey] = new Set();
                    groups[dateKey].add(`\`${mobile}\` — Account: ${reminder.accountName || 'N/A'}`);
                } else {
                    generalReminders.push(reminder);
                }
            } else if (taskId.startsWith('prebooked-rtp-')) {
                const mobile = reminder.mobile || extractMobile(taskName);
                if (mobile) {
                    prebookedRtpList.push(`\`${mobile}\` — Account: ${reminder.accountName || 'N/A'}`);
                } else {
                    generalReminders.push(reminder);
                }
            } else {
                generalReminders.push(reminder);
            }
        });

        // 1. COCP custody categories
        for (const task of custodyTasks) {
            const groups = custodyGroups[task.label] || {};
            const dateKeys = Object.keys(groups).sort();
            if (!dateKeys.length) continue;
            let scMessage = `📅 **${task.label} Dates Arrived (COCP)**\n\n`;
            for (const dateKey of dateKeys) {
                const mobiles = groups[dateKey];
                scMessage += `**Date: ${formatReminderDate(new Date(`${dateKey}T00:00:00+05:30`))}**\n`;
                mobiles.forEach(m => scMessage += `• ${m}\n`);
                scMessage += `\n`;
            }
            await broadcastReminder('WORK_REMINDERS', scMessage);
            await sleep(2000);
        }

        // 2. Pre-booked Category
        if (prebookedRtpList.length > 0) {
            let pbMessage = `📅 **Pre-Booked Numbers now RTP**\n\n`;
            prebookedRtpList.forEach(m => pbMessage += `• ${m}\n`);
            pbMessage += `\nPlease update these records in the dashboard.`;
            await broadcastReminder('WORK_REMINDERS', pbMessage);
            await sleep(2000);
        }

        // 3. General Reminders Category
        if (generalReminders.length > 0) {
            let genMessage = `📅 **Other Pending Reminders**\n\n`;
            generalReminders.forEach((r, idx) => {
                const assignedTo = Array.isArray(r.assignedTo) ? r.assignedTo.join(', ') : r.assignedTo;
                genMessage += `${idx + 1}. **${r.taskName}**\n`;
                genMessage += `   - Account: ${r.accountName || 'N/A'}\n`;
                genMessage += `   - Assigned to: ${assignedTo}\n`;
                genMessage += `   - Due: ${formatReminderDate(r.dueDate)}\n\n`;
            });
            await broadcastReminder('WORK_REMINDERS', genMessage);
        }

    } catch (error: any) {
        logger.error(`[ERROR] Reminder processing cycle failed: ${error.message}`);
    } finally {
        processing = false;
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

    // New or newly arrived dates must reach the UI/Telegram queue without an open admin dashboard.
    // The daily consolidated summary remains at 07:00 IST.
    startSystemReminderMonitor();

    // Initial check after startup (30 seconds delay to allow system to settle)
    setTimeout(async () => {
        logger.info("🔄 Running initial startup reminder check...");
        await processDueReminders();
    }, 30000);
}
