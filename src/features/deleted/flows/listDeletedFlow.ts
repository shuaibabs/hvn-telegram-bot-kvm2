import TelegramBot from 'node-telegram-bot-api';
import { getDeletedNumbers } from '../deletedService';
import { isAdmin, getUserProfile } from '../../../core/auth/permissions';
import { CommandRouter } from '../../../core/router/commandRouter';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';

export async function startListDeletedFlow(bot: TelegramBot, chatId: number, username?: string) {
    try {
        const isUserAdmin = await isAdmin(username);
        const profile = await getUserProfile(username);
        const employeeName = isUserAdmin ? undefined : profile?.displayName;

        const results = await getDeletedNumbers(employeeName);

        if (results.length === 0) {
            await bot.sendMessage(chatId, "🔍 No deleted numbers found.");
            return;
        }

        setSession(chatId, 'listDeleted', { results, page: 0, employeeName });
        await showDeletedPage(bot, chatId, 0, results);
    } catch (error: any) {
        logger.error(`Error in listDeletedFlow: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}

async function showDeletedPage(bot: TelegramBot, chatId: number, page: number, results: any[]) {
    const PAGE_SIZE = 10;
    const count = results.length;
    const totalPages = Math.ceil(count / PAGE_SIZE);
    const offset = page * PAGE_SIZE;

    let text = `📜 *Deleted Numbers (${count})*\n`;
    text += `_Page ${page + 1} of ${totalPages}_\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    const displayResults = results.slice(offset, offset + PAGE_SIZE);
    displayResults.forEach((num: any, i: number) => {
        text += `${offset + i + 1}. \`${num.mobile}\` | Deleted By: ${num.deletedBy}\n   Reason: ${num.deletionReason}\n\n`;
    });

    text += `━━━━━━━━━━━━━━━━━━━━`;

    const inline_keyboard: TelegramBot.InlineKeyboardButton[][] = [];
    const navButtons: TelegramBot.InlineKeyboardButton[] = [];

    if (page > 0) navButtons.push({ text: '⬅️ Back', callback_data: `del_list_page_${page - 1}` });
    if (offset + PAGE_SIZE < count) navButtons.push({ text: 'Next ➡️', callback_data: `del_list_page_${page + 1}` });

    if (navButtons.length > 0) inline_keyboard.push(navButtons);
    inline_keyboard.push([{ text: '❌ Close', callback_data: 'del_list_close' }]);

    await bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard }
    });
}

export function registerListDeletedFlow(router: CommandRouter) {
    const bot = router.bot;

    router.registerCallback(/^del_list_page_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'listDeleted');
        if (!session) return;

        const page = parseInt(query.data!.split('_').pop()!);
        session.page = page;
        setSession(chatId, 'listDeleted', session);

        await bot.deleteMessage(chatId, query.message!.message_id).catch(() => {});
        await showDeletedPage(bot, chatId, page, session.results);
    });

    router.registerCallback('del_list_close', async (query) => {
        clearSession(query.message!.chat.id, 'listDeleted');
        await bot.deleteMessage(query.message!.chat.id, query.message!.message_id).catch(() => {});
    });
}
