import TelegramBot from 'node-telegram-bot-api';
import { CommandRouter } from '../../../core/router/commandRouter';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { getPrebookingNumbers } from '../prebookingService';
import { getUserProfile, isAdmin } from '../../../core/auth/permissions';
import { logger } from '../../../core/logger/logger';
import { formatToDDMMYYYY } from '../../../shared/utils/dateUtils';

export async function startListPrebookFlow(bot: TelegramBot, chatId: number, username?: string) {
    try {
        const isUserAdmin = await isAdmin(username);
        const profile = await getUserProfile(username);
        
        if (!isUserAdmin && !profile?.displayName) {
            await bot.sendMessage(chatId, "❌ *Profile Incomplete*\n\nYour profile does not have a display name set in the system. Please contact an administrator.", { parse_mode: 'Markdown' });
            return;
        }

        const employeeName = isUserAdmin ? undefined : profile?.displayName;
        const results = await getPrebookingNumbers(employeeName);

        if (results.length === 0) {
            await bot.sendMessage(chatId, "📋 No pre-booking records found" + (employeeName ? ` for ${employeeName}` : "") + ".");
            return;
        }

        setSession(chatId, 'listPrebook', { results, page: 0, employeeName });
        await showPrebookPage(bot, chatId, 0, results);
    } catch (error: any) {
        logger.error(`Error in listPrebookFlow: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}

async function showPrebookPage(bot: TelegramBot, chatId: number, page: number, results: any[]) {
    const PAGE_SIZE = 10;
    const count = results.length;
    const totalPages = Math.ceil(count / PAGE_SIZE);
    const offset = page * PAGE_SIZE;

    let text = `📋 *Pre-booking Records (${count})*\n`;
    text += `_Page ${page + 1} of ${totalPages}_\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    const list = results.slice(offset, offset + PAGE_SIZE);
    list.forEach((pb, i) => {
        text += `${offset + i + 1}. \`${pb.mobile}\` | ${formatToDDMMYYYY(pb.preBookingDate)}\n`;
        text += `   └ Type: ${pb.originalNumberData.numberType}\n\n`;
    });

    text += `━━━━━━━━━━━━━━━━━━━━`;

    const inline_keyboard: TelegramBot.InlineKeyboardButton[][] = [];
    const navButtons: TelegramBot.InlineKeyboardButton[] = [];

    if (page > 0) navButtons.push({ text: '⬅️ Back', callback_data: `pre_list_page_${page - 1}` });
    if (offset + PAGE_SIZE < count) navButtons.push({ text: 'Next ➡️', callback_data: `pre_list_page_${page + 1}` });

    if (navButtons.length > 0) inline_keyboard.push(navButtons);
    inline_keyboard.push([{ text: '❌ Close', callback_data: 'pre_list_close' }]);

    await bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard }
    });
}

export function registerListPrebookFlow(router: CommandRouter) {
    const bot = router.bot;

    router.registerCallback(/^pre_list_page_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'listPrebook');
        if (!session) return;

        const page = parseInt(query.data!.split('_').pop()!);
        session.page = page;
        setSession(chatId, 'listPrebook', session);

        await bot.deleteMessage(chatId, query.message!.message_id).catch(() => {});
        await showPrebookPage(bot, chatId, page, session.results);
    });

    router.registerCallback('pre_list_close', async (query) => {
        clearSession(query.message!.chat.id, 'listPrebook');
        await bot.deleteMessage(query.message!.chat.id, query.message!.message_id).catch(() => {});
    });
}
