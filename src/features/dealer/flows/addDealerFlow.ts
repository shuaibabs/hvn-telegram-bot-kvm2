import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { addDealerPurchaseStep, getDealers, addDealer } from '../dealerService';
import { isAdmin, getUserProfile } from '../../../core/auth/permissions';
import { CommandRouter } from '../../../core/router/commandRouter';
import { logger } from '../../../core/logger/logger';
import { logActivity } from '../../activities/activityService';

export async function startAddDealerFlow(bot: TelegramBot, chatId: number, username?: string) {
    setSession(chatId, 'addDealer', { stage: 'AWAIT_NUMBERS' });

    await bot.sendMessage(chatId, "➕ *Add Dealer Purchase*\n\nPlease enter the mobile number(s). You can enter a single number or multiple numbers separated by commas:", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'dealer_add_cancel' }]]
        }
    });
}

export function registerAddDealerFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'addDealer');
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
            session.stage = 'SELECT_DEALER';
            setSession(chatId, 'addDealer', session);

            const dealers = await getDealers();
            const keyboard: TelegramBot.InlineKeyboardButton[][] = dealers.map(d => ([{ text: `🏢 ${d}`, callback_data: `dealer_sel_${d}` }]));
            keyboard.push([{ text: '➕ Add New Dealer', callback_data: 'dealer_sel_new' }]);
            keyboard.push([{ text: '❌ Cancel', callback_data: 'dealer_add_cancel' }]);

            await bot.sendMessage(chatId, `✅ Received ${numbers.length} numbers.\n\n*Step 2:* Select Dealer from the list or add a new one:`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        } else if (session.stage === 'AWAIT_NEW_DEALER_NAME') {
            session.dealerName = text;
            session.stage = 'AWAIT_PRICE';
            setSession(chatId, 'addDealer', session);

            await bot.sendMessage(chatId, `👤 New Dealer: *${text}*\n\nEnter *Purchase Price* per number:`, { parse_mode: 'Markdown' });
        } else if (session.stage === 'AWAIT_PRICE') {
            const price = parseFloat(text);
            if (isNaN(price)) {
                await bot.sendMessage(chatId, "❌ Invalid price. Please enter a number.");
                return;
            }
            session.price = price;
            session.stage = 'CONFIRMATION';
            setSession(chatId, 'addDealer', session);

            let confirmText = `🔔 *Confirm Dealer Purchase*\n\n`;
            confirmText += `📱 Numbers: ${session.mobiles.join(', ')}\n`;
            confirmText += `👤 Dealer: ${session.dealerName}\n`;
            confirmText += `💰 Price: ₹${price} each\n`;
            confirmText += `💵 Total: ₹${price * session.mobiles.length}\n\n`;
            confirmText += `Do you want to add these records?`;

            await bot.sendMessage(chatId, confirmText, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Confirm & Add', callback_data: 'dealer_add_confirm' }],
                        [{ text: '❌ Cancel', callback_data: 'dealer_add_cancel' }]
                    ]
                }
            });
        }
    });

    router.registerCallback(/^dealer_sel_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'addDealer');
        if (!session || session.stage !== 'SELECT_DEALER') return;

        const selection = query.data?.replace('dealer_sel_', '');
        
        if (selection === 'new') {
            session.stage = 'AWAIT_NEW_DEALER_NAME';
            setSession(chatId, 'addDealer', session);
            await bot.sendMessage(chatId, "📝 Please enter the *New Dealer Name*:", { parse_mode: 'Markdown' });
        } else {
            session.dealerName = selection;
            session.stage = 'AWAIT_PRICE';
            setSession(chatId, 'addDealer', session);
            await bot.sendMessage(chatId, `🏢 Selected Dealer: *${selection}*\n\nEnter *Purchase Price* per number:`, { parse_mode: 'Markdown' });
        }
    });

    router.registerCallback('dealer_add_confirm', async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'addDealer');
        if (!session) return;

        try {
            const profile = await getUserProfile(query.from.username);
            if (!profile?.uid) throw new Error("Could not find your user ID.");

            await bot.sendMessage(chatId, "⏳ Processing... Please wait.");
            
            // Register dealer if new
            const allDealers = await getDealers();
            if (!allDealers.includes(session.dealerName)) {
                await addDealer({ name: session.dealerName }, profile.uid);
            }

            for (const mobile of session.mobiles) {
                await addDealerPurchaseStep({
                    mobile,
                    dealerName: session.dealerName,
                    price: session.price
                }, profile.uid);
            }
            await bot.sendMessage(chatId, `✅ *Success!*\n\n${session.mobiles.length} dealer purchase records have been added.`, { parse_mode: 'Markdown' });

            const performedBy = profile?.displayName || query.from.username || 'Unknown';
            // Log Activity
            await logActivity(bot, {
                employeeName: performedBy,
                action: 'ADD_DEALER_PURCHASE',
                description: `Added dealer purchase for ${session.mobiles.length} numbers: ${session.mobiles.join(', ')} (Dealer: ${session.dealerName}, Price: ₹${session.price})`,
                createdBy: performedBy,
                source: 'BOT',
                groupName: 'DEALER_PURCHASES'
            }, true);
        } catch (error: any) {
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
        clearSession(chatId, 'addDealer');
    });

    router.registerCallback('dealer_add_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'addDealer');
        await bot.sendMessage(query.message!.chat.id, "Operation cancelled.");
    });
}
