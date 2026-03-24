import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { getNumberByMobile } from '../locationsService';
import { isAdmin, getUserProfile } from '../../../core/auth/permissions';
import { CommandRouter } from '../../../core/router/commandRouter';
import { logger } from '../../../core/logger/logger';
import { format } from 'date-fns';

export async function startDetailsLocationFlow(bot: TelegramBot, chatId: number, username?: string) {
    const isUserAdmin = await isAdmin(username);
    const profile = await getUserProfile(username);
    if (!isUserAdmin && !profile?.displayName) {
        await bot.sendMessage(chatId, "❌ *Profile Incomplete*\n\nYour profile does not have a display name set in the system.", { parse_mode: 'Markdown' });
        return;
    }

    setSession(chatId, 'detailsLocation', { stage: 'AWAIT_MOBILE' });

    await bot.sendMessage(chatId, "🔍 *SIM Location Details*\n\nPlease enter the 10-digit mobile number:", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'loc_details_cancel' }]]
        }
    });
}

export function registerDetailsLocationFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'detailsLocation');
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

                const result = await getNumberByMobile(text, employeeName);
                if (result) {
                    let textMsg = `📋 *SIM Details:*\n`;
                    textMsg += `━━━━━━━━━━━━━━━━━━━━\n`;
                    textMsg += `📱 *Mobile:* \`${result.mobile}\`\n`;
                    textMsg += `📍 *Location:* ${result.currentLocation} (${result.locationType})\n`;
                    textMsg += `👤 *Assigned To:* ${result.assignedTo || 'Unassigned'}\n`;
                    textMsg += `📈 *Status:* ${result.status}\n`;
                    textMsg += `🔢 *Digital Root:* ${result.sum}\n`;
                    if (result.purchaseFrom) textMsg += `🛒 *Purchased From:* ${result.purchaseFrom}\n`;
                    if (result.purchasePrice) textMsg += `💰 *Purchase Price:* ₹${result.purchasePrice}\n`;
                    
                    if (result.checkInDate) {
                        textMsg += `🕒 *Last Check-In:* ${format(result.checkInDate.toDate(), 'PPP p')}\n`;
                    }
                    textMsg += `━━━━━━━━━━━━━━━━━━━━`;

                    await bot.sendMessage(chatId, textMsg, { parse_mode: 'Markdown' });
                } else {
                    const errorMsg = isUserAdmin 
                        ? `❌ Number \`${text}\` not found in inventory.`
                        : `❌ Number \`${text}\` not found or not assigned to you.`;
                    await bot.sendMessage(chatId, errorMsg, { parse_mode: 'Markdown' });
                }
            } catch (error: any) {
                logger.error(`Error in detailsLocationFlow: ${error.message}`);
                await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
            clearSession(chatId, 'detailsLocation');
        }
    });

    router.registerCallback('loc_details_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'detailsLocation');
        await bot.sendMessage(query.message!.chat.id, "Operation cancelled.");
    });
}
