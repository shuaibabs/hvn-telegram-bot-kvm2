import TelegramBot from 'node-telegram-bot-api';
import { CommandRouter } from '../../../core/router/commandRouter';
import { Guard } from '../../../core/auth/guard';
import { env } from '../../../config/env';
import { isAdmin } from '../../../core/auth/permissions';
import { startAddNumberFlow } from '../flows/addNumberFlow';
import { startUpdateStatusFlow } from '../flows/updateStatusFlow';
import { startAssignToUserFlow } from '../flows/assignToUserFlow';
import { startDeleteNumbersFlow } from '../flows/deleteNumbersFlow';
import { startMarkAsSoldFlow } from '../flows/markAsSoldFlow';
import { startPrebookFlow } from '../flows/prebookFlow';
import { startSearchFlow } from '../flows/searchFlow';
import { startDetailNumberFlow } from '../flows/detailNumberFlow';
import { startQuickAddNumberFlow } from '../flows/quickAddNumberFlow';

export const inventoryMenuCommand = async (bot: TelegramBot, chatId: number | string, username?: string) => {
    const isUserAdmin = await isAdmin(username);

    const keyboard = [
        [{ text: '➕ Add Number', callback_data: 'inv_add' }, { text: '⚡ Quick Add', callback_data: 'inv_quick_add' }],
        [{ text: '🔄 Update Status', callback_data: 'inv_upd_stat' }],
        [{ text: '💰 Mark as Sold', callback_data: 'inv_sold' }],
        [{ text: '📖 Prebook Number', callback_data: 'inv_prebook' }],
        [{ text: '🔍 Search Numbers', callback_data: 'inv_search' }],
        [{ text: 'ℹ️ Number Details', callback_data: 'inv_detail' }]
    ];

    if (isUserAdmin) {
        keyboard.push([{ text: '👤 Assign to User (Admin)', callback_data: 'inv_assign' }]);
        keyboard.push([{ text: '🗑 Delete Numbers (Admin)', callback_data: 'inv_del' }]);
    }

    await bot.sendMessage(chatId, "📦 *Inventory Management Menu*\n\nWelcome! Use the buttons below to manage the number inventory.", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: keyboard
        }
    });
};

export function registerInventoryMenu(router: CommandRouter) {
    const bot = router.bot;

    // Handle /start, START, start
    router.register(/^(?:\/start|start)$/i, Guard.registeredOnlyCommand(bot, async (msg) => {
        await inventoryMenuCommand(bot, msg.chat.id, msg.from?.username);
    }), [env.TG_GROUP_INVENTORY || '']);

    // Handle standard Get Started button
    router.registerCallback('inventory_start', Guard.registeredOnlyCallback(bot, async (query) => {
        await inventoryMenuCommand(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_INVENTORY || '']);

    // Handle "Add Number" button click
    router.registerCallback('inv_add', Guard.registeredOnlyCallback(bot, async (query) => {
        await startAddNumberFlow(bot, query.message!.chat.id);
    }), [env.TG_GROUP_INVENTORY || '']);

    router.registerCallback('inv_quick_add', Guard.registeredOnlyCallback(bot, async (query) => {
        await startQuickAddNumberFlow(bot, query.message!.chat.id);
    }), [env.TG_GROUP_INVENTORY || '']);

    // Handle "Update Status" button click
    router.registerCallback('inv_upd_stat', Guard.registeredOnlyCallback(bot, async (query) => {
        await startUpdateStatusFlow(bot, query.message!.chat.id);
    }), [env.TG_GROUP_INVENTORY || '']);

    // Handle "Mark as Sold" button click
    router.registerCallback('inv_sold', Guard.registeredOnlyCallback(bot, async (query) => {
        await startMarkAsSoldFlow(bot, query.message!.chat.id);
    }), [env.TG_GROUP_INVENTORY || '']);

    // Handle "Prebook Number" button click
    router.registerCallback('inv_prebook', Guard.registeredOnlyCallback(bot, async (query) => {
        await startPrebookFlow(bot, query.message!.chat.id);
    }), [env.TG_GROUP_INVENTORY || '']);

    // Handle "Search Numbers" button click
    router.registerCallback('inv_search', Guard.registeredOnlyCallback(bot, async (query) => {
        await startSearchFlow(bot, query.message!.chat.id);
    }), [env.TG_GROUP_INVENTORY || '']);

    // Handle "Number Details" button click
    router.registerCallback('inv_detail', Guard.registeredOnlyCallback(bot, async (query) => {
        await startDetailNumberFlow(bot, query.message!.chat.id);
    }), [env.TG_GROUP_INVENTORY || '']);

    // Handle "Assign to User" button click (Admin Only)
    router.registerCallback('inv_assign', Guard.adminOnlyCallback(bot, async (query) => {
        await startAssignToUserFlow(bot, query.message!.chat.id);
    }), [env.TG_GROUP_INVENTORY || '']);

    router.registerCallback('inv_del', Guard.adminOnlyCallback(bot, async (query) => {
        await startDeleteNumbersFlow(bot, query.message!.chat.id);
    }), [env.TG_GROUP_INVENTORY || '']);
}
