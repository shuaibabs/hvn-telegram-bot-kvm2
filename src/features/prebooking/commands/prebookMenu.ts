import TelegramBot from 'node-telegram-bot-api';
import { CommandRouter } from '../../../core/router/commandRouter';
import { Guard } from '../../../core/auth/guard';
import { env } from '../../../config/env';
import { isAdmin } from '../../../core/auth/permissions';
import { startListPrebookFlow } from '../flows/listPrebookFlow';
import { startSearchPrebookFlow } from '../flows/searchPrebookFlow';
import { startDetailPrebookFlow } from '../flows/detailPrebookFlow';
import { startCancelPrebookFlow } from '../flows/cancelPrebookFlow';

export const prebookMenuCommand = async (bot: TelegramBot, chatId: number | string, username?: string) => {
    const isUserAdmin = await isAdmin(username);

    const keyboard = [
        [{ text: '📋 List Pre-booked Numbers', callback_data: 'prebook_list' }],
        [{ text: '🔍 Search Pre-bookings', callback_data: 'prebook_search' }],
        [{ text: 'ℹ️ Pre-booking Details', callback_data: 'prebook_detail' }],
        [{ text: '❌ Cancel Pre-booking', callback_data: 'prebooking_cancel' }]
    ];

    await bot.sendMessage(chatId, "📖 *Pre-booking Management Menu*\n\nWelcome! Use the buttons below to manage pre-booked numbers.", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: keyboard
        }
    });
};

export function registerPrebookMenu(router: CommandRouter) {
    const bot = router.bot;

    // Handle /start, START, start
    router.register(/^(?:\/start|start)$/i, Guard.registeredOnlyCommand(bot, async (msg) => {
        await prebookMenuCommand(bot, msg.chat.id, msg.from?.username);
    }), [env.TG_GROUP_PREBOOKING || '']);

    // Handle standard Get Started button
    router.registerCallback('prebooking_start', Guard.registeredOnlyCallback(bot, async (query) => {
        await prebookMenuCommand(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_PREBOOKING || '']);

    // List Pre-bookings
    router.registerCallback('prebook_list', Guard.registeredOnlyCallback(bot, async (query) => {
        await startListPrebookFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_PREBOOKING || '']);

    // Search Pre-bookings
    router.registerCallback('prebook_search', Guard.registeredOnlyCallback(bot, async (query) => {
        await startSearchPrebookFlow(bot, query.message!.chat.id);
    }), [env.TG_GROUP_PREBOOKING || '']);

    // Pre-booking Details
    router.registerCallback('prebook_detail', Guard.registeredOnlyCallback(bot, async (query) => {
        await startDetailPrebookFlow(bot, query.message!.chat.id);
    }), [env.TG_GROUP_PREBOOKING || '']);

    // Cancel Pre-booking
    router.registerCallback('prebooking_cancel', Guard.registeredOnlyCallback(bot, async (query) => {
        await startCancelPrebookFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_PREBOOKING || '']);
}
