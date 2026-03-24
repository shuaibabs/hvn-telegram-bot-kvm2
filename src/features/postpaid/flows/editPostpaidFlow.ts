import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { getPostpaidDetails, updatePostpaidDetails } from '../postpaidService';
import { CommandRouter } from '../../../core/router/commandRouter';
import { getUserProfile, isAdmin } from '../../../core/auth/permissions';
import { formatToDDMMYYYY, parseFromDDMMYYYY } from '../../../shared/utils/dateUtils';
import { logActivity } from '../../activities/activityService';

const EDIT_STAGES = {
    AWAIT_MOBILE: 'AWAIT_MOBILE',
    SELECT_FIELD: 'SELECT_FIELD',
    AWAIT_DATE: 'AWAIT_DATE',
    AWAIT_PD_BILL: 'AWAIT_PD_BILL'
} as const;

type EditSession = {
    chatId: number;
    stage: keyof typeof EDIT_STAGES;
    mobile?: string;
};

const cancelBtn = { text: '❌ Cancel', callback_data: 'postpaid_edit_cancel' };

export async function startEditPostpaidFlow(bot: TelegramBot, chatId: number, username?: string) {
    const isUserAdmin = await isAdmin(username);
    const profile = await getUserProfile(username);
    if (!isUserAdmin && !profile?.displayName) {
        await bot.sendMessage(chatId, "❌ *Profile Incomplete*\n\nYour profile does not have a display name set in the system. Please contact an administrator.", { parse_mode: 'Markdown' });
        return;
    }

    setSession(chatId, 'postpaidEdit', { stage: 'AWAIT_MOBILE', chatId });
    await bot.sendMessage(chatId, "✏️ *Edit Postpaid Details*\n\nPlease enter the 10-digit mobile number you want to edit:", {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[cancelBtn]] }
    });
}

export function registerEditPostpaidFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'postpaidEdit') as EditSession | undefined;
        if (!session || !msg.text || msg.text.startsWith('/')) return;

        const chatId = msg.chat.id;
        const text = msg.text.trim();

        if (session.stage === 'AWAIT_MOBILE') {
            if (!/^\d{10}$/.test(text)) {
                await bot.sendMessage(chatId, "❌ Invalid mobile number. Please enter a 10-digit number.");
                return;
            }

            try {
                const isUserAdmin = await isAdmin(msg.from?.username);
                const profile = await getUserProfile(msg.from?.username);
                const employeeName = isUserAdmin ? undefined : profile?.displayName;

                const num = await getPostpaidDetails(text, employeeName);
                if (!num) {
                    await bot.sendMessage(chatId, `❌ No postpaid record found for \`${text}\`${employeeName ? ` assigned to ${employeeName}` : ""}.`, { parse_mode: 'Markdown' });
                    clearSession(chatId, 'postpaidEdit');
                    return;
                }

                session.mobile = text;
                session.stage = 'SELECT_FIELD';
                setSession(chatId, 'postpaidEdit', session);

                await bot.sendMessage(chatId, `📱 *Selected:* \`${text}\`\n\nWhat would you like to update?`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📅 Bill Date', callback_data: 'postpaid_edit_field_date' }],
                            [{ text: '✅ PD Bill Status', callback_data: 'postpaid_edit_field_pd' }],
                            [cancelBtn]
                        ]
                    }
                });
            } catch (error: any) {
                logger.error(`Error in editPostpaidFlow (Mobile): ${error.message}`);
                await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
                clearSession(chatId, 'postpaidEdit');
            }
        } else if (session.stage === 'AWAIT_DATE') {
            let dateStr = text.toLowerCase();
            let parsedDate: Date | null;

            if (dateStr === 'today') {
                parsedDate = new Date();
                dateStr = formatToDDMMYYYY(parsedDate);
            } else {
                parsedDate = parseFromDDMMYYYY(text);
                dateStr = text;
            }

            if (!parsedDate) {
                await bot.sendMessage(chatId, "❌ Invalid date format. Please use *DD/MM/YYYY* (e.g. 25/12/2024).", { parse_mode: 'Markdown' });
                return;
            }

            try {
                const creator = msg.from?.first_name + (msg.from?.last_name ? ' ' + msg.from?.last_name : '');
                await updatePostpaidDetails(session.mobile!, { billDate: parsedDate }, creator);
 
                await bot.sendMessage(chatId, `✅ *Updated!*\n\nBill Date for \`${session.mobile}\` has been set to ${dateStr}.`, { parse_mode: 'Markdown' });
                
                // Log Activity
                await logActivity(bot, {
                    employeeName: creator,
                    action: 'UPDATE_POSTPAID_BILL_DATE',
                    description: `Updated bill date for ${session.mobile} to ${dateStr}.`,
                    createdBy: creator,
                    source: 'BOT',
                    groupName: 'POSTPAID_NUMBERS'
                }, true);
                
                clearSession(chatId, 'postpaidEdit');
            } catch (error: any) {
                await bot.sendMessage(chatId, `❌ Error updating date: ${error.message}`);
            }
        }
    });

    router.registerCallback(/^postpaid_edit_field_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'postpaidEdit') as EditSession | undefined;
        if (!session || session.stage !== 'SELECT_FIELD') return;

        const field = query.data?.split('_').pop();

        if (field === 'date') {
            session.stage = 'AWAIT_DATE';
            setSession(chatId, 'postpaidEdit', session);
            const today = formatToDDMMYYYY(new Date());
            await bot.sendMessage(chatId, `📅 *Enter Bill Date*\n\nPlease enter the date in *DD/MM/YYYY* format:\n(Type 'today' for ${today})`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `📅 Today (${today})`, callback_data: 'postpaid_edit_date_today' }],
                        [cancelBtn]
                    ]
                }
            });
        } else if (field === 'pd') {
            session.stage = 'AWAIT_PD_BILL';
            setSession(chatId, 'postpaidEdit', session);
            await bot.sendMessage(chatId, "✅ *PD Bill Status*\n\nIs the PD Bill status Yes or No?", {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Yes', callback_data: 'postpaid_edit_pd_val_Yes' }],
                        [{ text: '❌ No', callback_data: 'postpaid_edit_pd_val_No' }],
                        [cancelBtn]
                    ]
                }
            });
        }
    });
 
    router.registerCallback('postpaid_edit_date_today', async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'postpaidEdit') as EditSession | undefined;
        if (!session || session.stage !== 'AWAIT_DATE') return;

        try {
            const today = new Date();
            const dateStr = formatToDDMMYYYY(today);
            const creator = query.from.first_name + (query.from.last_name ? ' ' + query.from.last_name : '');
            
            await updatePostpaidDetails(session.mobile!, { billDate: today }, creator);
            await bot.sendMessage(chatId, `✅ *Updated!*\n\nBill Date for \`${session.mobile}\` has been set to ${dateStr}.`, { parse_mode: 'Markdown' });

            // Log Activity
            await logActivity(bot, {
                employeeName: creator,
                action: 'UPDATE_POSTPAID_BILL_DATE',
                description: `Updated bill date for ${session.mobile} to ${dateStr}.`,
                createdBy: creator,
                source: 'BOT',
                groupName: 'POSTPAID_NUMBERS'
            }, true);

            clearSession(chatId, 'postpaidEdit');
        } catch (error: any) {
            await bot.sendMessage(chatId, `❌ Error updating date: ${error.message}`);
            clearSession(chatId, 'postpaidEdit');
        }
    });

    router.registerCallback(/^postpaid_edit_pd_val_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'postpaidEdit') as EditSession | undefined;
        if (!session || session.stage !== 'AWAIT_PD_BILL') return;

        const val = query.data?.split('_').pop() as 'Yes' | 'No';

        try {
            const creator = query.from.first_name + (query.from.last_name ? ' ' + query.from.last_name : '');
            await updatePostpaidDetails(session.mobile!, { pdBill: val }, creator);
 
            await bot.sendMessage(chatId, `✅ *Updated!*\n\nPD Bill status for \`${session.mobile}\` has been set to *${val}*.`, { parse_mode: 'Markdown' });
            
            // Log Activity
            await logActivity(bot, {
                employeeName: creator,
                action: 'UPDATE_POSTPAID_PD_BILL',
                description: `Updated PD Bill status for ${session.mobile} to ${val}.`,
                createdBy: creator,
                source: 'BOT',
                groupName: 'POSTPAID_NUMBERS'
            }, true);
            
            clearSession(chatId, 'postpaidEdit');
        } catch (error: any) {
            await bot.sendMessage(chatId, `❌ Error updating PD Bill: ${error.message}`);
            clearSession(chatId, 'postpaidEdit');
        }
    });

    router.registerCallback('postpaid_edit_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'postpaidEdit');
        await bot.sendMessage(query.message!.chat.id, "Edit operation cancelled.");
    });
}
