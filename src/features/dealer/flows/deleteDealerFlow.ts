import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { getDealerPurchases, deleteDealerPurchase } from '../dealerService';
import { isAdmin, getUserProfile } from '../../../core/auth/permissions';
import { CommandRouter } from '../../../core/router/commandRouter';
import { logger } from '../../../core/logger/logger';
import { logActivity } from '../../activities/activityService';

export async function startDeleteDealerFlow(bot: TelegramBot, chatId: number, username?: string) {
    try {
        const isUserAdmin = await isAdmin(username);
        const profile = await getUserProfile(username);
        const purchases = await getDealerPurchases(isUserAdmin ? undefined : profile?.uid || undefined);

        if (purchases.length === 0) {
            await bot.sendMessage(chatId, "📭 No dealer purchases found to delete.");
            return;
        }

        const buttons: TelegramBot.InlineKeyboardButton[][] = purchases.slice(0, 10).map((p: any) => ([{ text: `${p.mobile} (${p.dealerName})`, callback_data: `dealer_del_val_${p.id}_${p.mobile}` }]));
        buttons.push([{ text: '❌ Cancel', callback_data: 'dealer_del_cancel' }]);

        await bot.sendMessage(chatId, "🗑️ *Delete Dealer Purchase*\n\nSelect a record to delete:", {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        });
    } catch (error: any) {
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}

export function registerDeleteDealerFlow(router: CommandRouter) {
    const bot = router.bot;

    router.registerCallback(/^dealer_del_val_/, async (query) => {
        const chatId = query.message!.chat.id;
        const data = query.data?.split('_'); // dealer_del_val_ID_MOBILE
        const id = data![3];
        const mobile = data![4];

        try {
            await deleteDealerPurchase(id);
            await bot.sendMessage(chatId, `✅ Record for \`${mobile}\` has been deleted.`, { parse_mode: 'Markdown' });
            
            const profile = await getUserProfile(query.from.username);
            const performedBy = profile?.displayName || query.from.username || 'Unknown';

            // Log Activity
            await logActivity(bot, {
                employeeName: performedBy,
                action: 'DELETE_DEALER_PURCHASE',
                description: `Deleted dealer purchase record for number ${mobile}`,
                createdBy: performedBy,
                source: 'BOT',
                groupName: 'DEALER_PURCHASES'
            }, true);
        } catch (error: any) {
            await bot.sendMessage(chatId, `❌ Failed to delete record: ${error.message}`);
        }
    });

    router.registerCallback('dealer_del_cancel', async (query) => {
        await bot.sendMessage(query.message!.chat.id, "Operation cancelled.");
    });
}
