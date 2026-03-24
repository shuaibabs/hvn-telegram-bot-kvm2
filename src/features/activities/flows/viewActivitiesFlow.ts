import TelegramBot from 'node-telegram-bot-api';
import { getRecentActivities, getAllActivities } from '../activityService';
import { escapeMarkdown } from '../../../shared/utils/telegram';
import { formatToDDMMYYYY } from '../../../shared/utils/dateUtils';

export async function handleViewActivities(bot: TelegramBot, callbackQuery: TelegramBot.CallbackQuery) {
    const chatId = callbackQuery.message!.chat.id;
    const data = callbackQuery.data;

    await bot.answerCallbackQuery(callbackQuery.id);

    let limit = 10;
    let isAll = false;

    if (data === 'view_recent_25') limit = 25;
    if (data === 'view_recent_50') limit = 50;
    if (data === 'view_recent_100') limit = 100;
    if (data === 'view_all_activities') isAll = true;

    try {
        const activities = isAll ? await getAllActivities() : await getRecentActivities(limit);

        if (activities.length === 0) {
            await bot.sendMessage(chatId, "📭 No activities found.");
            return;
        }

        let message = `📜 *${isAll ? 'All' : `Recent ${limit}`} Activities*\n\n`;

        for (const act of activities) {
            const entry = `📌 *#${act.srNo}* | ${escapeMarkdown(act.action)}\n` +
                `└ *Target:* ${escapeMarkdown(act.employeeName)}\n` +
                `└ *By:* ${escapeMarkdown(act.createdBy)} | ${formatToDDMMYYYY(act.timestamp)}\n\n`;

            // Handle long messages by splitting
            if ((message + entry).length > 4000) {
                await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                message = '';
            }
            message += entry;
        }

        if (message) {
            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        }

    } catch (error: any) {
        await bot.sendMessage(chatId, `❌ Error fetching activities: ${error.message}`);
    }
}
