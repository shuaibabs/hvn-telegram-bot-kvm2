import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { getPartnershipDetails } from '../partnersService';
import { CommandRouter } from '../../../core/router/commandRouter';
import { getUserProfile, isAdmin } from '../../../core/auth/permissions';
import { formatToDDMMYYYY } from '../../../shared/utils/dateUtils';

export async function startDetailPartnersFlow(bot: TelegramBot, chatId: number, username?: string) {
    const isUserAdmin = await isAdmin(username);
    const profile = await getUserProfile(username);
    if (!isUserAdmin && !profile?.displayName) {
        await bot.sendMessage(chatId, "❌ *Profile Incomplete*\n\nYour profile does not have a display name set in the system. Please contact an administrator.", { parse_mode: 'Markdown' });
        return;
    }

    setSession(chatId, 'partnershipDetail', { stage: 'AWAIT_MOBILE' });
    await bot.sendMessage(chatId, "ℹ️ *Partnership Details*\n\nPlease enter the mobile number to show details:", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'partners_detail_cancel' }]]
        }
    });
}

export function registerDetailPartnersFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'partnershipDetail');
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
                clearSession(chatId, 'partnershipDetail');
                return;
            }

            const employeeName = isUserAdmin ? undefined : profile?.displayName;

            const num = await getPartnershipDetails(mobile, employeeName);

            if (!num) {
                await bot.sendMessage(chatId, `❌ No partnership record found for \`${mobile}\`${employeeName ? ` assigned to ${employeeName}` : ""}.`, { parse_mode: 'Markdown' });
            } else {
                let text = `🤝 *Partnership Details: ${mobile}*\n`;
                text += `━━━━━━━━━━━━━━━━━━━━\n`;
                text += `👤 *Partner Name:* ${num.partnerName || 'N/A'}\n`;
                text += `💰 *Purchase Price:* ₹${num.purchasePrice}\n`;
                text += `📍 *Current Location:* ${num.currentLocation}\n`;
                text += `📡 *Type:* ${num.numberType}\n`;
                text += `🛡️ *Ownership:* ${num.ownershipType}\n`;
                text += `👤 *Assigned To:* ${num.assignedTo}\n`;
                text += `📅 *Purchase Date:* ${formatToDDMMYYYY(num.purchaseDate)}\n`;
                text += `━━━━━━━━━━━━━━━━━━━━`;

                await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
            }
            clearSession(chatId, 'partnershipDetail');
        } catch (error: any) {
            logger.error(`Error in detailPartnersFlow: ${error.message}`);
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    });

    router.registerCallback('partners_detail_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'partnershipDetail');
        await bot.sendMessage(query.message!.chat.id, "Operation cancelled.");
    });
}
