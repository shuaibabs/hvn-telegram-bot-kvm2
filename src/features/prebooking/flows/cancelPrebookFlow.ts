import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { getPrebookingDetails, cancelPrebooking } from '../prebookingService';
import { CommandRouter } from '../../../core/router/commandRouter';
import { getUserProfile, isAdmin } from '../../../core/auth/permissions';
import { logActivity } from '../../activities/activityService';

export async function startCancelPrebookFlow(bot: TelegramBot, chatId: number, username?: string) {
    setSession(chatId, 'cancelPrebook', { stage: 'AWAIT_MOBILE' });
    await bot.sendMessage(chatId, "❌ *Cancel Pre-booking*\n\nPlease enter the mobile number of the pre-booking you want to cancel:", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'pb_cancel_cancel_op' }]]
        }
    });
}

export function registerCancelPrebookFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'cancelPrebook');
        if (!session || !msg.text || msg.text.startsWith('/')) return;

        const chatId = msg.chat.id;

        if (session.stage === 'AWAIT_MOBILE') {
            const mobile = msg.text.trim();
            if (!/^\d{10}$/.test(mobile)) {
                await bot.sendMessage(chatId, "❌ Invalid mobile number. Please enter a 10-digit number.");
                return;
            }

            try {
                const isUserAdmin = await isAdmin(msg.from?.username);
                const profile = await getUserProfile(msg.from?.username);

                if (!isUserAdmin && !profile?.displayName) {
                    await bot.sendMessage(chatId, "❌ *Profile Incomplete*\n\nYour profile does not have a display name set in the system. Please contact an administrator.", { parse_mode: 'Markdown' });
                    clearSession(chatId, 'cancelPrebook');
                    return;
                }

                const employeeName = isUserAdmin ? undefined : profile?.displayName;

                const pb = await getPrebookingDetails(mobile, employeeName);

                if (!pb) {
                    await bot.sendMessage(chatId, `❌ No pre-booking record found for \`${mobile}\`${employeeName ? ` assigned to ${employeeName}` : ""}.`, { parse_mode: 'Markdown' });
                    clearSession(chatId, 'cancelPrebook');
                    return;
                }

                session.stage = 'CONFIRM_CANCEL';
                session.prebookId = pb.id;
                session.mobile = mobile;
                setSession(chatId, 'cancelPrebook', session);

                await bot.sendMessage(chatId, `⚠️ *Confirm Cancellation*\n\nAre you sure you want to cancel the pre-booking for \`${mobile}\`?\n\nThe number will be moved back to Inventory.`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '✅ Yes, Cancel Pre-booking', callback_data: 'pb_cancel_confirm' }],
                            [{ text: '❌ No', callback_data: 'pb_cancel_cancel_op' }]
                        ]
                    }
                });
            } catch (error: any) {
                logger.error(`Error in cancelPrebookFlow: ${error.message}`);
                await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
                clearSession(chatId, 'cancelPrebook');
            }
        }
    });

    router.registerCallback('pb_cancel_confirm', async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'cancelPrebook');
        if (!session || session.stage !== 'CONFIRM_CANCEL') return;

        try {
            const profile = await getUserProfile(query.from.username);
            const performedBy = profile?.displayName || query.from.username || 'Unknown';

            const success = await cancelPrebooking(session.prebookId, performedBy);

            if (success) {
                await bot.sendMessage(chatId, `✅ Pre-booking for \`${session.mobile}\` has been cancelled and moved back to inventory.`, { parse_mode: 'Markdown' });
                
                // Log Activity
                await logActivity(bot, {
                    employeeName: performedBy,
                    action: 'CANCEL_PREBOOKING',
                    description: `Cancelled pre-booking for number ${session.mobile} and moved it back to inventory.`,
                    createdBy: performedBy,
                    source: 'BOT',
                    groupName: 'PREBOOKING'
                }, true);
            } else {
                await bot.sendMessage(chatId, `❌ Failed to cancel pre-booking. It may have already been removed.`);
            }
        } catch (error: any) {
            logger.error(`Error in cancelPrebook confirmation: ${error.message}`);
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        } finally {
            clearSession(chatId, 'cancelPrebook');
        }
    });

    router.registerCallback('pb_cancel_cancel_op', async (query) => {
        clearSession(query.message!.chat.id, 'cancelPrebook');
        await bot.sendMessage(query.message!.chat.id, "Operation cancelled.");
    });
}
