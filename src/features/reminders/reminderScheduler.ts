import { getDueReminders } from './remindersService';
import { broadcast } from '../broadcast/broadcastService';
import { format } from 'date-fns';
import { logger } from '../../core/logger/logger';
import admin from 'firebase-admin';

/**
 * Starts a scheduler that checks for due reminders every 15 minutes
 * and broadcasts a notification if any are found.
 */
export function startReminderScheduler() {
    logger.info("⏰ Reminder Scheduler initialized (15-minute interval).");

    const checkReminders = async () => {
        try {
            const dueReminders = await getDueReminders();
            
            if (dueReminders.length === 0) {
                logger.debug("No due reminders found in this cycle.");
                return;
            }

            logger.info(`Found ${dueReminders.length} due reminders. Pushing notifications...`);

            // Format message mimicking the UI popup logic
            // Note: broadcast service converts ** to <b> automatically
            let message = `⚠️ **Action Required!**\n\nYou have ${dueReminders.length} pending task(s) that are due.\n\n`;
            
            dueReminders.forEach((reminder: any, index) => {
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

            message += `Please complete these tasks to dismiss the notifications.`;

            // Broadcast to WORK_REMINDERS group
            // The broadcast service logic ensures it's mirrored to the MASTER_CHANNEL
            await broadcast('WORK_REMINDERS', message, 'BOT');

        } catch (error: any) {
            logger.error(`[ERROR] Reminder scheduler cycle failed: ${error.message}`);
        }
    };

    // Initial check after startup (5 seconds delay)
    setTimeout(checkReminders, 5000);

    // Set interval for every 15 minutes (15 * 60 * 1000)
    setInterval(checkReminders, 15 * 60 * 1000);
}
