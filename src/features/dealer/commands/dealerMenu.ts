import TelegramBot from 'node-telegram-bot-api';
import { CommandRouter } from '../../../core/router/commandRouter';
import { Guard } from '../../../core/auth/guard';
import { env } from '../../../config/env';
import { startAddDealerFlow } from '../flows/addDealerFlow';
import { startDeleteDealerFlow } from '../flows/deleteDealerFlow';
import { startDetailsDealerFlow } from '../flows/detailsDealerFlow';
import { startAddDealerPaymentFlow } from '../flows/addDealerPaymentFlow';
import { startDealerStatsFlow } from '../flows/dealerStatsFlow';
import { startSearchDealerPurchasesFlow } from '../flows/searchDealerPurchasesFlow';
import { startListDealerPurchasesFlow } from '../flows/listDealerPurchasesFlow';

export async function dealerMenuCommand(bot: TelegramBot, chatId: number, username?: string) {
    const opts: TelegramBot.SendMessageOptions = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '📋 List Purchases', callback_data: 'dealer_purchase_list' }],
                [{ text: '🔍 Search Purchase', callback_data: 'dealer_purchase_search' }],
                [{ text: '📉 Dealer Statistics', callback_data: 'dealer_purchase_stats' }],
                [{ text: '💳 Record Payment', callback_data: 'dealer_add_payment' }],
                [{ text: '➕ Add Dealer Numbers', callback_data: 'dealer_add' }],
                [{ text: '🗑️ Delete Dealer Purchase', callback_data: 'dealer_delete' }],
                [{ text: 'ℹ️ View Details', callback_data: 'dealer_details' }]
            ]
        }
    };

    await bot.sendMessage(chatId, "🤝 *Dealer Purchases*\n\nManage numbers purchased from dealers.", opts);
}

export function registerDealerFeature(router: CommandRouter) {
    const bot = router.bot;

    router.register(/^(?:\/start|start)$/i, async (msg: TelegramBot.Message) => {
        await dealerMenuCommand(bot, msg.chat.id, msg.from?.username);
    }, [env.TG_GROUP_DEALER_PURCHASES || '']);

    router.registerCallback('dealer_purchases_start', async (query) => {
        await dealerMenuCommand(bot, query.message!.chat.id, query.from.username);
    }, [env.TG_GROUP_DEALER_PURCHASES || '']);

    router.registerCallback('dealer_purchase_list', Guard.registeredOnlyCallback(bot, async (query) => {
        await startListDealerPurchasesFlow(bot, query.message!.chat.id);
    }), [env.TG_GROUP_DEALER_PURCHASES || '']);

    router.registerCallback('dealer_purchase_search', Guard.registeredOnlyCallback(bot, async (query) => {
        await startSearchDealerPurchasesFlow(bot, query.message!.chat.id);
    }), [env.TG_GROUP_DEALER_PURCHASES || '']);

    router.registerCallback('dealer_purchase_stats', Guard.registeredOnlyCallback(bot, async (query) => {
        await startDealerStatsFlow(bot, query.message!.chat.id);
    }), [env.TG_GROUP_DEALER_PURCHASES || '']);

    router.registerCallback('dealer_add_payment', Guard.registeredOnlyCallback(bot, async (query) => {
        await startAddDealerPaymentFlow(bot, query.message!.chat.id);
    }), [env.TG_GROUP_DEALER_PURCHASES || '']);

    router.registerCallback('dealer_add', Guard.registeredOnlyCallback(bot, async (query) => {
        await startAddDealerFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_DEALER_PURCHASES || '']);

    router.registerCallback('dealer_delete', Guard.registeredOnlyCallback(bot, async (query) => {
        await startDeleteDealerFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_DEALER_PURCHASES || '']);

    router.registerCallback('dealer_details', Guard.registeredOnlyCallback(bot, async (query) => {
        await startDetailsDealerFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_DEALER_PURCHASES || '']);
}
