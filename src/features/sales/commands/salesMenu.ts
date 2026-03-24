import TelegramBot from 'node-telegram-bot-api';
import { CommandRouter } from '../../../core/router/commandRouter';
import { Guard } from '../../../core/auth/guard';
import { env } from '../../../config/env';
import { isAdmin } from '../../../core/auth/permissions';
import { startListSalesFlow } from '../flows/listSalesFlow';
import { startSearchSalesFlow } from '../flows/searchSalesFlow';
import { startDetailSalesFlow } from '../flows/detailSalesFlow';
import { startVendorSalesFlow } from '../flows/vendorSalesFlow';
import { startCancelSaleFlow } from '../flows/cancelSaleFlow';
import { startAddPaymentFlow } from '../flows/addPaymentFlow';

export const salesMenuCommand = async (bot: TelegramBot, chatId: number | string, username?: string) => {
    const isUserAdmin = await isAdmin(username);

    const keyboard = [
        [{ text: '📋 List Sales Numbers', callback_data: 'sales_list' }],
        [{ text: '🔍 Search Sales', callback_data: 'sales_search' }],
        [{ text: 'ℹ️ Sale Details', callback_data: 'sales_detail' }],
        [{ text: '📈 Sales by Vendor', callback_data: 'sales_vendor_list' }],
        [{ text: '💳 Add Payment', callback_data: 'sales_add_payment' }],
        [{ text: '❌ Cancel Sale', callback_data: 'sales_cancel' }]
    ];

    await bot.sendMessage(chatId, "💰 *Sales Management Menu*\n\nWelcome! Use the buttons below to manage sales records.", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: keyboard
        }
    });
};

export function registerSalesMenu(router: CommandRouter) {
    const bot = router.bot;

    // Handle /start, START, start
    router.register(/^(?:\/start|start)$/i, Guard.registeredOnlyCommand(bot, async (msg) => {
        await salesMenuCommand(bot, msg.chat.id, msg.from?.username);
    }), [env.TG_GROUP_SALES || '']);

    // Handle standard Get Started button
    router.registerCallback('sales_start', Guard.registeredOnlyCallback(bot, async (query) => {
        await salesMenuCommand(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_SALES || '']);

    // List Sales
    router.registerCallback('sales_list', Guard.registeredOnlyCallback(bot, async (query) => {
        await startListSalesFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_SALES || '']);

    // Search Sales
    router.registerCallback('sales_search', Guard.registeredOnlyCallback(bot, async (query) => {
        await startSearchSalesFlow(bot, query.message!.chat.id);
    }), [env.TG_GROUP_SALES || '']);

    // Sale Details
    router.registerCallback('sales_detail', Guard.registeredOnlyCallback(bot, async (query) => {
        await startDetailSalesFlow(bot, query.message!.chat.id);
    }), [env.TG_GROUP_SALES || '']);

    // Sales by Vendor
    router.registerCallback('sales_vendor_list', Guard.registeredOnlyCallback(bot, async (query) => {
        await startVendorSalesFlow(bot, query.message!.chat.id);
    }), [env.TG_GROUP_SALES || '']);

    // Cancel Sale
    router.registerCallback('sales_cancel', Guard.registeredOnlyCallback(bot, async (query) => {
        await startCancelSaleFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_SALES || '']);

    // Add Payment
    router.registerCallback('sales_add_payment', Guard.registeredOnlyCallback(bot, async (query) => {
        await startAddPaymentFlow(bot, query.message!.chat.id);
    }), [env.TG_GROUP_SALES || '']);
}
