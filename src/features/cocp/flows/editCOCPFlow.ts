import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { getCOCPDetails, updateCOCPDetails } from '../cocpService';
import { CommandRouter } from '../../../core/router/commandRouter';
import { getUserProfile, isAdmin } from '../../../core/auth/permissions';
import { formatToDDMMYYYY, parseFromDDMMYYYY } from '../../../shared/utils/dateUtils';
import { logActivity } from '../../activities/activityService';

const EDIT_STAGES = {
    AWAIT_MOBILE: 'AWAIT_MOBILE',
    AWAIT_CHOICE: 'AWAIT_CHOICE',
    AWAIT_DATE: 'AWAIT_DATE',
    SAVING: 'SAVING'
} as const;

type EditSession = {
    chatId: number;
    stage: keyof typeof EDIT_STAGES;
    mobiles?: string[];
    editField?: 'safeCustodyDate' | 'unsafeCustodyDate';
};

const cancelBtn = { text: '❌ Cancel', callback_data: 'cocp_edit_cancel' };

export async function startEditCOCPFlow(bot: TelegramBot, chatId: number, username?: string) {
    const isUserAdmin = await isAdmin(username);
    const profile = await getUserProfile(username);
    if (!isUserAdmin && !profile?.displayName) {
        await bot.sendMessage(chatId, "❌ *Profile Incomplete*\n\nYour profile does not have a display name set in the system. Please contact an administrator.", { parse_mode: 'Markdown' });
        return;
    }

    setSession(chatId, 'cocpEdit', { stage: 'AWAIT_MOBILE', chatId });
    await bot.sendMessage(chatId, "✏️ *Edit COCP Dates*\n\nPlease enter one or more 10-digit mobile numbers separated by comma or new line:", {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[cancelBtn]] }
    });
}

export function registerEditCOCPFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'cocpEdit') as EditSession | undefined;
        if (!session || !msg.text || msg.text.startsWith('/')) return;

        const chatId = msg.chat.id;
        const text = msg.text.trim();

        if (session.stage === 'AWAIT_MOBILE') {
            const numbers = text.split(/[\n,]+/).map(n => n.trim().replace(/\D/g, '')).filter(n => n.length === 10);

            if (numbers.length === 0) {
                await bot.sendMessage(chatId, "❌ No valid 10-digit numbers found. Please try again.");
                return;
            }

            try {
                const isUserAdmin = await isAdmin(msg.from?.username);
                const profile = await getUserProfile(msg.from?.username);
                const employeeName = isUserAdmin ? undefined : profile?.displayName;

                const validMobiles: string[] = [];
                const invalidMobiles: string[] = [];

                for (const num of numbers) {
                    const cocpNum = await getCOCPDetails(num, employeeName);
                    if (cocpNum) {
                        validMobiles.push(num);
                    } else {
                        invalidMobiles.push(num);
                    }
                }

                if (validMobiles.length === 0) {
                    await bot.sendMessage(chatId, `❌ No COCP records found for the provided numbers${employeeName ? ` assigned to ${employeeName}` : ""}.\n\nNumbers tried: ${numbers.join(', ')}`, { parse_mode: 'Markdown' });
                    clearSession(chatId, 'cocpEdit');
                    return;
                }

                session.mobiles = validMobiles;
                session.stage = 'AWAIT_CHOICE';
                setSession(chatId, 'cocpEdit', session);

                let responseMsg = `🏢 *Numbers Found:* \`${validMobiles.length}\`\n`;
                if (invalidMobiles.length > 0) {
                    responseMsg += `⚠️ *Skipped (not COCP):* \`${invalidMobiles.join(', ')}\`\n`;
                }
                responseMsg += `\nWhich date would you like to edit?`;

                await bot.sendMessage(chatId, responseMsg, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🛡️ Safe Custody', callback_data: 'cocp_edit_field_safe' },
                                { text: '⚠️ Unsafe Custody', callback_data: 'cocp_edit_field_unsafe' }
                            ],
                            [cancelBtn]
                        ]
                    }
                });
            } catch (error: any) {
                logger.error(`Error in editCOCPFlow (Mobile): ${error.message}`);
                await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
                clearSession(chatId, 'cocpEdit');
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

            // Lock session to prevent duplicate saves
            session.stage = 'SAVING';
            setSession(chatId, 'cocpEdit', session);

            try {
                const creator = msg.from?.first_name + (msg.from?.last_name ? ' ' + msg.from?.last_name : '');

                let successCount = 0;
                for (const mobile of session.mobiles!) {
                    await updateCOCPDetails(mobile, { [session.editField!]: parsedDate }, creator);
                    successCount++;
                }

                const fieldName = session.editField === 'safeCustodyDate' ? 'Safe Custody Date' : 'Unsafe Custody Date';
                await bot.sendMessage(chatId, `✅ *Updated!*\n\n${fieldName} for ${successCount} number(s) has been set to ${dateStr}.`, { parse_mode: 'Markdown' });

                // Log Activity
                const action = session.editField === 'safeCustodyDate' ? 'UPDATE_COCP_SAFE_CUSTODY' : 'UPDATE_COCP_UNSAFE_CUSTODY';
                await logActivity(bot, {
                    employeeName: creator,
                    action: action,
                    description: `Updated ${fieldName} for ${session.mobiles!.join(', ')} to ${dateStr}.`,
                    createdBy: creator,
                    source: 'BOT',
                    groupName: 'COCP'
                }, true);

                clearSession(chatId, 'cocpEdit');
            } catch (error: any) {
                await bot.sendMessage(chatId, `❌ Error updating date: ${error.message}`);
            }
        }
    });

    router.registerCallback(/^cocp_edit_field_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'cocpEdit') as EditSession | undefined;
        if (!session || session.stage !== 'AWAIT_CHOICE') return;

        const field = query.data?.split('_').pop();
        session.editField = field === 'safe' ? 'safeCustodyDate' : 'unsafeCustodyDate';
        session.stage = 'AWAIT_DATE';
        setSession(chatId, 'cocpEdit', session);

        const fieldName = field === 'safe' ? 'Safe Custody Date' : 'Unsafe Custody Date';
        const today = formatToDDMMYYYY(new Date());

        await bot.sendMessage(chatId, `Please enter the new *${fieldName}* (DD/MM/YYYY):\n(Type 'today' for ${today})`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `📅 Today (${today})`, callback_data: 'cocp_edit_date_today' }],
                    [cancelBtn]
                ]
            }
        });
    });

    router.registerCallback('cocp_edit_date_today', async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'cocpEdit') as EditSession | undefined;
        if (!session || session.stage !== 'AWAIT_DATE') return;

        // Lock session
        session.stage = 'SAVING';
        setSession(chatId, 'cocpEdit', session);

        // Remove buttons
        try {
            await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                chat_id: chatId,
                message_id: query.message!.message_id
            });
        } catch (e) {
            logger.warn('Failed to remove buttons in editCOCP (today): ' + (e as Error).message);
        }

        try {
            const today = new Date();
            const dateStr = formatToDDMMYYYY(today);
            const creator = query.from.first_name + (query.from.last_name ? ' ' + query.from.last_name : '');

            let successCount = 0;
            for (const mobile of session.mobiles!) {
                await updateCOCPDetails(mobile, { [session.editField!]: today }, creator);
                successCount++;
            }

            const fieldName = session.editField === 'safeCustodyDate' ? 'Safe Custody Date' : 'Unsafe Custody Date';
            await bot.sendMessage(chatId, `✅ *Updated!*\n\n${fieldName} for ${successCount} number(s) has been set to ${dateStr}.`, { parse_mode: 'Markdown' });

            // Log Activity
            const action = session.editField === 'safeCustodyDate' ? 'UPDATE_COCP_SAFE_CUSTODY' : 'UPDATE_COCP_UNSAFE_CUSTODY';
            await logActivity(bot, {
                employeeName: creator,
                action: action,
                description: `Updated ${fieldName} for ${session.mobiles!.join(', ')} to ${dateStr}.`,
                createdBy: creator,
                source: 'BOT',
                groupName: 'COCP'
            }, true);

            clearSession(chatId, 'cocpEdit');
        } catch (error: any) {
            await bot.sendMessage(chatId, `❌ Error updating date: ${error.message}`);
            clearSession(chatId, 'cocpEdit');
        }
    });

    router.registerCallback('cocp_edit_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'cocpEdit');
        await bot.sendMessage(query.message!.chat.id, "Operation cancelled.");
    });
}
