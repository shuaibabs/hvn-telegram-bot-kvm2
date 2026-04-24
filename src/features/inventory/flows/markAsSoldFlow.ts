import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { validateNumbersExistence, markAsSoldBatch, getExistingVendors, addNewVendor } from '../inventoryService';
import { logActivity } from '../../activities/activityService';
import { CommandRouter } from '../../../core/router/commandRouter';
import { formatToDDMMYYYY, parseFromDDMMYYYY } from '../../../shared/utils/dateUtils';

const MARK_AS_SOLD_STAGES = {
    AWAIT_NUMBERS: 'AWAIT_NUMBERS',
    AWAIT_SALE_PRICE: 'AWAIT_SALE_PRICE',
    AWAIT_VENDOR: 'AWAIT_VENDOR',
    AWAIT_SALE_DATE: 'AWAIT_SALE_DATE',
    AWAIT_REMARK: 'AWAIT_REMARK',
    AWAIT_SALE_REASON: 'AWAIT_SALE_REASON',
    CONFIRM: 'CONFIRM',
    SAVING: 'SAVING',
} as const;

type MarkAsSoldSession = {
    stage: keyof typeof MARK_AS_SOLD_STAGES;
    data: {
        numbers: string[];
        salePrice: number;
        soldTo: string;
        saleDate: Date;
        remark: string;
        saleReason: string;
    };
};

const cancelBtn = { text: '❌ Cancel', callback_data: 'sold_cancel' };

export async function startMarkAsSoldFlow(bot: TelegramBot, chatId: number) {
    setSession(chatId, 'markAsSold', {
        stage: 'AWAIT_NUMBERS',
        data: {
            numbers: [],
            salePrice: 0,
            soldTo: '',
            saleDate: new Date(),
            remark: '',
            saleReason: ''
        }
    });

    await bot.sendMessage(chatId, "💰 *Mark Number(s) as Sold*\n\n*Step 1:* Please enter one or more 10-digit mobile numbers separated by comma or new line.", {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[cancelBtn]] }
    });
}

export function registerMarkAsSoldFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'markAsSold') as MarkAsSoldSession | undefined;
        if (!session || !msg.text || msg.text.startsWith('/')) return;

        const chatId = msg.chat.id;

        switch (session.stage) {
            case 'AWAIT_NUMBERS': {
                const numbers = msg.text.split(/[\n,]+/).map(n => n.trim().replace(/\D/g, '')).filter(n => n.length === 10);
                if (numbers.length === 0) {
                    await bot.sendMessage(chatId, "❌ No valid 10-digit numbers found. Please try again.");
                    return;
                }

                const { existing, missing } = await validateNumbersExistence(numbers);
                if (existing.length === 0) {
                    await bot.sendMessage(chatId, `❌ None of the provided numbers exist in the inventory.\n\n*Rejected:* ${missing.join(', ')}`, { parse_mode: 'Markdown' });
                    clearSession(chatId, 'markAsSold');
                    return;
                }

                session.data.numbers = existing;
                session.stage = 'AWAIT_SALE_PRICE';
                setSession(chatId, 'markAsSold', session);

                let statusMsg = `✅ Found ${existing.length} number(s).`;
                if (missing.length > 0) statusMsg += `\n⚠️ Rejected (not found): ${missing.length}`;

                await bot.sendMessage(chatId, `${statusMsg}\n\n*Step 2:* Enter the Sale Price (per number):`, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[cancelBtn]] }
                });
                break;
            }

            case 'AWAIT_SALE_PRICE': {
                const price = parseFloat(msg.text.trim());
                if (isNaN(price) || price < 0) {
                    await bot.sendMessage(chatId, "❌ Invalid price. Please enter a positive number.");
                    return;
                }
                session.data.salePrice = price;
                session.stage = 'AWAIT_VENDOR';
                setSession(chatId, 'markAsSold', session);

                const vendors = await getExistingVendors();
                const inline_keyboard = vendors.map(v => ([{ text: v, callback_data: `sold_vd_${v}` }]));
                inline_keyboard.push([{ text: '➕ Enter New Vendor Name', callback_data: 'sold_vd_new' }]);
                inline_keyboard.push([cancelBtn]);

                await bot.sendMessage(chatId, "*Step 3:* Select or enter the Vendor (Buyer) name:", {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard }
                });
                break;
            }

            case 'AWAIT_VENDOR': {
                session.data.soldTo = msg.text.trim();
                session.stage = 'AWAIT_SALE_DATE';
                setSession(chatId, 'markAsSold', session);

                const today = formatToDDMMYYYY(new Date());
                await bot.sendMessage(chatId, `*Step 4:* Enter Sale Date (DD/MM/YYYY):\n(Leave blank or type 'today' for ${today})`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `📅 Today (${today})`, callback_data: 'sold_date_today' }],
                            [cancelBtn]
                        ]
                    }
                });
                break;
            }

            case 'AWAIT_SALE_DATE': {
                let dateStr = msg.text.trim().toLowerCase();
                let date = new Date();
                if (dateStr !== 'today' && dateStr !== '') {
                    date = parseFromDDMMYYYY(dateStr) || new Date();
                    if (dateStr !== 'today' && dateStr !== '' && !parseFromDDMMYYYY(dateStr)) {
                        await bot.sendMessage(chatId, "❌ Invalid date format. Use DD/MM/YYYY.");
                        return;
                    }
                }
                session.data.saleDate = date;
                session.stage = 'AWAIT_REMARK';
                setSession(chatId, 'markAsSold', session);
                
                await bot.sendMessage(chatId, "*Step 5:* Enter any Remark/Notes for this sale (or type 'none' to skip):", {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[cancelBtn]] }
                });
                break;
            }

            case 'AWAIT_REMARK': {
                const remark = msg.text.trim();
                session.data.remark = (remark.toLowerCase() === 'none') ? '' : remark;
                session.stage = 'AWAIT_SALE_REASON';
                setSession(chatId, 'markAsSold', session);
                
                await bot.sendMessage(chatId, "*Step 6:* Enter the Reason of Sales (or type 'none' to skip):", {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[cancelBtn]] }
                });
                break;
            }

            case 'AWAIT_SALE_REASON': {
                const saleReason = msg.text.trim();
                session.data.saleReason = (saleReason.toLowerCase() === 'none') ? '' : saleReason;
                session.stage = 'CONFIRM';
                setSession(chatId, 'markAsSold', session);
                await showSoldConfirmation(bot, chatId, session);
                break;
            }
        }
    });

    router.registerCallback(/^sold_vd_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'markAsSold') as MarkAsSoldSession | undefined;
        if (!session || session.stage !== 'AWAIT_VENDOR') return;

        const val = query.data?.replace('sold_vd_', '');
        if (val === 'new') {
            await bot.sendMessage(chatId, "Please type the new Vendor name:");
            return;
        }

        session.data.soldTo = val!;
        session.stage = 'AWAIT_SALE_DATE';
        setSession(chatId, 'markAsSold', session);

        const today = formatToDDMMYYYY(new Date());
        await bot.sendMessage(chatId, `*Step 4:* Enter Sale Date (DD/MM/YYYY):\n(Leave blank or type 'today' for ${today})`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `📅 Today (${today})`, callback_data: 'sold_date_today' }],
                    [cancelBtn]
                ]
            }
        });
    });

    router.registerCallback('sold_date_today', async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'markAsSold') as MarkAsSoldSession | undefined;
        if (!session || session.stage !== 'AWAIT_SALE_DATE') return;

        session.data.saleDate = new Date();
        session.stage = 'AWAIT_REMARK';
        setSession(chatId, 'markAsSold', session);
        await bot.sendMessage(chatId, "*Step 5:* Enter any Remark/Notes for this sale (or type 'none' to skip):", {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[cancelBtn]] }
        });
    });

    router.registerCallback('sold_confirm', async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'markAsSold') as MarkAsSoldSession | undefined;
        if (!session || session.stage !== 'CONFIRM') return;

        // Lock session
        session.stage = 'SAVING';
        setSession(chatId, 'markAsSold', session);

        // Remove buttons
        try {
            await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                chat_id: chatId,
                message_id: query.message!.message_id
            });
        } catch (e) {
            logger.warn('Failed to remove buttons in markAsSold: ' + (e as Error).message);
        }

        try {
            const creator = query.from.first_name + (query.from.last_name ? ' ' + query.from.last_name : '');

            await addNewVendor(session.data.soldTo, query.from.id.toString());

            const result = await markAsSoldBatch(session.data.numbers, {
                salePrice: session.data.salePrice,
                soldTo: session.data.soldTo,
                saleDate: session.data.saleDate,
                remark: session.data.remark,
                saleReason: session.data.saleReason
            }, query.from.id.toString(), creator);

            await bot.sendMessage(chatId, `✅ *Numbers Marked as Sold!*\n\nSuccessfully moved ${result.successCount} number(s) to Sales.`, { parse_mode: 'Markdown' });

            // Log Activity
            await logActivity(bot, {
                employeeName: creator,
                action: result.successCount > 1 ? 'Bulk Sold Numbers' : 'Sold Number',
                description: `Marked ${result.successCount} numbers as Sold to ${session.data.soldTo} for ₹${session.data.salePrice} each.\nNumbers: ${session.data.numbers.join(', ')}`,
                createdBy: creator,
                source: 'BOT',
                groupName: 'SALES'
            }, true);

            clearSession(chatId, 'markAsSold');
        } catch (error: any) {
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            clearSession(chatId, 'markAsSold');
        }
    });

    router.registerCallback('sold_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'markAsSold');
        await bot.sendMessage(query.message!.chat.id, "❌ Mark as Sold flow cancelled.");
    });
}

async function showSoldConfirmation(bot: TelegramBot, chatId: number, session: MarkAsSoldSession) {
    const summary = `*Confirm Mark as Sold*\n\n` +
        `📱 *Numbers:* ${session.data.numbers.join(', ')}\n` +
        `💰 *Sale Price:* ₹${session.data.salePrice}\n` +
        `👤 *Sold To:* ${session.data.soldTo}\n` +
        `📅 *Sale Date:* ${formatToDDMMYYYY(session.data.saleDate)}\n` +
        `📝 *Remark:* ${session.data.remark || 'N/A'}\n` +
        `🏷️ *Reason of Sales:* ${session.data.saleReason || 'N/A'}\n\n` +
        `*Move these numbers to Sales collection?*`;

    await bot.sendMessage(chatId, summary, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '✅ Confirm & Move to Sales', callback_data: 'sold_confirm' }],
                [cancelBtn]
            ]
        }
    });
}
