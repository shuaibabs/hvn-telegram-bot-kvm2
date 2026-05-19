import TelegramBot from 'node-telegram-bot-api';
import { getBPInventory } from '../basicPremiumService';
import { CommandRouter } from '../../../core/router/commandRouter';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';

export async function startListBPInventoryFlow(bot: TelegramBot, chatId: number, employeeUid?: string) {
    try {
        const inline_keyboard = [
            [
                { text: '📦 Basic Inventory', callback_data: 'bp_list_type:basic' },
                { text: '⭐ Premium Inventory', callback_data: 'bp_list_type:premium' }
            ],
            [{ text: '❌ Close', callback_data: 'bp_list_close' }]
        ];
        await bot.sendMessage(chatId, "📋 *Select Inventory to List:*", {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard }
        });
    } catch (error: any) {
        logger.error(`Error in startListBPInventoryFlow: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}

async function showBPPage(bot: TelegramBot, chatId: number, page: number, results: any[], type: 'basic' | 'premium') {
    const PAGE_SIZE = 10;
    const count = results.length;
    const totalPages = Math.ceil(count / PAGE_SIZE);
    const offset = page * PAGE_SIZE;

    const typeLabel = type === 'premium' ? 'Premium' : 'Basic';
    const typeEmoji = type === 'premium' ? '⭐' : '📦';

    let text = `${typeEmoji} *${typeLabel} Inventory (${count})*\n`;
    text += `_Page ${page + 1} of ${totalPages}_\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    const displayResults = results.slice(offset, offset + PAGE_SIZE);
    displayResults.forEach((p: any) => {
        text += `${typeEmoji} \`${p.mobile}\` | ₹${p.purchasePrice.toLocaleString()} | ${p.purchaseFrom}\n`;
    });

    text += `\n━━━━━━━━━━━━━━━━━━━━`;

    const inline_keyboard: TelegramBot.InlineKeyboardButton[][] = [];
    const navButtons: TelegramBot.InlineKeyboardButton[] = [];

    if (page > 0) navButtons.push({ text: '⬅️ Back', callback_data: `bp_list_page_${page - 1}` });
    if (offset + PAGE_SIZE < count) navButtons.push({ text: 'Next ➡️', callback_data: `bp_list_page_${page + 1}` });

    if (navButtons.length > 0) inline_keyboard.push(navButtons);
    inline_keyboard.push([
        { text: '🔙 Back to Types', callback_data: 'bp_list_back_types' },
        { text: '❌ Close', callback_data: 'bp_list_close' }
    ]);

    await bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard }
    });
}

export function registerListBPInventoryFlow(router: CommandRouter) {
    const bot = router.bot;

    router.registerCallback(/^bp_list_type:(basic|premium)$/, async (query) => {
        const chatId = query.message!.chat.id;
        const type = query.data!.split(':').pop() as 'basic' | 'premium';
        
        try {
            await bot.deleteMessage(chatId, query.message!.message_id).catch(() => {});
            // Fetch inventory for type
            const results = await getBPInventory(type);
            const sorted = results.sort((a: any, b: any) => b.srNo - a.srNo);
            
            if (sorted.length === 0) {
                const inline_keyboard = [
                    [
                        { text: '🔙 Back', callback_data: 'bp_list_back_types' },
                        { text: '❌ Close', callback_data: 'bp_list_close' }
                    ]
                ];
                await bot.sendMessage(chatId, `📋 No ${type} inventory records found.`, {
                    reply_markup: { inline_keyboard }
                });
                return;
            }
            
            setSession(chatId, 'listBPInventory', { results: sorted, page: 0, type });
            await showBPPage(bot, chatId, 0, sorted, type);
        } catch (error: any) {
            logger.error(`Error listing ${type} inventory: ${error.message}`);
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    });

    router.registerCallback('bp_list_back_types', async (query) => {
        const chatId = query.message!.chat.id;
        clearSession(chatId, 'listBPInventory');
        await bot.deleteMessage(chatId, query.message!.message_id).catch(() => {});
        await startListBPInventoryFlow(bot, chatId);
    });

    router.registerCallback(/^bp_list_page_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'listBPInventory');
        if (!session) return;

        const page = parseInt(query.data!.split('_').pop()!);
        session.page = page;
        setSession(chatId, 'listBPInventory', session);

        await bot.deleteMessage(chatId, query.message!.message_id).catch(() => {});
        await showBPPage(bot, chatId, page, session.results, session.type);
    });

    router.registerCallback('bp_list_close', async (query) => {
        clearSession(query.message!.chat.id, 'listBPInventory');
        await bot.deleteMessage(query.message!.chat.id, query.message!.message_id).catch(() => {});
    });
}
