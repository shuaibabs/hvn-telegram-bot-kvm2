import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { getPrebookingDetails } from '../prebookingService';
import { CommandRouter } from '../../../core/router/commandRouter';
import { getUserProfile, isAdmin } from '../../../core/auth/permissions';
import { formatToDDMMYYYY } from '../../../shared/utils/dateUtils';

export async function startDetailPrebookFlow(bot: TelegramBot, chatId: number) {
    setSession(chatId, 'prebookDetail', { stage: 'AWAIT_MOBILE' });
    await bot.sendMessage(chatId, "ℹ️ *Pre-booking Details*\n\nPlease enter the mobile number to show details:", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'pb_detail_cancel' }]]
        }
    });
}

export function registerDetailPrebookFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'prebookDetail');
        if (!session || !msg.text || msg.text.startsWith('/')) return;

        const chatId = msg.chat.id;
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
                clearSession(chatId, 'prebookDetail');
                return;
            }

            const employeeName = isUserAdmin ? undefined : profile?.displayName;

            const pb = await getPrebookingDetails(mobile, employeeName);

            if (!pb) {
                await bot.sendMessage(chatId, `❌ No pre-booking record found for \`${mobile}\`${employeeName ? ` assigned to ${employeeName}` : ""}.`, { parse_mode: 'Markdown' });
            } else {
                let text = `ℹ️ *Pre-booking Details: ${mobile}*\n`;
                text += `━━━━━━━━━━━━━━━━━━━━\n`;
                text += `📅 *Pre-booking Date:* ${formatToDDMMYYYY(pb.preBookingDate)}\n`;
                text += `🔢 *Digital Root (Sum):* ${pb.sum}\n`;
                text += `📡 *Type:* ${pb.originalNumberData.numberType}\n`;
                text += `🛡️ *Ownership:* ${pb.originalNumberData.ownershipType}\n`;
                text += `👤 *Assigned To:* ${pb.originalNumberData.assignedTo}\n`;
                
                // Add Status with RTP date if Non-RTP
                if (pb.originalNumberData.status === 'Non-RTP' && pb.originalNumberData.rtpDate) {
                    text += `📊 *Status:* Non-RTP (RTP Date: ${formatToDDMMYYYY(pb.originalNumberData.rtpDate)})\n`;
                } else {
                    text += `📊 *Status:* ${pb.originalNumberData.status}\n`;
                }
                
                text += `━━━━━━━━━━━━━━━━━━━━`;

                await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
            }
            clearSession(chatId, 'prebookDetail');
        } catch (error: any) {
            logger.error(`Error in detailPrebookFlow: ${error.message}`);
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    });

    router.registerCallback('pb_detail_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'prebookDetail');
        await bot.sendMessage(query.message!.chat.id, "Operation cancelled.");
    });
}
