import { env } from '../config/env';
import { CommandRouter } from '../core/router/commandRouter';
import TelegramBot from 'node-telegram-bot-api';

export function registerGeneralCommands(router: CommandRouter) {
    // Health check command
    router.register(/\/health/, (msg: TelegramBot.Message) => {
        const chatId = msg.chat.id;
        router.bot.sendMessage(chatId, `✅ Bot is up and running!\n\n📍 *Current Chat ID:* \`${chatId}\``, { parse_mode: 'Markdown' });
    });

    // Fallback handler for unrecognized commands
    router.setFallbackHandler((msg: TelegramBot.Message) => {
        const chatId = msg.chat.id.toString();

        let callbackData = 'manage_users_start'; // Default
        if (chatId === env.TG_GROUP_ACTIVITY) {
            callbackData = 'manage_activities_start';
        } else if (chatId === env.TG_GROUP_USERS) {
            callbackData = 'manage_users_start';
        } else if (chatId === env.TG_GROUP_INVENTORY) {
            callbackData = 'inventory_start';
        } else if (chatId === env.TG_GROUP_SALES) {
            callbackData = 'sales_start';
        } else if (chatId === env.TG_GROUP_PREBOOKING) {
            callbackData = 'prebooking_start';
        } else if (chatId === env.TG_GROUP_PARTNERS) {
            callbackData = 'partners_start';
        } else if (chatId === env.TG_GROUP_POSTPAID_NUMBERS) {
            callbackData = 'postpaid_start';
        } else if (chatId === env.TG_GROUP_COCP) {
            callbackData = 'cocp_start';
        } else if (chatId === env.TG_GROUP_GLOBAL_HISTORY) {
            callbackData = 'history_start';
        } else if (chatId === env.TG_GROUP_SIM_LOCATIONS) {
            callbackData = 'sim_locations_start';
        } else if (chatId === env.TG_GROUP_DEALER_PURCHASES) {
            callbackData = 'dealer_purchases_start';
        } else if (chatId === env.TG_GROUP_DELETED_NUMBERS) {
            callbackData = 'deleted_numbers_start';
        }

        router.bot.sendMessage(msg.chat.id, "😕 *Unrecognized Command*\n\nIt's not the correct command. Please use /start to see available options.", {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🚀 Get Started', callback_data: callbackData }]]
            }
        });
    });
}
