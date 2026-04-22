import TelegramBot from 'node-telegram-bot-api';
import { clearAllActivities, logActivity } from '../activityService';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';

export async function handleClearActivities(bot: TelegramBot, callbackQuery: TelegramBot.CallbackQuery) {
    const chatId = callbackQuery.message!.chat.id;
    const data = callbackQuery.data;

    if (data === 'clear_activities_start') {
        setSession(chatId, 'clearActivities', { stage: 'CONFIRM' });
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
        const session = getSession(chatId, 'clearActivities');
        if (!session || session.stage !== 'CONFIRM') return;

        // Lock session
        session.stage = 'SAVING';
        setSession(chatId, 'clearActivities', session);

        // Remove buttons
        try {
            await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                chat_id: chatId,
                message_id: callbackQuery.message!.message_id
            });
        } catch (e) {
            logger.warn('Failed to remove buttons in clearActivities: ' + (e as Error).message);
        }

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
        } finally {
            clearSession(chatId, 'clearActivities');
        }
    } else if (data === 'clear_activities_cancel') {
        clearSession(chatId, 'clearActivities');
        await bot.answerCallbackQuery(callbackQuery.id);
        await bot.sendMessage(chatId, "❌ Action cancelled.");
    }
}
