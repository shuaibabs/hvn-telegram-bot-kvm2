import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { getFilteredLocations, getAllUniqueLocations } from '../locationsService';
import { isAdmin, getUserProfile } from '../../../core/auth/permissions';
import { CommandRouter } from '../../../core/router/commandRouter';
import { logger } from '../../../core/logger/logger';

export async function startListLocationsFlow(bot: TelegramBot, chatId: number, username?: string) {
    const isUserAdmin = await isAdmin(username);
    const profile = await getUserProfile(username);
    if (!isUserAdmin && !profile?.displayName) {
        await bot.sendMessage(chatId, "❌ *Profile Incomplete*\n\nYour profile does not have a display name set in the system.", { parse_mode: 'Markdown' });
        return;
    }

    setSession(chatId, 'listLocations', { stage: 'SELECT_TYPE', filters: {} });

    await bot.sendMessage(chatId, "📍 *List SIM Locations*\n\nSelect Location Type Filter:", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🏬 Store', callback_data: 'loc_type_Store' }, { text: '👥 Employee', callback_data: 'loc_type_Employee' }],
                [{ text: '🤝 Dealer', callback_data: 'loc_type_Dealer' }, { text: '🌐 All Types', callback_data: 'loc_type_all' }],
                [{ text: '❌ Cancel', callback_data: 'loc_list_cancel' }]
            ]
        }
    });
}

export function registerListLocationsFlow(router: CommandRouter) {
    const bot = router.bot;

    router.registerCallback(/^loc_type_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'listLocations');
        if (!session) return;

        const type = query.data?.replace('loc_type_', '');
        session.filters.type = type;
        session.stage = 'SELECT_LOCATION';
        setSession(chatId, 'listLocations', session);

        const employeeName = await isAdmin(query.from.username) ? undefined : (await getUserProfile(query.from.username))?.displayName;
        const locations = await getAllUniqueLocations(employeeName);

        if (locations.length === 0) {
            await bot.sendMessage(chatId, "⚠️ No locations found. Listing all numbers for chosen type...");
            await performList(bot, chatId, session.filters, query.from.username);
            clearSession(chatId, 'listLocations');
            return;
        }

        const buttons: TelegramBot.InlineKeyboardButton[][] = locations.map(loc => ([{ text: String(loc), callback_data: `loc_val_${loc}` }]));
        buttons.push([{ text: '🌐 All Locations', callback_data: 'loc_val_all' }]);
        buttons.push([{ text: '❌ Cancel', callback_data: 'loc_list_cancel' }]);

        await bot.sendMessage(chatId, "📍 *Select Current Location:*", {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        });
    });

    router.registerCallback(/^loc_val_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'listLocations');
        if (!session) return;

        const location = query.data?.replace('loc_val_', '');
        session.filters.location = location;
        session.page = 0;
        setSession(chatId, 'listLocations', session);
        
        await performList(bot, chatId, session.filters, query.from.username, 0);
    });

    router.registerCallback(/^loc_list_page_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'listLocations');
        if (!session) return;

        const page = parseInt(query.data!.split('_').pop()!);
        session.page = page;
        setSession(chatId, 'listLocations', session);

        await bot.deleteMessage(chatId, query.message!.message_id).catch(() => {});
        await performList(bot, chatId, session.filters, query.from.username, page);
    });

    router.registerCallback('loc_list_close', async (query) => {
        clearSession(query.message!.chat.id, 'listLocations');
        await bot.deleteMessage(query.message!.chat.id, query.message!.message_id).catch(() => {});
    });

    router.registerCallback('loc_list_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'listLocations');
        await bot.sendMessage(query.message!.chat.id, "Operation cancelled.");
    });
}

async function performList(bot: TelegramBot, chatId: number, filters: any, username?: string, page: number = 0) {
    try {
        const isUserAdmin = await isAdmin(username);
        const profile = await getUserProfile(username);
        const employeeName = isUserAdmin ? undefined : profile?.displayName;

        const results = await getFilteredLocations(filters, employeeName);
        if (results.length === 0) {
            await bot.sendMessage(chatId, "🔍 No SIMs found matching your filters.");
        } else {
            const count = results.length;
            const PAGE_SIZE = 10;
            const totalPages = Math.ceil(count / PAGE_SIZE);
            const offset = page * PAGE_SIZE;

            let text = `📍 *SIM Locations (${count})*\n`;
            text += `Type: ${filters.type === 'all' ? 'All' : filters.type} | Location: ${filters.location === 'all' ? 'All' : filters.location}\n`;
            text += `_Page ${page + 1} of ${totalPages}_\n`;
            text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

            const displayResults = results.slice(offset, offset + PAGE_SIZE);
            displayResults.forEach((num: any, i: number) => {
                text += `${offset + i + 1}. \`${num.mobile}\` | ${num.currentLocation} (${num.locationType})\n`;
            });

            text += `\n━━━━━━━━━━━━━━━━━━━━`;

            const inline_keyboard: TelegramBot.InlineKeyboardButton[][] = [];
            const navButtons: TelegramBot.InlineKeyboardButton[] = [];

            if (page > 0) navButtons.push({ text: '⬅️ Back', callback_data: `loc_list_page_${page - 1}` });
            if (offset + PAGE_SIZE < count) navButtons.push({ text: 'Next ➡️', callback_data: `loc_list_page_${page + 1}` });

            if (navButtons.length > 0) inline_keyboard.push(navButtons);
            inline_keyboard.push([{ text: '❌ Close', callback_data: 'loc_list_close' }]);

            await bot.sendMessage(chatId, text, { 
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard }
            });
        }
    } catch (error: any) {
        logger.error(`Error in performListLocations: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}
