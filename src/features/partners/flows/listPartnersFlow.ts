import TelegramBot from 'node-telegram-bot-api';
import { CommandRouter } from '../../../core/router/commandRouter';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { getPartnershipNumbers } from '../partnersService';
import { getUserProfile, isAdmin } from '../../../core/auth/permissions';
import { logger } from '../../../core/logger/logger';

export async function startListPartnersFlow(bot: TelegramBot, chatId: number, username?: string) {
    try {
        const isUserAdmin = await isAdmin(username);
        const profile = await getUserProfile(username);
        
        if (!isUserAdmin && !profile?.displayName) {
            await bot.sendMessage(chatId, "❌ *Profile Incomplete*\n\nYour profile does not have a display name set in the system. Please contact an administrator.", { parse_mode: 'Markdown' });
            return;
        }

        const employeeName = isUserAdmin ? undefined : profile?.displayName;
        const results = await getPartnershipNumbers(employeeName);

        if (results.length === 0) {
            await bot.sendMessage(chatId, "📋 No partnership records found" + (employeeName ? ` for ${employeeName}` : "") + ".");
            return;
        }

        setSession(chatId, 'listPartners', { results, page: 0, employeeName });
        await showPartnersPage(bot, chatId, 0, results);
    } catch (error: any) {
        logger.error(`Error in listPartnersFlow: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}

async function showPartnersPage(bot: TelegramBot, chatId: number, page: number, results: any[]) {
    const PAGE_SIZE = 10;
    const count = results.length;
    const totalPages = Math.ceil(count / PAGE_SIZE);
    const offset = page * PAGE_SIZE;

    let text = `🤝 *Partnership Records (${count})*\n`;
    text += `_Page ${page + 1} of ${totalPages}_\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    const list = results.slice(offset, offset + PAGE_SIZE);
    list.forEach((num, i) => {
        text += `${offset + i + 1}. \`${num.mobile}\` | ${num.status}\n`;
        if (num.partnerName) text += `   └ Partner: ${num.partnerName}\n`;
        text += `   └ Assigned: ${num.assignedTo}\n\n`;
    });

    text += `━━━━━━━━━━━━━━━━━━━━`;

    const inline_keyboard: TelegramBot.InlineKeyboardButton[][] = [];
    const navButtons: TelegramBot.InlineKeyboardButton[] = [];

    if (page > 0) navButtons.push({ text: '⬅️ Back', callback_data: `part_list_page_${page - 1}` });
    if (offset + PAGE_SIZE < count) navButtons.push({ text: 'Next ➡️', callback_data: `part_list_page_${page + 1}` });

    if (navButtons.length > 0) inline_keyboard.push(navButtons);
    inline_keyboard.push([{ text: '❌ Close', callback_data: 'part_list_close' }]);

    await bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard }
    });
}

export function registerListPartnersFlow(router: CommandRouter) {
    const bot = router.bot;

    router.registerCallback(/^part_list_page_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'listPartners');
        if (!session) return;

        const page = parseInt(query.data!.split('_').pop()!);
        session.page = page;
        setSession(chatId, 'listPartners', session);

        await bot.deleteMessage(chatId, query.message!.message_id).catch(() => {});
        await showPartnersPage(bot, chatId, page, session.results);
    });

    router.registerCallback('part_list_close', async (query) => {
        clearSession(query.message!.chat.id, 'listPartners');
        await bot.deleteMessage(query.message!.chat.id, query.message!.message_id).catch(() => {});
    });
}
