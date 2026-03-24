import TelegramBot from 'node-telegram-bot-api';
import { CommandRouter } from '../../../core/router/commandRouter';
import { Guard } from '../../../core/auth/guard';
import { env } from '../../../config/env';
import { startListPostpaidFlow } from '../flows/listPostpaidFlow';
import { startSearchPostpaidFlow } from '../flows/searchPostpaidFlow';
import { startDetailPostpaidFlow } from '../flows/detailPostpaidFlow';
import { startEditPostpaidFlow } from '../flows/editPostpaidFlow';

export const postpaidMenuCommand = async (bot: TelegramBot, chatId: number | string, username?: string) => {
    const keyboard = [
        [{ text: '📋 List Postpaid Numbers', callback_data: 'postpaid_list' }],
        [{ text: '🔍 Search Postpaid', callback_data: 'postpaid_search' }],
        [{ text: 'ℹ️ Postpaid Details', callback_data: 'postpaid_detail' }],
        [{ text: '✏️ Edit Postpaid Details', callback_data: 'postpaid_edit' }]
    ];

    await bot.sendMessage(chatId, "📱 *Postpaid Management Menu*\n\nWelcome! Use the buttons below to manage postpaid numbers.", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: keyboard
        }
    });
};

export function registerPostpaidMenu(router: CommandRouter) {
    const bot = router.bot;

    // Command: /postpaid
    router.register(/^(?:\/start|start)$/i, async (msg) => {
        await postpaidMenuCommand(bot, msg.chat.id, msg.from?.username);
    }, [env.TG_GROUP_POSTPAID_NUMBERS || '']);

    // Callback: postpaid_start
    router.registerCallback('postpaid_start', Guard.registeredOnlyCallback(bot, async (query) => {
        await postpaidMenuCommand(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_POSTPAID_NUMBERS || '']);

    // List
    router.registerCallback('postpaid_list', Guard.registeredOnlyCallback(bot, async (query) => {
        await startListPostpaidFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_POSTPAID_NUMBERS || '']);

    // Search
    router.registerCallback('postpaid_search', Guard.registeredOnlyCallback(bot, async (query) => {
        await startSearchPostpaidFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_POSTPAID_NUMBERS || '']);

    // Detail
    router.registerCallback('postpaid_detail', Guard.registeredOnlyCallback(bot, async (query) => {
        await startDetailPostpaidFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_POSTPAID_NUMBERS || '']);

    // Edit
    router.registerCallback('postpaid_edit', Guard.registeredOnlyCallback(bot, async (query) => {
        await startEditPostpaidFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_POSTPAID_NUMBERS || '']);
}
