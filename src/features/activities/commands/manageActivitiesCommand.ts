import TelegramBot from 'node-telegram-bot-api';
import { isAdmin } from '../../../core/auth/permissions';

export async function manageActivitiesCommand(bot: TelegramBot, msg: TelegramBot.Message, fromUser?: TelegramBot.User) {
    const chatId = msg.chat.id;
    const user = fromUser || msg.from;
    const username = user?.username;
    const isUserAdmin = await isAdmin(username);

    const welcomeMessage = "📊 *Activity Management*\n\nWelcome to the activity log manager. What would you like to do?";

    const inline_keyboard: any[][] = [
        [
            { text: '📜 View Recent 10', callback_data: 'view_recent_10' },
            { text: '📜 View Recent 25', callback_data: 'view_recent_25' }
        ],
        [
            { text: '📜 View Recent 50', callback_data: 'view_recent_50' },
            { text: '📜 View Recent 100', callback_data: 'view_recent_100' }
        ],
        [
            { text: '📑 View All Activities', callback_data: 'view_all_activities' }
        ]
    ];

    // BUG-2 Fix Refined: Hide options for non-admins
    if (isUserAdmin) {
        inline_keyboard.push([
            { text: '🗑️ Delete Single Activity', callback_data: 'delete_act_start' }
        ]);
        inline_keyboard.push([
            { text: '🔥 Clear Activity Logs', callback_data: 'clear_activities_start' }
        ]);
    }

    const keyboard = {
        reply_markup: {
            inline_keyboard
        }
    };

    await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown', ...keyboard });
}
