import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { getDealers, addDealerPaymentRecord } from '../dealerService';
import { logActivity } from '../../activities/activityService';
import { CommandRouter } from '../../../core/router/commandRouter';
import { formatToDDMMYYYY, parseFromDDMMYYYY } from '../../../shared/utils/dateUtils';

const ADD_DEALER_PAYMENT_STAGES = {
    SELECT_DEALER: 'SELECT_DEALER',
    AWAIT_AMOUNT: 'AWAIT_AMOUNT',
    AWAIT_DATE: 'AWAIT_DATE',
    AWAIT_NOTES: 'AWAIT_NOTES',
    CONFIRM: 'CONFIRM',
    SAVING: 'SAVING',
} as const;

type AddDealerPaymentSession = {
    stage: keyof typeof ADD_DEALER_PAYMENT_STAGES;
    data: {
        vendorName?: string;
        amount?: number;
        paymentDate?: Date;
        notes?: string;
    };
};

const cancelBtn = { text: '❌ Cancel', callback_data: 'add_dealer_pay_cancel' };

export async function startAddDealerPaymentFlow(bot: TelegramBot, chatId: number) {
    const dealers = await getDealers();
    if (dealers.length === 0) {
        await bot.sendMessage(chatId, "❌ No dealers found in purchase records.");
        return;
    }

    setSession(chatId, 'addDealerPayment', {
        stage: 'SELECT_DEALER',
        data: {}
    });

    const dealerButtons = dealers.map(d => [{ text: d, callback_data: `add_d_pay_dealer_${d}` }]);
    dealerButtons.push([cancelBtn]);

    await bot.sendMessage(chatId, "💳 *Record Dealer Payment*\n\n*Step 1:* Select Dealer:", {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: dealerButtons }
    });
}

export function registerAddDealerPaymentFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'addDealerPayment') as AddDealerPaymentSession | undefined;
        if (!session || !msg.text || msg.text.startsWith('/')) return;

        const chatId = msg.chat.id;

        if (session.stage === 'AWAIT_AMOUNT') {
            const amount = parseFloat(msg.text.trim());
            if (isNaN(amount) || amount <= 0) {
                await bot.sendMessage(chatId, "⚠️ Please enter a valid positive amount.");
                return;
            }

            session.data.amount = amount;
            session.stage = 'AWAIT_DATE';
            setSession(chatId, 'addDealerPayment', session);

            const today = formatToDDMMYYYY(new Date());
            await bot.sendMessage(chatId, `💰 *Amount:* ₹${amount}\n\n*Step 3:* Enter Payment Date (DD/MM/YYYY) or send 'today':`, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `Today (${today})`, callback_data: 'add_d_pay_date_today' }],
                        [cancelBtn]
                    ]
                }
            });
        } else if (session.stage === 'AWAIT_DATE') {
            const date = parseFromDDMMYYYY(msg.text.trim());
            if (!date) {
                await bot.sendMessage(chatId, "⚠️ Invalid date format. Please use DD/MM/YYYY or use the button for today.");
                return;
            }

            session.data.paymentDate = date;
            session.stage = 'AWAIT_NOTES';
            setSession(chatId, 'addDealerPayment', session);

            await bot.sendMessage(chatId, `📅 *Date:* ${formatToDDMMYYYY(date)}\n\n*Step 4:* Enter any Notes (or send 'nil' to skip):`, {
                reply_markup: { inline_keyboard: [[{ text: '⏭ Skip Notes', callback_data: 'add_d_pay_notes_skip' }], [cancelBtn]] }
            });
        } else if (session.stage === 'AWAIT_NOTES') {
            const notes = msg.text.trim().toLowerCase() === 'nil' ? '' : msg.text.trim();
            session.data.notes = notes;
            session.stage = 'CONFIRM';
            setSession(chatId, 'addDealerPayment', session);

            const d = session.data;
            const summary = `✅ *Dealer Payment Summary*\n\n` +
                `🏢 *Dealer:* ${d.vendorName}\n` +
                `💰 *Amount:* ₹${d.amount?.toLocaleString()}\n` +
                `📅 *Date:* ${formatToDDMMYYYY(d.paymentDate!)}\n` +
                `📝 *Notes:* ${d.notes || 'None'}\n\n` +
                `*Confirm to save?*`;

            await bot.sendMessage(chatId, summary, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Confirm & Save', callback_data: 'add_d_pay_confirm' }],
                        [cancelBtn]
                    ]
                }
            });
        }
    });

    router.registerCallback(/^add_d_pay_dealer_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'addDealerPayment') as AddDealerPaymentSession | undefined;
        if (!session || session.stage !== 'SELECT_DEALER') return;

        const dealerName = query.data?.replace('add_d_pay_dealer_', '');
        session.data.vendorName = dealerName;
        session.stage = 'AWAIT_AMOUNT';
        setSession(chatId, 'addDealerPayment', session);

        await bot.sendMessage(chatId, `🏢 *Dealer:* ${dealerName}\n\n*Step 2:* Please enter the payment amount:`, {
            reply_markup: { inline_keyboard: [[cancelBtn]] }
        });
    });

    router.registerCallback('add_d_pay_date_today', async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'addDealerPayment') as AddDealerPaymentSession | undefined;
        if (!session || session.stage !== 'AWAIT_DATE') return;

        session.data.paymentDate = new Date();
        session.stage = 'AWAIT_NOTES';
        setSession(chatId, 'addDealerPayment', session);

        await bot.sendMessage(chatId, `📅 *Date:* ${formatToDDMMYYYY(new Date())}\n\n*Step 4:* Enter any Notes (or send 'nil' to skip):`, {
            reply_markup: { inline_keyboard: [[{ text: '⏭ Skip Notes', callback_data: 'add_d_pay_notes_skip' }], [cancelBtn]] }
        });
    });

    router.registerCallback('add_d_pay_notes_skip', async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'addDealerPayment') as AddDealerPaymentSession | undefined;
        if (!session || session.stage !== 'AWAIT_NOTES') return;

        session.data.notes = '';
        session.stage = 'CONFIRM';
        setSession(chatId, 'addDealerPayment', session);

        const d = session.data;
        const summary = `✅ *Dealer Payment Summary*\n\n` +
            `🏢 *Dealer:* ${d.vendorName}\n` +
            `💰 *Amount:* ₹${d.amount?.toLocaleString()}\n` +
            `📅 *Date:* ${formatToDDMMYYYY(d.paymentDate!)}\n` +
            `📝 *Notes:* None\n\n` +
            `*Confirm to save?*`;

        await bot.sendMessage(chatId, summary, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Confirm & Save', callback_data: 'add_d_pay_confirm' }],
                    [cancelBtn]
                ]
            }
        });
    });

    router.registerCallback('add_d_pay_confirm', async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'addDealerPayment') as AddDealerPaymentSession | undefined;
        if (!session || session.stage !== 'CONFIRM') return;

        // Lock session
        session.stage = 'SAVING';
        setSession(chatId, 'addDealerPayment', session);

        // Remove buttons
        try {
            await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                chat_id: chatId,
                message_id: query.message!.message_id
            });
        } catch (e) {
            logger.warn('Failed to remove buttons in addDealerPayment: ' + (e as Error).message);
        }

        try {
            const creator = query.from.first_name + (query.from.last_name ? ' ' + query.from.last_name : '');
            await addDealerPaymentRecord(session.data as any, creator);

            await bot.sendMessage(chatId, "✅ *Dealer Payment Recorded Successfully!*", { parse_mode: 'Markdown' });

            // Log Activity
            await logActivity(bot, {
                employeeName: creator,
                action: 'Recorded Payment',
                description: `Paid ₹${session.data.amount?.toLocaleString()} to dealer ${session.data.vendorName}.`,
                createdBy: creator,
                source: 'BOT',
                groupName: 'DEALER_PURCHASES'
            }, true);

            clearSession(chatId, 'addDealerPayment');
        } catch (error: any) {
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            clearSession(chatId, 'addDealerPayment');
        }
    });

    router.registerCallback('add_dealer_pay_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'addDealerPayment');
        await bot.sendMessage(query.message!.chat.id, "❌ Dealer payment flow cancelled.");
    });
}
