import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { getSaleDetails } from '../salesService';
import { CommandRouter } from '../../../core/router/commandRouter';
import { getUserProfile, isAdmin } from '../../../core/auth/permissions';
import { formatToDDMMYYYY } from '../../../shared/utils/dateUtils';

export async function startDetailSalesFlow(bot: TelegramBot, chatId: number) {
    setSession(chatId, 'saleDetail', { stage: 'AWAIT_MOBILE' });
    await bot.sendMessage(chatId, "ℹ️ *Sale Details*\n\nPlease enter the mobile number to show details:", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'sale_detail_cancel' }]]
        }
    });
}

export function registerDetailSalesFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'saleDetail');
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
                clearSession(chatId, 'saleDetail');
                return;
            }

            const employeeName = isUserAdmin ? undefined : profile?.displayName;

            const sale = await getSaleDetails(mobile, employeeName);

            if (!sale) {
                await bot.sendMessage(chatId, `❌ No sale record found for \`${mobile}\`${employeeName ? ` assigned to ${employeeName}` : ""}.`, { parse_mode: 'Markdown' });
            } else {
                let text = `ℹ️ *Sale Details: ${mobile}*\n`;
                text += `━━━━━━━━━━━━━━━━━━━━\n`;
                text += `💰 *Sale Price:* ₹${sale.salePrice}\n`;
                text += `👤 *Sold To:* ${sale.soldTo}\n`;
                text += `📅 *Sale Date:* ${formatToDDMMYYYY(sale.saleDate)}\n`;
                text += `🔢 *Digital Root (Sum):* ${sale.sum}\n`;
                text += `📡 *Type:* ${sale.originalNumberData.numberType}\n`;
                text += `🛡️ *Ownership:* ${sale.originalNumberData.ownershipType}\n`;
                text += `👤 *Assigned To:* ${sale.originalNumberData.assignedTo}\n`;
                text += `━━━━━━━━━━━━━━━━━━━━`;

                await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
            }
            clearSession(chatId, 'saleDetail');
        } catch (error: any) {
            logger.error(`Error in detailSalesFlow: ${error.message}`);
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    });

    router.registerCallback('sale_detail_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'saleDetail');
        await bot.sendMessage(query.message!.chat.id, "Operation cancelled.");
    });
}
