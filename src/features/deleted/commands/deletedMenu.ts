import TelegramBot from 'node-telegram-bot-api';
import { CommandRouter } from '../../../core/router/commandRouter';
import { Guard } from '../../../core/auth/guard';
import { env } from '../../../config/env';
import { startListDeletedFlow } from '../flows/listDeletedFlow';
import { startRestoreDeletedFlow } from '../flows/restoreDeletedFlow';
import { startDetailsDeletedFlow } from '../flows/detailsDeletedFlow';

export async function deletedMenuCommand(bot: TelegramBot, chatId: number, username?: string) {
    const opts: TelegramBot.SendMessageOptions = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '📜 List Deleted Numbers', callback_data: 'deleted_list' }],
                [{ text: '♻️ Restore Number', callback_data: 'deleted_restore' }],
                [{ text: '🔍 View Details', callback_data: 'deleted_details' }]
            ]
        }
    };

    await bot.sendMessage(chatId, "🗑️ *Deleted Numbers*\n\nView and restore numbers that were previously deleted.", opts);
}

export function registerDeletedFeature(router: CommandRouter) {
    const bot = router.bot;

    router.register(/^(?:\/start|start)$/i, async (msg) => {
        await deletedMenuCommand(bot, msg.chat.id, msg.from?.username);
    }, [env.TG_GROUP_DELETED_NUMBERS || '']);

    router.registerCallback('deleted_numbers_start', async (query) => {
        await deletedMenuCommand(bot, query.message!.chat.id, query.from.username);
    }, [env.TG_GROUP_DELETED_NUMBERS || '']); // Use Dealer for routing group check? No, use Deleted.

    router.registerCallback('deleted_list', Guard.registeredOnlyCallback(bot, async (query) => {
        await startListDeletedFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_DELETED_NUMBERS || '']);

    router.registerCallback('deleted_restore', Guard.registeredOnlyCallback(bot, async (query) => {
        await startRestoreDeletedFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_DELETED_NUMBERS || '']);

    router.registerCallback('deleted_details', Guard.registeredOnlyCallback(bot, async (query) => {
        await startDetailsDeletedFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_DELETED_NUMBERS || '']);
}
