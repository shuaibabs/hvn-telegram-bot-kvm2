import TelegramBot from 'node-telegram-bot-api';
import { CommandRouter } from '../../../core/router/commandRouter';
import { Guard } from '../../../core/auth/guard';
import { startAddBPNumberFlow } from '../flows/addBPNumberFlow';
import { startAddBPPaymentFlow } from '../flows/addBPPaymentFlow';
import { startBPStatsFlow } from '../flows/bpStatsFlow';
import { startListBPInventoryFlow } from '../flows/listBPInventoryFlow';
import { startManageBPNumberFlow } from '../flows/manageBPNumberFlow';
import { startAddBPVendorFlow } from '../flows/addBPVendorFlow';
import { GROUPS } from '../../../config/env';

export async function bpMenuCommand(bot: TelegramBot, chatId: number, username?: string) {
    const opts: TelegramBot.SendMessageOptions = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '📋 List Inventory', callback_data: 'bp_list' }],
                [{ text: '⚙️ Manage Numbers', callback_data: 'bp_manage' }],
                [{ text: '📉 Statistics', callback_data: 'bp_stats' }],
                [{ text: '💳 Record Payment', callback_data: 'bp_add_payment' }],
                [{ text: '➕ Add Basic/Premium', callback_data: 'bp_add' }],
                [{ text: '🤝 Manage Vendors', callback_data: 'bp_vendors_manage' }]
            ]
        }
    };

    await bot.sendMessage(chatId, "💎 *Basic / Premium Numbers*\n\nManage Basic and Premium numbers inventory.", opts);
}

export function registerBPFeature(router: CommandRouter) {
    const bot = router.bot;

    router.register(/^(?:\/start|start)$/i, async (msg: TelegramBot.Message) => {
        await bpMenuCommand(bot, msg.chat.id, msg.from?.username);
    }, [GROUPS.BASIC_PREMIUM_NUMBERS || '']);

    router.registerCallback('bp_start', async (query) => {
        await bpMenuCommand(bot, query.message!.chat.id, query.from.username);
    }, [GROUPS.BASIC_PREMIUM_NUMBERS || '']);

    router.registerCallback('bp_list', Guard.registeredOnlyCallback(bot, async (query) => {
        await startListBPInventoryFlow(bot, query.message!.chat.id);
    }), [GROUPS.BASIC_PREMIUM_NUMBERS || '']);

    router.registerCallback('bp_stats', Guard.registeredOnlyCallback(bot, async (query) => {
        await startBPStatsFlow(bot, query.message!.chat.id);
    }), [GROUPS.BASIC_PREMIUM_NUMBERS || '']);

    router.registerCallback('bp_add_payment', Guard.registeredOnlyCallback(bot, async (query) => {
        await startAddBPPaymentFlow(bot, query.message!.chat.id);
    }), [GROUPS.BASIC_PREMIUM_NUMBERS || '']);

    router.registerCallback('bp_add', Guard.registeredOnlyCallback(bot, async (query) => {
        await startAddBPNumberFlow(bot, query.message!.chat.id, query.from.username);
    }), [GROUPS.BASIC_PREMIUM_NUMBERS || '']);

    router.registerCallback('bp_manage', Guard.registeredOnlyCallback(bot, async (query) => {
        await startManageBPNumberFlow(bot, query.message!.chat.id, query.from.username);
    }), [GROUPS.BASIC_PREMIUM_NUMBERS || '']);

    router.registerCallback('bp_vendors_manage', Guard.registeredOnlyCallback(bot, async (query) => {
        await startAddBPVendorFlow(bot, query.message!.chat.id, query.from.username);
    }), [GROUPS.BASIC_PREMIUM_NUMBERS || '']);
}
