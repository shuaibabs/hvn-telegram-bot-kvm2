import TelegramBot from 'node-telegram-bot-api';
import { CommandRouter } from '../../../core/router/commandRouter';
import { Guard } from '../../../core/auth/guard';
import { GROUPS } from '../../../config/env';
import { startBrowseCategoriesFlow, startCheckNumberCategoryFlow, handleCategoriesCallback, handleCategoriesMessage } from '../flows/categoriesFlow';

export async function categoriesMenuCommand(bot: TelegramBot, chatId: number, username?: string) {
    const opts: TelegramBot.SendMessageOptions = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '📋 Browse Categories', callback_data: 'cat_browse_page_0' }],
                [{ text: '🔍 Check Number\'s Category', callback_data: 'cat_check_number' }]
            ]
        }
    };

    await bot.sendMessage(chatId, "🏷️ *VIP Numbers Categories*\n\nBrowse numbers matching specific VIP categories or check which categories a specific number belongs to.", opts);
}

export function registerCategoriesMenu(router: CommandRouter) {
    const bot = router.bot;

    // Command: /start or start
    router.register(/^(?:\/start|start)$/i, async (msg: TelegramBot.Message) => {
        await categoriesMenuCommand(bot, msg.chat.id, msg.from?.username);
    }, [GROUPS.CATEGORIES || '']);

    // Callback: cat_start
    router.registerCallback('cat_start', async (query) => {
        await bot.answerCallbackQuery(query.id);
        await categoriesMenuCommand(bot, query.message!.chat.id, query.from.username);
    }, [GROUPS.CATEGORIES || '']);

    // Callback handlers prefix 'cat_'
    router.registerCallback(/^cat_/, Guard.registeredOnlyCallback(bot, async (query) => {
        await handleCategoriesCallback(bot, query);
    }), [GROUPS.CATEGORIES || '']);

    // Listen for text messages when in a flow state
    bot.on('message', async (msg: TelegramBot.Message) => {
        // Only run if the message is from the correct chat group and not a command
        if (msg.chat.id.toString() === GROUPS.CATEGORIES && msg.text && !msg.text.startsWith('/')) {
            await handleCategoriesMessage(bot, msg);
        }
    });
}
