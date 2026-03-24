import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { getPendingReminders, markReminderAsDone } from '../remindersService';
import { isAdmin, getUserProfile } from '../../../core/auth/permissions';
import { CommandRouter } from '../../../core/router/commandRouter';
import { logActivity } from '../../activities/activityService';
import { formatToDDMMYYYY } from '../../../shared/utils/dateUtils';

const PAGE_SIZE = 5;

export async function startListRemindersFlow(bot: TelegramBot, chatId: number, username?: string) {
    const isUserAdmin = await isAdmin(username);
    const profile = await getUserProfile(username);
    const assignedTo = isUserAdmin ? undefined : profile?.displayName;

    if (!isUserAdmin && !assignedTo) {
        await bot.sendMessage(chatId, "❌ *Profile Incomplete*\n\nYour profile does not have a display name set.", { parse_mode: 'Markdown' });
        return;
    }

    setSession(chatId, 'listReminders', { page: 0, assignedTo });
    await showRemindersPage(bot, chatId, 0, assignedTo);
}

async function showRemindersPage(bot: TelegramBot, chatId: number, page: number, assignedTo?: string) {
    try {
        const offset = page * PAGE_SIZE;
        const { reminders, total } = await getPendingReminders(assignedTo, PAGE_SIZE, offset);

        if (total === 0) {
            await bot.sendMessage(chatId, "📝 *Your Task List*\n\nYou have no pending reminders. Great job! 👍", { parse_mode: 'Markdown' });
            clearSession(chatId, 'listReminders');
            return;
        }

        let text = `📅 *Pending Reminders (${total})*\n`;
        text += `_Page ${page + 1} of ${Math.ceil(total / PAGE_SIZE)}_\n`;
        text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

        const inline_keyboard: TelegramBot.InlineKeyboardButton[][] = [];

        reminders.forEach((r: any, i: number) => {
            const date = formatToDDMMYYYY(r.dueDate);
            text += `${offset + i + 1}. *${r.taskName}*\n`;
            text += `   📅 Due: ${date} | 👤: ${r.assignedTo.join(', ')}\n\n`;
            
            inline_keyboard.push([{ text: `✅ Done: ${r.taskName.substring(0, 15)}...`, callback_data: `rem_done_${r.id}` }]);
        });

        const navButtons: TelegramBot.InlineKeyboardButton[] = [];
        if (page > 0) navButtons.push({ text: '⬅️ Back', callback_data: `rem_page_${page - 1}` });
        if (offset + PAGE_SIZE < total) navButtons.push({ text: 'Next ➡️', callback_data: `rem_page_${page + 1}` });
        
        if (navButtons.length > 0) inline_keyboard.push(navButtons);
        inline_keyboard.push([{ text: '❌ Close', callback_data: 'rem_list_close' }]);

        await bot.sendMessage(chatId, text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard }
        });
    } catch (error: any) {
        logger.error(`Error in showRemindersPage: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}

export function registerListRemindersFlow(router: CommandRouter) {
    const bot = router.bot;

    router.registerCallback(/^rem_page_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'listReminders');
        if (!session) return;

        const page = parseInt(query.data!.split('_').pop()!);
        session.page = page;
        setSession(chatId, 'listReminders', session);

        await bot.deleteMessage(chatId, query.message!.message_id).catch(() => {});
        await showRemindersPage(bot, chatId, page, session.assignedTo);
    });

    router.registerCallback(/^rem_done_/, async (query) => {
        const chatId = query.message!.chat.id;
        const reminderId = query.data!.replace('rem_done_', '');
        
        try {
            const { getReminderById, canMarkReminderDone } = await import('../remindersService');
            const reminder = await getReminderById(reminderId);
            
            if (!reminder) {
                await bot.answerCallbackQuery(query.id, { text: "❌ Reminder not found." });
                return;
            }

            const validation = await canMarkReminderDone(reminder);
            if (!validation.canBeDone) {
                await bot.answerCallbackQuery(query.id, { text: "⚠️ " + validation.message, show_alert: true });
                return;
            }

            await markReminderAsDone(reminderId);
            await bot.answerCallbackQuery(query.id, { text: "✅ Task marked as done!" });
            
            // Log Activity
            const creator = query.from.first_name + (query.from.last_name ? ' ' + query.from.last_name : '');
            await logActivity(bot, {
                employeeName: creator,
                action: 'Marked Task Done',
                description: `Completed task: ${reminder.taskName} via Bot.`,
                source: 'BOT',
                createdBy: creator,
                groupName: 'WORK_REMINDERS'
            }, true);

            // Refresh the current page
            const session = getSession(chatId, 'listReminders');
            if (session) {
                await bot.deleteMessage(chatId, query.message!.message_id).catch(() => {});
                await showRemindersPage(bot, chatId, session.page, session.assignedTo);
            }
        } catch (error: any) {
            logger.error(`Error in rem_done_ callback: ${error.message}`);
            await bot.answerCallbackQuery(query.id, { text: "❌ Failed to update task." });
        }
    });

    router.registerCallback('rem_list_close', async (query) => {
        clearSession(query.message!.chat.id, 'listReminders');
        await bot.deleteMessage(query.message!.chat.id, query.message!.message_id).catch(() => {});
    });
}
