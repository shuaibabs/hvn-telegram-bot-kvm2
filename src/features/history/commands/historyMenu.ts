import TelegramBot from 'node-telegram-bot-api';
import { CommandRouter } from '../../../core/router/commandRouter';
import { Guard } from '../../../core/auth/guard';
import { env } from '../../../config/env';
import { startDetailHistoryFlow } from '../flows/detailHistoryFlow';

export const historyMenuCommand = async (bot: TelegramBot, chatId: number | string, username?: string) => {
    const keyboard = [
        [{ text: 'ℹ️ Show Number History', callback_data: 'history_detail' }]
    ];

    await bot.sendMessage(chatId, "📜 *Global History Management Menu*\n\nWelcome! Use the button below to view the full lifecycle history of any number.", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: keyboard
        }
    });
};

export function registerHistoryMenu(router: CommandRouter) {
    const bot = router.bot;

    // Command: /history
    router.register(/^(?:\/start|start)$/i, async (msg) => {
        await historyMenuCommand(bot, msg.chat.id, msg.from?.username);
    }, [env.TG_GROUP_GLOBAL_HISTORY || '']);

    // Callback: history_start
    router.registerCallback('history_start', Guard.registeredOnlyCallback(bot, async (query) => {
        await historyMenuCommand(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_GLOBAL_HISTORY || '']);

    // Detail Flow
    router.registerCallback('history_detail', Guard.registeredOnlyCallback(bot, async (query) => {
        await startDetailHistoryFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_GLOBAL_HISTORY || '']);
}
