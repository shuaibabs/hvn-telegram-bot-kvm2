import TelegramBot from 'node-telegram-bot-api';
import { getBPInventory } from '../basicPremiumService';
import { CommandRouter } from '../../../core/router/commandRouter';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';

export async function startListBPInventoryFlow(bot: TelegramBot, chatId: number, employeeUid?: string) {
    try {
        const basic = await getBPInventory('basic', employeeUid);
        const premium = await getBPInventory('premium', employeeUid);
        const all = [...basic.map((b: any) => ({...b, type: 'Basic'})), ...premium.map((p: any) => ({...p, type: 'Premium'}))];

        if (all.length === 0) {
            await bot.sendMessage(chatId, "📋 No Basic/Premium inventory records found.");
            return;
        }

        const sorted = all.sort((a: any, b: any) => b.srNo - a.srNo);
        setSession(chatId, 'listBPInventory', { results: sorted, page: 0 });
        await showBPPage(bot, chatId, 0, sorted);
    } catch (error: any) {
        logger.error(`Error in listBPInventoryFlow: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}

async function showBPPage(bot: TelegramBot, chatId: number, page: number, results: any[]) {
    const PAGE_SIZE = 10;
    const count = results.length;
    const totalPages = Math.ceil(count / PAGE_SIZE);
    const offset = page * PAGE_SIZE;

    let text = `📋 *Basic / Premium Inventory (${count})*\n`;
    text += `_Page ${page + 1} of ${totalPages}_\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    const displayResults = results.slice(offset, offset + PAGE_SIZE);
    displayResults.forEach((p: any) => {
        text += `${p.type === 'Premium' ? '⭐' : '📦'} \`${p.mobile}\` | ₹${p.purchasePrice.toLocaleString()} | ${p.purchaseFrom}\n`;
    });

    text += `\n━━━━━━━━━━━━━━━━━━━━`;

    const inline_keyboard: TelegramBot.InlineKeyboardButton[][] = [];
    const navButtons: TelegramBot.InlineKeyboardButton[] = [];

    if (page > 0) navButtons.push({ text: '⬅️ Back', callback_data: `bp_list_page_${page - 1}` });
    if (offset + PAGE_SIZE < count) navButtons.push({ text: 'Next ➡️', callback_data: `bp_list_page_${page + 1}` });

    if (navButtons.length > 0) inline_keyboard.push(navButtons);
    inline_keyboard.push([{ text: '❌ Close', callback_data: 'bp_list_close' }]);

    await bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard }
    });
}

export function registerListBPInventoryFlow(router: CommandRouter) {
    const bot = router.bot;

    router.registerCallback(/^bp_list_page_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'listBPInventory');
        if (!session) return;

        const page = parseInt(query.data!.split('_').pop()!);
        session.page = page;
        setSession(chatId, 'listBPInventory', session);

        await bot.deleteMessage(chatId, query.message!.message_id).catch(() => {});
        await showBPPage(bot, chatId, page, session.results);
    });

    router.registerCallback('bp_list_close', async (query) => {
        clearSession(query.message!.chat.id, 'listBPInventory');
        await bot.deleteMessage(query.message!.chat.id, query.message!.message_id).catch(() => {});
    });
}
