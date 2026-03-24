import TelegramBot from 'node-telegram-bot-api';
import { CommandRouter } from '../../../core/router/commandRouter';
import { Guard } from '../../../core/auth/guard';
import { env } from '../../../config/env';
import { startListPartnersFlow } from '../flows/listPartnersFlow';
import { startSearchPartnersFlow } from '../flows/searchPartnersFlow';
import { startDetailPartnersFlow } from '../flows/detailPartnersFlow';

export const partnersMenuCommand = async (bot: TelegramBot, chatId: number | string, username?: string) => {
    const keyboard = [
        [{ text: '📋 List Partnership Numbers', callback_data: 'partners_list' }],
        [{ text: '🔍 Search Partnership', callback_data: 'partners_search' }],
        [{ text: 'ℹ️ Partnership Details', callback_data: 'partners_detail' }]
    ];

    await bot.sendMessage(chatId, "🤝 *Partnership Management Menu*\n\nWelcome! Use the buttons below to manage partnership numbers.", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: keyboard
        }
    });
};

export function registerPartnersMenu(router: CommandRouter) {
    const bot = router.bot;

    // Command: /partners
    router.register(/^(?:\/start|start)$/i, async (msg) => {
        await partnersMenuCommand(bot, msg.chat.id, msg.from?.username);
    }, [env.TG_GROUP_PARTNERS || '']);

    // Callback: partners_start
    router.registerCallback('partners_start', Guard.registeredOnlyCallback(bot, async (query) => {
        await partnersMenuCommand(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_PARTNERS || '']);

    // List
    router.registerCallback('partners_list', Guard.registeredOnlyCallback(bot, async (query) => {
        await startListPartnersFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_PARTNERS || '']);

    // Search
    router.registerCallback('partners_search', Guard.registeredOnlyCallback(bot, async (query) => {
        await startSearchPartnersFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_PARTNERS || '']);

    // Detail
    router.registerCallback('partners_detail', Guard.registeredOnlyCallback(bot, async (query) => {
        await startDetailPartnersFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_PARTNERS || '']);
}
