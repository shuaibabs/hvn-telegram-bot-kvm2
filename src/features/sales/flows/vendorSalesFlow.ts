import TelegramBot from 'node-telegram-bot-api';
import { getSalesVendors, getVendorSalesStats } from '../salesService';
import { CommandRouter } from '../../../core/router/commandRouter';
import { logger } from '../../../core/logger/logger';
import { formatToDDMMYYYY } from '../../../shared/utils/dateUtils';

export async function startVendorSalesFlow(bot: TelegramBot, chatId: number) {
    try {
        const vendors = await getSalesVendors();

        if (vendors.length === 0) {
            await bot.sendMessage(chatId, "📋 No sales vendors found.");
            return;
        }

        const keyboard = vendors.map(v => ([{
            text: v.name,
            callback_data: `sales_vendor_stat:${v.name}`
        }]));

        await bot.sendMessage(chatId, "📈 *Sales by Vendor*\n\nPlease select a vendor to view their sales statistics:", {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        });
    } catch (error: any) {
        logger.error(`Error in startVendorSalesFlow: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}

export function registerVendorSalesFlow(router: CommandRouter) {
    const bot = router.bot;

    router.registerCallback(/^sales_vendor_stat:(.+)$/, async (query: TelegramBot.CallbackQuery) => {
        const data = query.data || '';
        const match = /^sales_vendor_stat:(.+)$/.exec(data);
        if (!match) return;

        const chatId = query.message!.chat.id;
        const vendorName = match[1];

        try {
            await bot.sendChatAction(chatId, 'typing');
            const stats = await getVendorSalesStats(vendorName);

            let text = `📊 *Vendor Sales Report: ${vendorName}*\n`;
            text += `━━━━━━━━━━━━━━━━━━━━\n\n`;
            text += `💰 *Total Billed:* ₹${stats.totalBilled.toLocaleString()}\n`;
            text += `📉 *Total Purchase:* ₹${stats.totalPurchaseAmount.toLocaleString()}\n`;
            
            const profitLabel = stats.profitLoss >= 0 ? "📈 *Profit:*" : "📉 *Loss:*";
            text += `${profitLabel} ₹${Math.abs(stats.profitLoss).toLocaleString()}\n\n`;
            
            text += `✅ *Total Paid:* ₹${stats.totalPaid.toLocaleString()}\n`;
            
            const remainingLabel = stats.amountRemaining > 0 ? "⚠️ *Amount Remaining:*" : "✅ *Amount Remaining:*";
            text += `${remainingLabel} ₹${stats.amountRemaining.toLocaleString()}\n\n`;
            
            text += `📝 *Total Records:* ${stats.totalRecords}\n`;
            text += `━━━━━━━━━━━━━━━━━━━━\n\n`;
            text += `📋 *Sale Records (Details):*\n`;

            if (stats.records && stats.records.length > 0) {
                stats.records.forEach((r: any, idx: number) => {
                    const dateStr = formatToDDMMYYYY(r.saleDate);
                    text += `${idx + 1}. \`${r.mobile}\` | Sum: ${r.sum} | ₹${r.salePrice.toLocaleString()} | ${dateStr}\n`;
                });
            } else {
                text += "_No records found._";
            }
            
            text += `\n━━━━━━━━━━━━━━━━━━━━`;

            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        } catch (error: any) {
            logger.error(`Error fetching vendor stats for ${vendorName}: ${error.message}`);
            await bot.sendMessage(chatId, `❌ Error fetching statistics: ${error.message}`);
        }
    });
}
