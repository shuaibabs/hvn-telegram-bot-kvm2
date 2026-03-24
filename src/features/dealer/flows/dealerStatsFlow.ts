import TelegramBot from 'node-telegram-bot-api';
import { getDealers, getDealerPurchaseStats } from '../dealerService';
import { CommandRouter } from '../../../core/router/commandRouter';
import { logger } from '../../../core/logger/logger';

export async function startDealerStatsFlow(bot: TelegramBot, chatId: number) {
    try {
        const dealers = await getDealers();

        const keyboard = [[{ text: '🌍 Global Stats (All Dealers)', callback_data: 'dealer_stat_global' }]];
        
        dealers.forEach(d => {
            keyboard.push([{ text: `🏢 ${d}`, callback_data: `dealer_stat_view:${d}` }]);
        });

        await bot.sendMessage(chatId, "📉 *Dealer Purchase Statistics*\n\nSelect a dealer or view global stats:", {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error: any) {
        logger.error(`Error in startDealerStatsFlow: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}

export function registerDealerStatsFlow(router: CommandRouter) {
    const bot = router.bot;

    const handleStats = async (chatId: number, dealerName?: string) => {
        try {
            await bot.sendChatAction(chatId, 'typing');
            const stats = await getDealerPurchaseStats(dealerName);

            let text = `📊 *Dealer Purchase Report${dealerName ? ': ' + dealerName : ' (Global)'}*\n`;
            text += `━━━━━━━━━━━━━━━━━━━━\n\n`;
            text += `💰 *Total Billed:* ₹${stats.totalBilled.toLocaleString()}\n`;
            text += `✅ *Total Paid:* ₹${stats.totalPaid.toLocaleString()}\n`;
            
            const remainingLabel = stats.amountRemaining > 0 ? "⚠️ *Amount Remaining:*" : "✅ *Amount Remaining:*";
            text += `${remainingLabel} ₹${stats.amountRemaining.toLocaleString()}\n\n`;
            
            text += `📝 *Total Records:* ${stats.totalRecords}\n`;
            text += `━━━━━━━━━━━━━━━━━━━━\n\n`;
            text += `📋 *Purchase Records (Details):*\n`;

            if (stats.records && stats.records.length > 0) {
                stats.records.forEach((r: any, idx: number) => {
                    text += `${idx + 1}. \`${r.mobile}\` | Sum: ${r.sum} | ₹${r.price.toLocaleString()} | Dealer: ${r.dealerName}\n`;
                });
            } else {
                text += "_No records found._";
            }
            
            text += `\n━━━━━━━━━━━━━━━━━━━━`;

            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        } catch (error: any) {
            logger.error(`Error fetching dealer stats: ${error.message}`);
            await bot.sendMessage(chatId, `❌ Error fetching statistics: ${error.message}`);
        }
    };

    router.registerCallback('dealer_stat_global', async (query) => {
        await handleStats(query.message!.chat.id);
    });

    router.registerCallback(/^dealer_stat_view:(.+)$/, async (query) => {
        const dealerName = query.data?.replace('dealer_stat_view:', '');
        await handleStats(query.message!.chat.id, dealerName);
    });
}
