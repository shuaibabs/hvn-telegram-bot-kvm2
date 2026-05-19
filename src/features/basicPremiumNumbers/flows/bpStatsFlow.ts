import TelegramBot from 'node-telegram-bot-api';
import { getBPVendors, getBPStats } from '../basicPremiumService';
import { CommandRouter } from '../../../core/router/commandRouter';
import { logger } from '../../../core/logger/logger';

export async function startBPStatsFlow(bot: TelegramBot, chatId: number) {
    try {
        const vendors = await getBPVendors();

        const keyboard = [[{ text: '🌍 Global Stats (All Vendors)', callback_data: 'bp_stat_global' }]];
        
        vendors.forEach(v => {
            keyboard.push([{ text: `🏢 ${v}`, callback_data: `bp_stat_view:${v}` }]);
        });

        await bot.sendMessage(chatId, "📉 *Basic/Premium Statistics*\n\nSelect a vendor or view global stats:", {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error: any) {
        logger.error(`Error in startBPStatsFlow: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}

export function registerBPStatsFlow(router: CommandRouter) {
    const bot = router.bot;

    const handleStats = async (chatId: number, vendorName?: string) => {
        try {
            await bot.sendChatAction(chatId, 'typing');
            const stats = await getBPStats(vendorName);

            let text = `📊 *Basic/Premium Report${vendorName ? ': ' + vendorName : ' (Global)'}*\n`;
            text += `━━━━━━━━━━━━━━━━━━━━\n\n`;
            text += `💰 *Total Billed:* ₹${stats.totalBilled.toLocaleString()}\n`;
            text += `✅ *Total Paid:* ₹${stats.totalPaid.toLocaleString()}\n`;
            
            const remainingLabel = stats.amountRemaining > 0 ? "⚠️ *Amount Remaining:*" : "✅ *Amount Remaining:*";
            text += `${remainingLabel} ₹${stats.amountRemaining.toLocaleString()}\n\n`;
            
            text += `📝 *Total Records:* ${stats.totalRecords}\n`;
            text += `━━━━━━━━━━━━━━━━━━━━\n\n`;
            text += `📋 *Inventory Records (Details):*\n`;

            if (stats.records && stats.records.length > 0) {
                stats.records.slice(0, 50).forEach((r: any, idx: number) => {
                    text += `${idx + 1}. \`${r.mobile}\` | Sum: ${r.sum} | ₹${r.price.toLocaleString()} | Vendor: ${r.vendorName}\n`;
                });
                if (stats.records.length > 50) text += `\n_...and ${stats.records.length - 50} more items._`;
            } else {
                text += "_No records found._";
            }
            
            text += `\n━━━━━━━━━━━━━━━━━━━━`;

            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        } catch (error: any) {
            logger.error(`Error fetching BP stats: ${error.message}`);
            await bot.sendMessage(chatId, `❌ Error fetching statistics: ${error.message}`);
        }
    };

    router.registerCallback('bp_stat_global', async (query) => {
        await handleStats(query.message!.chat.id);
    });

    router.registerCallback(/^bp_stat_view:(.+)$/, async (query) => {
        const vendorName = query.data?.replace('bp_stat_view:', '');
        await handleStats(query.message!.chat.id, vendorName);
    });
}
