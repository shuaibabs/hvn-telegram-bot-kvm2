import TelegramBot from 'node-telegram-bot-api';
import { clearAllActivities, logActivity } from '../activityService';

export async function handleClearActivities(bot: TelegramBot, callbackQuery: TelegramBot.CallbackQuery) {
    const chatId = callbackQuery.message!.chat.id;
    const data = callbackQuery.data;

    if (data === 'clear_activities_start') {
        await bot.answerCallbackQuery(callbackQuery.id);
        await bot.sendMessage(chatId, "⚠️ *Confirm Clear Logs*\n\nAre you sure you want to delete ALL activity logs? This action cannot be undone.", {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔥 Yes, Delete All', callback_data: 'clear_activities_confirm' }],
                    [{ text: '❌ No, Cancel', callback_data: 'clear_activities_cancel' }]
                ]
            }
        });
        return;
    }

    if (data === 'clear_activities_confirm') {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Clearing logs...' });
        try {
            await clearAllActivities();
            await bot.sendMessage(chatId, "✅ All activity logs have been cleared successfully.");

            // Log Activity & Broadcast
            const creator = callbackQuery.from.first_name + (callbackQuery.from.last_name ? ' ' + callbackQuery.from.last_name : '');
            await logActivity(bot, {
                employeeName: 'System',
                action: 'CLEAR_LOGS',
                description: 'All activity logs were cleared',
                createdBy: creator,
                source: 'BOT',
                groupName: 'ACTIVITY'
            }, true);
        } catch (error: any) {
            await bot.sendMessage(chatId, `❌ Error clearing activities: ${error.message}`);
        }
    } else if (data === 'clear_activities_cancel') {
        await bot.answerCallbackQuery(callbackQuery.id);
        await bot.sendMessage(chatId, "❌ Action cancelled.");
    }
}
