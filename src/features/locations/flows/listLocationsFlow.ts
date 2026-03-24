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
        
        await performList(bot, chatId, session.filters, query.from.username);
        clearSession(chatId, 'listLocations');
    });

    router.registerCallback('loc_list_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'listLocations');
        await bot.sendMessage(query.message!.chat.id, "Operation cancelled.");
    });
}

async function performList(bot: TelegramBot, chatId: number, filters: any, username?: string) {
    try {
        const isUserAdmin = await isAdmin(username);
        const profile = await getUserProfile(username);
        const employeeName = isUserAdmin ? undefined : profile?.displayName;

        const results = await getFilteredLocations(filters, employeeName);
        if (results.length === 0) {
            await bot.sendMessage(chatId, "🔍 No SIMs found matching your filters.");
        } else {
            const count = results.length;
            let text = `📍 *SIM Locations (${count})*\n`;
            text += `Type: ${filters.type === 'all' ? 'All' : filters.type} | Location: ${filters.location === 'all' ? 'All' : filters.location}\n`;
            text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

            results.slice(0, 15).forEach((num: any, i: number) => {
                text += `${i + 1}. \`${num.mobile}\` | ${num.currentLocation} (${num.locationType})\n`;
            });

            if (count > 15) text += `\n...and ${count - 15} more.`;
            text += `\n━━━━━━━━━━━━━━━━━━━━`;

            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        }
    } catch (error: any) {
        logger.error(`Error in performListLocations: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}
