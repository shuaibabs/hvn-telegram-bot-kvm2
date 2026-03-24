import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { getNumberDetails } from '../inventoryService';
import { CommandRouter } from '../../../core/router/commandRouter';
import { formatToDDMMYYYY } from '../../../shared/utils/dateUtils';

const DETAIL_STAGES = {
    AWAIT_NUMBER: 'AWAIT_NUMBER',
} as const;

type DetailSession = {
    stage: keyof typeof DETAIL_STAGES;
};

const cancelBtn = { text: '❌ Close', callback_data: 'detail_cancel' };

export async function startDetailNumberFlow(bot: TelegramBot, chatId: number) {
    setSession(chatId, 'detailNumber', {
        stage: 'AWAIT_NUMBER'
    });

    await bot.sendMessage(chatId, "ℹ️ *Number Details*\n\n*Step 1:* Please enter a 10-digit mobile number to check:", {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[cancelBtn]] }
    });
}

export function registerDetailNumberFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'detailNumber') as DetailSession | undefined;
        if (!session || !msg.text || msg.text.startsWith('/')) return;

        const chatId = msg.chat.id;
        const mobile = msg.text.trim().replace(/\D/g, '');

        if (mobile.length !== 10) {
            await bot.sendMessage(chatId, "❌ Please enter a valid 10-digit mobile number.");
            return;
        }

        try {
            const { found, location, data } = await getNumberDetails(mobile);

            if (!found) {
                await bot.sendMessage(chatId, `❌ *Number Not Found*\n\nThe number \`${mobile}\` is not in our system.`, { parse_mode: 'Markdown' });
            } else {
                let response = `ℹ️ *Details for* \`${mobile}\`\n`;
                response += `━━━━━━━━━━━━━━━━━━━━\n\n`;

                response += `📍 *System Location:* \`${location}\`\n\n`;

                if (location === 'Inventory') {
                    response += `📋 *Basic Info*\n`;
                    response += `├ Status: *${data.status}*\n`;
                    response += `├ Type: ${data.numberType} (${data.ownershipType})\n`;
                    response += `└ Sum: *${data.sum}*\n\n`;

                    response += `💰 *Pricing*\n`;
                    response += `├ Purchase: ₹${data.purchasePrice}\n`;
                    response += `└ Sale: *₹${data.salePrice}*\n\n`;

                    response += `🏢 *Inventory Details*\n`;
                    response += `├ Vendor: ${data.purchaseFrom}\n`;
                    response += `├ Loc Type: ${data.locationType}\n`;
                    response += `├ Current: ${data.currentLocation}\n`;
                    response += `└ Assigned: ${data.assignedTo}\n\n`;

                    if (data.notes) response += `📝 *Notes:* ${data.notes}\n\n`;

                } else if (location === 'Sales') {
                    const orig = data.originalNumberData || {};
                    response += `💰 *Sale Info*\n`;
                    response += `├ Sold To: *${data.soldTo}*\n`;
                    response += `├ Sale Price: ₹${data.salePrice}\n`;
                    response += `└ Date: ${formatToDDMMYYYY(data.saleDate)}\n\n`;

                    response += `📋 *Original Details*\n`;
                    response += `├ Type: ${orig.numberType}\n`;
                    response += `└ Vendor: ${orig.purchaseFrom}\n\n`;

                } else if (location === 'Prebooked') {
                    response += `📅 *Booking Info*\n`;
                    response += `├ Date: ${formatToDDMMYYYY(data.preBookingDate)}\n`;
                    response += `└ Status: ${data.uploadStatus}\n\n`;

                } else if (location === 'Deleted') {
                    response += `🗑 *Deletion Info*\n`;
                    response += `├ Date: ${formatToDDMMYYYY(data.deletedAt)}\n`;
                    response += `├ By: ${data.deletedBy}\n`;
                    response += `└ Reason: ${data.deletionReason}\n\n`;
                }

                response += `━━━━━━━━━━━━━━━━━━━━`;
                await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
            }

            clearSession(chatId, 'detailNumber');
        } catch (error: any) {
            logger.error(`Error in DetailNumberFlow: ${error.message}`);
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            clearSession(chatId, 'detailNumber');
        }
    });

    router.registerCallback('detail_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'detailNumber');
        await bot.sendMessage(query.message!.chat.id, "Detail check closed.");
    });
}
