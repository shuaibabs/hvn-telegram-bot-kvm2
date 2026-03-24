import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { checkInNumber, updateLocation } from '../locationsService';
import { isAdmin, getUserProfile } from '../../../core/auth/permissions';
import { CommandRouter } from '../../../core/router/commandRouter';
import { logger } from '../../../core/logger/logger';
import { logActivity } from '../../activities/activityService';

export async function startEditLocationFlow(bot: TelegramBot, chatId: number, username?: string) {
    const isUserAdmin = await isAdmin(username);
    const profile = await getUserProfile(username);
    if (!isUserAdmin && !profile?.displayName) {
        await bot.sendMessage(chatId, "❌ *Profile Incomplete*\n\nYour profile does not have a display name set in the system.", { parse_mode: 'Markdown' });
        return;
    }

    setSession(chatId, 'editLocation', { stage: 'AWAIT_MOBILE' });

    await bot.sendMessage(chatId, "✏️ *CheckIn / Edit Location*\n\nPlease enter the 10-digit mobile number:", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'loc_edit_cancel' }]]
        }
    });
}

export function registerEditLocationFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'editLocation');
        if (!session || !msg.text || msg.text.startsWith('/')) return;

        const chatId = msg.chat.id;
        const text = msg.text.trim();

        if (session.stage === 'AWAIT_MOBILE') {
            if (!/^\d{10}$/.test(text)) {
                await bot.sendMessage(chatId, "❌ Invalid mobile number. Please enter 10 digits.");
                return;
            }
            session.mobile = text;
            session.stage = 'SELECT_ACTION';
            setSession(chatId, 'editLocation', session);

            await bot.sendMessage(chatId, `📱 *Number:* \`${text}\`\n\nChoose an action:`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Check In', callback_data: 'loc_act_checkin' }],
                        [{ text: '✏️ Edit Location', callback_data: 'loc_act_edit' }],
                        [{ text: '❌ Cancel', callback_data: 'loc_edit_cancel' }]
                    ]
                }
            });
        } else if (session.stage === 'AWAIT_NEW_LOC') {
            session.newLoc = text;
            session.stage = 'SELECT_NEW_TYPE';
            setSession(chatId, 'editLocation', session);

            await bot.sendMessage(chatId, `📍 *New Location:* ${text}\n\nSelect New Location Type:`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🏬 Store', callback_data: 'loc_new_type_Store' }, { text: '👥 Employee', callback_data: 'loc_new_type_Employee' }],
                        [{ text: '🤝 Dealer', callback_data: 'loc_new_type_Dealer' }],
                        [{ text: '❌ Cancel', callback_data: 'loc_edit_cancel' }]
                    ]
                }
            });
        }
    });

    router.registerCallback(/^loc_act_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'editLocation');
        if (!session) return;

        const action = query.data?.replace('loc_act_', '');
        if (action === 'checkin') {
            try {
                const profile = await getUserProfile(query.from.username);
                const isUserAdmin = await isAdmin(query.from.username);
                const employeeName = isUserAdmin ? undefined : profile?.displayName;
                const performer = profile?.displayName || query.from.username || 'Unknown';

                const result = await checkInNumber(session.mobile, performer, employeeName);
                if (result) {
                    await bot.sendMessage(chatId, `✅ *Success!*\n\nSIM number \`${session.mobile}\` has been checked in successfully.`, { parse_mode: 'Markdown' });
                    
                    // Log Activity
                    await logActivity(bot, {
                        employeeName: performer,
                        action: 'SIM_CHECKIN',
                        description: `Checked in SIM number ${session.mobile}`,
                        createdBy: performer,
                        source: 'BOT',
                        groupName: 'SIM_LOCATIONS'
                    }, true);
                } else {
                    await bot.sendMessage(chatId, `❌ Number \`${session.mobile}\` not found or not assigned to you.`, { parse_mode: 'Markdown' });
                }
            } catch (error: any) {
                await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
            clearSession(chatId, 'editLocation');
        } else {
            session.stage = 'AWAIT_NEW_LOC';
            setSession(chatId, 'editLocation', session);
            await bot.sendMessage(chatId, "📍 Enter the *New Current Location* (e.g. Mumbai Store):", { parse_mode: 'Markdown' });
        }
    });

    router.registerCallback(/^loc_new_type_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'editLocation');
        if (!session) return;

        const type = query.data?.replace('loc_new_type_', '');
        try {
            const profile = await getUserProfile(query.from.username);
            const isUserAdmin = await isAdmin(query.from.username);
            const employeeName = isUserAdmin ? undefined : profile?.displayName;
            const performer = profile?.displayName || query.from.username || 'Unknown';

            const result = await updateLocation(session.mobile, { locationType: type!, currentLocation: session.newLoc }, performer, employeeName);
            if (result) {
                await bot.sendMessage(chatId, `✅ *Location Updated!*\n\nSIM \`${session.mobile}\` is now at *${session.newLoc}* (${type}).`, { parse_mode: 'Markdown' });
                
                // Log Activity
                await logActivity(bot, {
                    employeeName: performer,
                    action: 'UPDATE_SIM_LOCATION',
                    description: `Updated location for SIM ${session.mobile} to ${session.newLoc} (${type})`,
                    createdBy: performer,
                    source: 'BOT',
                    groupName: 'SIM_LOCATIONS'
                }, true);
            } else {
                await bot.sendMessage(chatId, `❌ Number \`${session.mobile}\` not found or not assigned to you.`, { parse_mode: 'Markdown' });
            }
        } catch (error: any) {
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
        clearSession(chatId, 'editLocation');
    });

    router.registerCallback('loc_edit_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'editLocation');
        await bot.sendMessage(query.message!.chat.id, "Operation cancelled.");
    });
}
