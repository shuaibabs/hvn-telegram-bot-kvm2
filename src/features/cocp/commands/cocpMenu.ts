import TelegramBot from 'node-telegram-bot-api';
import { CommandRouter } from '../../../core/router/commandRouter';
import { Guard } from '../../../core/auth/guard';
import { env } from '../../../config/env';
import { startListCOCPFlow } from '../flows/listCOCPFlow';
import { startSearchCOCPFlow } from '../flows/searchCOCPFlow';
import { startDetailCOCPFlow } from '../flows/detailCOCPFlow';
import { startEditCOCPFlow } from '../flows/editCOCPFlow';

export const cocpMenuCommand = async (bot: TelegramBot, chatId: number | string, username?: string) => {
    const keyboard = [
        [{ text: '📋 List COCP Numbers', callback_data: 'cocp_list' }],
        [{ text: '🔍 Search COCP', callback_data: 'cocp_search' }],
        [{ text: 'ℹ️ COCP Details', callback_data: 'cocp_detail' }],
        [{ text: '✏️ Edit Safe Custody Date', callback_data: 'cocp_edit' }]
    ];

    await bot.sendMessage(chatId, "🏢 *COCP Management Menu*\n\nWelcome! Use the buttons below to manage COCP numbers.", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: keyboard
        }
    });
};

export function registerCOCPMenu(router: CommandRouter) {
    const bot = router.bot;

    // Command: /cocp
    router.register(/^(?:\/start|start)$/i, async (msg) => {
        await cocpMenuCommand(bot, msg.chat.id, msg.from?.username);
    }, [env.TG_GROUP_COCP || '']);

    // Callback: cocp_start
    router.registerCallback('cocp_start', Guard.registeredOnlyCallback(bot, async (query) => {
        await cocpMenuCommand(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_COCP || '']);

    // List
    router.registerCallback('cocp_list', Guard.registeredOnlyCallback(bot, async (query) => {
        await startListCOCPFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_COCP || '']);

    // Search
    router.registerCallback('cocp_search', Guard.registeredOnlyCallback(bot, async (query) => {
        await startSearchCOCPFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_COCP || '']);

    // Detail
    router.registerCallback('cocp_detail', Guard.registeredOnlyCallback(bot, async (query) => {
        await startDetailCOCPFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_COCP || '']);

    // Edit
    router.registerCallback('cocp_edit', Guard.registeredOnlyCallback(bot, async (query) => {
        await startEditCOCPFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_COCP || '']);
}
