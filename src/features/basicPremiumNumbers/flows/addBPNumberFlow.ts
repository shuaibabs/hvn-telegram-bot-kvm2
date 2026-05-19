import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { addBPNumber, getBPVendors, addBPVendor } from '../basicPremiumService';
import { getUserProfile } from '../../../core/auth/permissions';
import { CommandRouter } from '../../../core/router/commandRouter';
import { logger } from '../../../core/logger/logger';
import { logActivity } from '../../activities/activityService';

export async function startAddBPNumberFlow(bot: TelegramBot, chatId: number, username?: string) {
    setSession(chatId, 'addBPNumber', { stage: 'AWAIT_NUMBERS' });

    await bot.sendMessage(chatId, "➕ *Add Basic / Premium Number*\n\nPlease enter the mobile number(s). You can enter a single number or multiple numbers separated by commas:", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'bp_add_cancel' }]]
        }
    });
}

export function registerAddBPNumberFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'addBPNumber');
        if (!session || !msg.text || msg.text.startsWith('/')) return;

        const chatId = msg.chat.id;
        const text = msg.text.trim();

        if (session.stage === 'AWAIT_NUMBERS') {
            const numbers = text.split(',').map(n => n.trim()).filter(n => /^\d{10}$/.test(n));
            if (numbers.length === 0) {
                await bot.sendMessage(chatId, "❌ Invalid input. Please enter 10-digit mobile numbers separated by commas.");
                return;
            }
            session.mobiles = numbers;
            session.stage = 'SELECT_VENDOR';
            setSession(chatId, 'addBPNumber', session);

            const vendors = await getBPVendors();
            const keyboard: TelegramBot.InlineKeyboardButton[][] = vendors.map(v => ([{ text: `🏢 ${v}`, callback_data: `bp_vendor_sel_${v}` }]));
            keyboard.push([{ text: '➕ Add New Vendor', callback_data: 'bp_vendor_sel_new' }]);
            keyboard.push([{ text: '❌ Cancel', callback_data: 'bp_add_cancel' }]);

            await bot.sendMessage(chatId, `✅ Received ${numbers.length} numbers.\n\n*Step 2:* Select Vendor from the list or add a new one:`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        } else if (session.stage === 'AWAIT_NEW_VENDOR_NAME') {
            session.vendorName = text;
            session.stage = 'SELECT_STOCK_TYPE';
            setSession(chatId, 'addBPNumber', session);

            await bot.sendMessage(chatId, `👤 New Vendor: *${text}*\n\nSelect *Stock Type*:`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⭐ Premium Stock', callback_data: 'bp_stock_premium' }],
                        [{ text: '📦 Basic Stock', callback_data: 'bp_stock_basic' }],
                        [{ text: '❌ Cancel', callback_data: 'bp_add_cancel' }]
                    ]
                }
            });
        } else if (session.stage === 'AWAIT_PRICE') {
            const price = parseFloat(text);
            if (isNaN(price)) {
                await bot.sendMessage(chatId, "❌ Invalid price. Please enter a number.");
                return;
            }
            session.purchasePrice = price;
            session.stage = 'AWAIT_SALE_PRICE';
            setSession(chatId, 'addBPNumber', session);

            await bot.sendMessage(chatId, `💰 Purchase Price: ₹${price}\n\nEnter *Intended Sale Price* per number:`, { parse_mode: 'Markdown' });
        } else if (session.stage === 'AWAIT_SALE_PRICE') {
            const salePrice = parseFloat(text);
            if (isNaN(salePrice)) {
                await bot.sendMessage(chatId, "❌ Invalid price. Please enter a number.");
                return;
            }
            session.salePrice = salePrice;
            session.stage = 'CONFIRMATION';
            setSession(chatId, 'addBPNumber', session);

            let confirmText = `🔔 *Confirm Basic/Premium Addition*\n\n`;
            confirmText += `📱 Numbers: ${session.mobiles.join(', ')}\n`;
            confirmText += `🏢 Vendor: ${session.vendorName}\n`;
            confirmText += `📈 Stock Type: ${session.stockType}\n`;
            confirmText += `💰 Purchase Price: ₹${session.purchasePrice} each\n`;
            confirmText += `🏷️ Intended Sale Price: ₹${salePrice} each\n`;
            confirmText += `💵 Total Purchase: ₹${session.purchasePrice * session.mobiles.length}\n\n`;
            confirmText += `Do you want to add these records?`;

            await bot.sendMessage(chatId, confirmText, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Confirm & Add', callback_data: 'bp_add_confirm' }],
                        [{ text: '❌ Cancel', callback_data: 'bp_add_cancel' }]
                    ]
                }
            });
        }
    });

    router.registerCallback(/^bp_vendor_sel_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'addBPNumber');
        if (!session || session.stage !== 'SELECT_VENDOR') return;

        const selection = query.data?.replace('bp_vendor_sel_', '');

        if (selection === 'new') {
            session.stage = 'AWAIT_NEW_VENDOR_NAME';
            setSession(chatId, 'addBPNumber', session);
            await bot.sendMessage(chatId, "📝 Please enter the *New Vendor Name*:", { parse_mode: 'Markdown' });
        } else {
            session.vendorName = selection;
            session.stage = 'SELECT_STOCK_TYPE';
            setSession(chatId, 'addBPNumber', session);
            await bot.sendMessage(chatId, `🏢 Selected Vendor: *${selection}*\n\nSelect *Stock Type*:`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⭐ Premium Stock', callback_data: 'bp_stock_premium' }],
                        [{ text: '📦 Basic Stock', callback_data: 'bp_stock_basic' }],
                        [{ text: '❌ Cancel', callback_data: 'bp_add_cancel' }]
                    ]
                }
            });
        }
    });

    router.registerCallback(/^bp_stock_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'addBPNumber');
        if (!session || session.stage !== 'SELECT_STOCK_TYPE') return;

        const stockType = query.data?.split('_').pop();
        session.stockType = stockType;
        session.stage = 'AWAIT_PRICE';
        setSession(chatId, 'addBPNumber', session);

        await bot.sendMessage(chatId, `📈 Stock Type: *${stockType}*\n\nEnter *Purchase Price* per number:`, { parse_mode: 'Markdown' });
    });

    router.registerCallback('bp_add_confirm', async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'addBPNumber');
        if (!session || session.stage !== 'CONFIRMATION') return;

        session.stage = 'SAVING';
        setSession(chatId, 'addBPNumber', session);

        try {
            await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                chat_id: chatId,
                message_id: query.message!.message_id
            });
        } catch (e) {
            logger.warn('Failed to remove buttons in addBPNumber: ' + (e as Error).message);
        }

        try {
            const profile = await getUserProfile(query.from.username);
            if (!profile?.uid) throw new Error("Could not find your user ID.");

            await bot.sendMessage(chatId, "⏳ Processing... Please wait.");

            const allVendors = await getBPVendors();
            if (!allVendors.includes(session.vendorName)) {
                await addBPVendor({ name: session.vendorName }, profile.uid);
            }

            for (const mobile of session.mobiles) {
                await addBPNumber(session.stockType as 'basic' | 'premium', {
                    mobile,
                    purchaseFrom: session.vendorName,
                    purchasePrice: session.purchasePrice,
                    salePrice: session.salePrice,
                }, profile.uid);
            }
            await bot.sendMessage(chatId, `✅ *Success!*\n\n${session.mobiles.length} Basic/Premium records have been added.`, { parse_mode: 'Markdown' });

            const performedBy = profile?.displayName || query.from.username || 'Unknown';
            await logActivity(bot, {
                employeeName: performedBy,
                action: 'ADD_BASIC_PREMIUM',
                description: `Added ${session.mobiles.length} ${session.stockType} numbers: ${session.mobiles.join(', ')} (Vendor: ${session.vendorName}, Purchase: ₹${session.purchasePrice}, Sale: ₹${session.salePrice})`,
                createdBy: performedBy,
                source: 'BOT',
                groupName: 'BASIC_PREMIUM_NUMBERS'
            }, true);
        } catch (error: any) {
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
        clearSession(chatId, 'addBPNumber');
    });

    router.registerCallback('bp_add_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'addBPNumber');
        await bot.sendMessage(query.message!.chat.id, "Operation cancelled.");
    });
}
