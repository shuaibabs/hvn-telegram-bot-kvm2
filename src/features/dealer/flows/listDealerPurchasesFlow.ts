import TelegramBot from 'node-telegram-bot-api';
import { getDealerPurchases } from '../dealerService';
import { CommandRouter } from '../../../core/router/commandRouter';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';

export async function startListDealerPurchasesFlow(bot: TelegramBot, chatId: number, employeeUid?: string) {
    try {
        const purchases = await getDealerPurchases(employeeUid);
        if (purchases.length === 0) {
            await bot.sendMessage(chatId, "📋 No dealer purchase records found.");
            return;
        }

        const sorted = purchases.sort((a: any, b: any) => b.srNo - a.srNo);
        setSession(chatId, 'listDealerPurchases', { results: sorted, page: 0 });
        await showDealerPage(bot, chatId, 0, sorted);
    } catch (error: any) {
        logger.error(`Error in listDealerPurchasesFlow: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}

async function showDealerPage(bot: TelegramBot, chatId: number, page: number, results: any[]) {
    const PAGE_SIZE = 10;
    const count = results.length;
    const totalPages = Math.ceil(count / PAGE_SIZE);
    const offset = page * PAGE_SIZE;

    let text = `📋 *Dealer Purchase Records (${count})*\n`;
    text += `_Page ${page + 1} of ${totalPages}_\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    const displayResults = results.slice(offset, offset + PAGE_SIZE);
    displayResults.forEach((p: any) => {
        text += `🔹 \`${p.mobile}\` | ₹${p.price.toLocaleString()} | ${p.dealerName}\n`;
    });

    text += `\n━━━━━━━━━━━━━━━━━━━━`;

    const inline_keyboard: TelegramBot.InlineKeyboardButton[][] = [];
    const navButtons: TelegramBot.InlineKeyboardButton[] = [];

    if (page > 0) navButtons.push({ text: '⬅️ Back', callback_data: `dealer_list_page_${page - 1}` });
    if (offset + PAGE_SIZE < count) navButtons.push({ text: 'Next ➡️', callback_data: `dealer_list_page_${page + 1}` });

    if (navButtons.length > 0) inline_keyboard.push(navButtons);
    inline_keyboard.push([{ text: '❌ Close', callback_data: 'dealer_list_close' }]);

    await bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard }
    });
}

export function registerListDealerPurchasesFlow(router: CommandRouter) {
    const bot = router.bot;

    router.registerCallback(/^dealer_list_page_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'listDealerPurchases');
        if (!session) return;

        const page = parseInt(query.data!.split('_').pop()!);
        session.page = page;
        setSession(chatId, 'listDealerPurchases', session);

        await bot.deleteMessage(chatId, query.message!.message_id).catch(() => {});
        await showDealerPage(bot, chatId, page, session.results);
    });

    router.registerCallback('dealer_list_close', async (query) => {
        clearSession(query.message!.chat.id, 'listDealerPurchases');
        await bot.deleteMessage(query.message!.chat.id, query.message!.message_id).catch(() => {});
    });
}
