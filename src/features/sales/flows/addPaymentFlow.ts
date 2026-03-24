import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { getSalesVendors, addPaymentRecord } from '../salesService';
import { logActivity } from '../../activities/activityService';
import { CommandRouter } from '../../../core/router/commandRouter';
import { formatToDDMMYYYY, parseFromDDMMYYYY } from '../../../shared/utils/dateUtils';
import { NewPaymentData } from '../../../shared/types/data';

const ADD_PAYMENT_STAGES = {
    SELECT_VENDOR: 'SELECT_VENDOR',
    AWAIT_AMOUNT: 'AWAIT_AMOUNT',
    AWAIT_DATE: 'AWAIT_DATE',
    AWAIT_NOTES: 'AWAIT_NOTES',
    CONFIRM: 'CONFIRM',
} as const;

type AddPaymentSession = {
    stage: keyof typeof ADD_PAYMENT_STAGES;
    data: {
        vendorName?: string;
        amount?: number;
        paymentDate?: Date;
        notes?: string;
    };
};

const cancelBtn = { text: '❌ Cancel', callback_data: 'add_payment_cancel' };

export async function startAddPaymentFlow(bot: TelegramBot, chatId: number) {
    const vendors = await getSalesVendors();
    if (vendors.length === 0) {
        await bot.sendMessage(chatId, "❌ No sales vendors found. Please add vendors first.");
        return;
    }

    setSession(chatId, 'addPayment', {
        stage: 'SELECT_VENDOR',
        data: {}
    });

    const vendorButtons = vendors.map(v => [{ text: v.name, callback_data: `add_pay_vendor_${v.name}` }]);
    vendorButtons.push([cancelBtn]);

    await bot.sendMessage(chatId, "💳 *Add Payment*\n\n*Step 1:* Select Vendor:", {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: vendorButtons }
    });
}

export function registerAddPaymentFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'addPayment') as AddPaymentSession | undefined;
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
            setSession(chatId, 'addPayment', session);

            const today = formatToDDMMYYYY(new Date());
            await bot.sendMessage(chatId, `💰 *Amount:* ₹${amount}\n\n*Step 3:* Enter Payment Date (DD/MM/YYYY) or send 'today':`, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `Today (${today})`, callback_data: 'add_pay_date_today' }],
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
            setSession(chatId, 'addPayment', session);

            await bot.sendMessage(chatId, `📅 *Date:* ${formatToDDMMYYYY(date)}\n\n*Step 4:* Enter any Notes (or send 'nil' to skip):`, {
                reply_markup: { inline_keyboard: [[{ text: '⏭ Skip Notes', callback_data: 'add_pay_notes_skip' }], [cancelBtn]] }
            });
        } else if (session.stage === 'AWAIT_NOTES') {
            const notes = msg.text.trim().toLowerCase() === 'nil' ? '' : msg.text.trim();
            session.data.notes = notes;
            session.stage = 'CONFIRM';
            setSession(chatId, 'addPayment', session);

            const d = session.data;
            const summary = `✅ *Payment Summary*\n\n` +
                `🏢 *Vendor:* ${d.vendorName}\n` +
                `💰 *Amount:* ₹${d.amount?.toLocaleString()}\n` +
                `📅 *Date:* ${formatToDDMMYYYY(d.paymentDate!)}\n` +
                `📝 *Notes:* ${d.notes || 'None'}\n\n` +
                `*Confirm to save?*`;

            await bot.sendMessage(chatId, summary, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Confirm & Save', callback_data: 'add_pay_confirm' }],
                        [cancelBtn]
                    ]
                }
            });
        }
    });

    router.registerCallback(/^add_pay_vendor_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'addPayment') as AddPaymentSession | undefined;
        if (!session || session.stage !== 'SELECT_VENDOR') return;

        const vendorName = query.data?.replace('add_pay_vendor_', '');
        session.data.vendorName = vendorName;
        session.stage = 'AWAIT_AMOUNT';
        setSession(chatId, 'addPayment', session);

        await bot.sendMessage(chatId, `🏢 *Vendor:* ${vendorName}\n\n*Step 2:* Please enter the payment amount:`, {
            reply_markup: { inline_keyboard: [[cancelBtn]] }
        });
    });

    router.registerCallback('add_pay_date_today', async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'addPayment') as AddPaymentSession | undefined;
        if (!session || session.stage !== 'AWAIT_DATE') return;

        session.data.paymentDate = new Date();
        session.stage = 'AWAIT_NOTES';
        setSession(chatId, 'addPayment', session);

        await bot.sendMessage(chatId, `📅 *Date:* ${formatToDDMMYYYY(new Date())}\n\n*Step 4:* Enter any Notes (or send 'nil' to skip):`, {
            reply_markup: { inline_keyboard: [[{ text: '⏭ Skip Notes', callback_data: 'add_pay_notes_skip' }], [cancelBtn]] }
        });
    });

    router.registerCallback('add_pay_notes_skip', async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'addPayment') as AddPaymentSession | undefined;
        if (!session || session.stage !== 'AWAIT_NOTES') return;

        session.data.notes = '';
        session.stage = 'CONFIRM';
        setSession(chatId, 'addPayment', session);

        const d = session.data;
        const summary = `✅ *Payment Summary*\n\n` +
            `🏢 *Vendor:* ${d.vendorName}\n` +
            `💰 *Amount:* ₹${d.amount?.toLocaleString()}\n` +
            `📅 *Date:* ${formatToDDMMYYYY(d.paymentDate!)}\n` +
            `📝 *Notes:* None\n\n` +
            `*Confirm to save?*`;

        await bot.sendMessage(chatId, summary, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Confirm & Save', callback_data: 'add_pay_confirm' }],
                    [cancelBtn]
                ]
            }
        });
    });

    router.registerCallback('add_pay_confirm', async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'addPayment') as AddPaymentSession | undefined;
        if (!session || session.stage !== 'CONFIRM') return;

        try {
            const creator = query.from.first_name + (query.from.last_name ? ' ' + query.from.last_name : '');
            await addPaymentRecord(session.data as any, creator);

            await bot.sendMessage(chatId, "✅ *Payment Recorded Successfully!*", { parse_mode: 'Markdown' });

            // Log Activity
            await logActivity(bot, {
                employeeName: creator,
                action: 'PARTNERS',
                description: `Received payment of ₹${session.data.amount?.toLocaleString()} from ${session.data.vendorName}.`,
                createdBy: creator,
                source: 'BOT',
                groupName: 'PARTNERS'
            }, true);

            clearSession(chatId, 'addPayment');
        } catch (error: any) {
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            clearSession(chatId, 'addPayment');
        }
    });

    router.registerCallback('add_payment_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'addPayment');
        await bot.sendMessage(query.message!.chat.id, "❌ Payment flow cancelled.");
    });
}
