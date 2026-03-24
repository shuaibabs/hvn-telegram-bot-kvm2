import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { getDeletedNumberByMobile } from '../deletedService';
import { isAdmin, getUserProfile } from '../../../core/auth/permissions';
import { CommandRouter } from '../../../core/router/commandRouter';
import { logger } from '../../../core/logger/logger';
import { format } from 'date-fns';

export async function startDetailsDeletedFlow(bot: TelegramBot, chatId: number, username?: string) {
    const isUserAdmin = await isAdmin(username);
    const profile = await getUserProfile(username);
    if (!isUserAdmin && !profile?.displayName) {
        await bot.sendMessage(chatId, "❌ *Profile Incomplete*\n\nYour profile does not have a display name set in the system.", { parse_mode: 'Markdown' });
        return;
    }

    setSession(chatId, 'detailsDeleted', { stage: 'AWAIT_MOBILE' });

    await bot.sendMessage(chatId, "🔍 *Deleted Number Details*\n\nPlease enter the 10-digit mobile number:", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'deleted_details_cancel' }]]
        }
    });
}

export function registerDetailsDeletedFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'detailsDeleted');
        if (!session || !msg.text || msg.text.startsWith('/')) return;

        const chatId = msg.chat.id;
        const text = msg.text.trim();

        if (session.stage === 'AWAIT_MOBILE') {
            if (!/^\d{10}$/.test(text)) {
                await bot.sendMessage(chatId, "❌ Invalid mobile number. Please enter 10 digits.");
                return;
            }

            try {
                const profile = await getUserProfile(msg.from?.username);
                const isUserAdmin = await isAdmin(msg.from?.username);
                const employeeName = isUserAdmin ? undefined : profile?.displayName;

                const result = await getDeletedNumberByMobile(text, employeeName);
                if (result) {
                    let textMsg = `📋 *Deleted SIM Details:*\n`;
                    textMsg += `━━━━━━━━━━━━━━━━━━━━\n`;
                    textMsg += `📱 *Mobile:* \`${result.mobile}\`\n`;
                    textMsg += `🗑️ *Deleted By:* ${result.deletedBy}\n`;
                    textMsg += `🕒 *Deleted At:* ${format(result.deletedAt.toDate(), 'PPP p')}\n`;
                    textMsg += `📝 *Reason:* ${result.deletionReason}\n`;
                    textMsg += `━━━━━━━━━━━━━━━━━━━━\n`;
                    textMsg += `📜 *Original Info:*\n`;
                    textMsg += `👤 *Assigned To:* ${result.originalNumberData.assignedTo || 'Unassigned'}\n`;
                    textMsg += `📍 *Last Location:* ${result.originalNumberData.currentLocation} (${result.originalNumberData.locationType})\n`;
                    textMsg += `━━━━━━━━━━━━━━━━━━━━`;

                    await bot.sendMessage(chatId, textMsg, { parse_mode: 'Markdown' });
                } else {
                    const errorMsg = isUserAdmin 
                        ? `❌ Number \`${text}\` not found in deleted numbers.`
                        : `❌ Number \`${text}\` not found or not assigned to you previously.`;
                    await bot.sendMessage(chatId, errorMsg, { parse_mode: 'Markdown' });
                }
            } catch (error: any) {
                logger.error(`Error in detailsDeletedFlow: ${error.message}`);
                await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
            clearSession(chatId, 'detailsDeleted');
        }
    });

    router.registerCallback('deleted_details_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'detailsDeleted');
        await bot.sendMessage(query.message!.chat.id, "Operation cancelled.");
    });
}
