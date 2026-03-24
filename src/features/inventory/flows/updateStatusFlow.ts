import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { escapeMarkdown } from '../../../shared/utils/telegram';
import { NumberRecord } from '../../../shared/types/data';
import { validateNumbersExistence, updateNumbersStatusBatch } from '../inventoryService';
import { logActivity } from '../../activities/activityService';
import { CommandRouter } from '../../../core/router/commandRouter';
import { formatToDDMMYYYY, parseFromDDMMYYYY } from '../../../shared/utils/dateUtils';

const UPDATE_STATUS_STAGES = {
    AWAIT_UPDATE_TYPE: 'AWAIT_UPDATE_TYPE',
    AWAIT_NUMBERS: 'AWAIT_NUMBERS',
    AWAIT_RTP_STATUS: 'AWAIT_RTP_STATUS',
    AWAIT_RTP_DATE: 'AWAIT_RTP_DATE',
    AWAIT_UPLOAD_STATUS: 'AWAIT_UPLOAD_STATUS',
    AWAIT_LOCATION_TYPE: 'AWAIT_LOCATION_TYPE',
    AWAIT_NEW_LOCATION: 'AWAIT_NEW_LOCATION',
    AWAIT_SALE_PRICE: 'AWAIT_SALE_PRICE',
    CONFIRM: 'CONFIRM',
} as const;

type UpdateStatusSession = {
    stage: keyof typeof UPDATE_STATUS_STAGES;
    data: {
        numbers: string[];
        updateType?: 'RTP' | 'Upload' | 'Location' | 'SalePrice';
        updates: Partial<NumberRecord>;
    };
};

const cancelBtn = { text: '❌ Cancel', callback_data: 'update_status_cancel' };

export async function startUpdateStatusFlow(bot: TelegramBot, chatId: number) {
    setSession(chatId, 'updateStatus', {
        stage: 'AWAIT_UPDATE_TYPE',
        data: {
            numbers: [],
            updates: {}
        }
    });

    await bot.sendMessage(chatId, "🔄 *Update Number(s) Status*\n\n*Step 1:* What would you like to update?", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Update RTP status', callback_data: 'upd_stat_type_RTP' }],
                [{ text: 'Edit Upload status', callback_data: 'upd_stat_type_Upload' }],
                [{ text: 'Edit Location', callback_data: 'upd_stat_type_Location' }],
                [{ text: 'Update Sale Price', callback_data: 'upd_stat_type_SalePrice' }],
                [cancelBtn]
            ]
        }
    });
}

const parseDate = parseFromDDMMYYYY;

export function registerUpdateStatusFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'updateStatus') as UpdateStatusSession | undefined;
        if (!session || !msg.text || msg.text.startsWith('/')) return;

        const chatId = msg.chat.id;

        switch (session.stage) {
            case 'AWAIT_NUMBERS': {
                const numbers = msg.text.split(/[\n,]+/).map(n => n.trim().replace(/\D/g, '')).filter(n => n.length === 10);
                if (numbers.length === 0) {
                    await bot.sendMessage(chatId, "❌ No valid 10-digit numbers found. Please try again.");
                    return;
                }

                // Validate existence
                const { existing, missing } = await validateNumbersExistence(numbers);
                if (existing.length === 0) {
                    await bot.sendMessage(chatId, `❌ None of the provided numbers exist in the inventory.\n\n*Rejected:* ${missing.join(', ')}`, { parse_mode: 'Markdown' });
                    clearSession(chatId, 'updateStatus');
                    return;
                }

                session.data.numbers = existing;

                let statusMsg = `✅ Found ${existing.length} number(s).`;
                if (missing.length > 0) {
                    statusMsg += `\n⚠️ Rejected (not found): ${missing.length}`;
                }
                await bot.sendMessage(chatId, statusMsg, { parse_mode: 'Markdown' });

                // Go to next sub-stage based on updateType
                if (session.data.updateType === 'RTP') {
                    session.stage = 'AWAIT_RTP_STATUS';
                    setSession(chatId, 'updateStatus', session);
                    await bot.sendMessage(chatId, "*Update RTP status:* Select new status:", {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: 'RTP', callback_data: 'upd_stat_rtp_RTP' }, { text: 'Non-RTP', callback_data: 'upd_stat_rtp_Non-RTP' }],
                                [cancelBtn]
                            ]
                        }
                    });
                } else if (session.data.updateType === 'Upload') {
                    session.stage = 'AWAIT_UPLOAD_STATUS';
                    setSession(chatId, 'updateStatus', session);
                    await bot.sendMessage(chatId, "*Edit Upload status:* Select new status:", {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: 'Pending', callback_data: 'upd_stat_upload_Pending' }, { text: 'Done', callback_data: 'upd_stat_upload_Done' }],
                                [cancelBtn]
                            ]
                        }
                    });
                } else if (session.data.updateType === 'Location') {
                    session.stage = 'AWAIT_LOCATION_TYPE';
                    setSession(chatId, 'updateStatus', session);
                    await bot.sendMessage(chatId, "*Edit Location:* Select location type:", {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: 'Store', callback_data: 'upd_stat_loc_Store' },
                                    { text: 'Employee', callback_data: 'upd_stat_loc_Employee' },
                                    { text: 'Dealer', callback_data: 'upd_stat_loc_Dealer' }
                                ],
                                [cancelBtn]
                            ]
                        }
                    });
                } else if (session.data.updateType === 'SalePrice') {
                    session.stage = 'AWAIT_SALE_PRICE';
                    setSession(chatId, 'updateStatus', session);
                    await bot.sendMessage(chatId, "*Update Sale Price:* Please enter the new sale price:", {
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [[cancelBtn]] }
                    });
                }
                break;
            }

            case 'AWAIT_RTP_DATE': {
                let dateStr = msg.text.trim().toLowerCase();
                let rDate: Date | null;
                
                if (dateStr === 'today') {
                    rDate = new Date();
                } else {
                    rDate = parseDate(msg.text);
                }
 
                if (!rDate) {
                    await bot.sendMessage(chatId, "❌ Invalid date format. Use DD/MM/YYYY.");
                    return;
                }
                session.data.updates.rtpDate = rDate as any;
                session.stage = 'CONFIRM';
                setSession(chatId, 'updateStatus', session);
                await showConfirmation(bot, chatId, session);
                break;
            }

            case 'AWAIT_NEW_LOCATION': {
                session.data.updates.currentLocation = msg.text.trim();
                session.stage = 'CONFIRM';
                setSession(chatId, 'updateStatus', session);
                await showConfirmation(bot, chatId, session);
                break;
            }

            case 'AWAIT_SALE_PRICE': {
                const price = parseFloat(msg.text.trim());
                if (isNaN(price) || price < 0) {
                    await bot.sendMessage(chatId, "❌ Invalid price. Please enter a positive number.");
                    return;
                }
                session.data.updates.salePrice = price;
                session.stage = 'CONFIRM';
                setSession(chatId, 'updateStatus', session);
                await showConfirmation(bot, chatId, session);
                break;
            }
        }
    });

    router.registerCallback(/^upd_stat_type_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'updateStatus') as UpdateStatusSession | undefined;
        if (!session || session.stage !== 'AWAIT_UPDATE_TYPE') return;

        const type = query.data?.split('_').pop() as any;
        session.data.updateType = type;
        session.stage = 'AWAIT_NUMBERS';
        setSession(chatId, 'updateStatus', session);

        const typeLabels: any = {
            'RTP': 'RTP Status',
            'Upload': 'Upload Status',
            'Location': 'Location',
            'SalePrice': 'Sale Price'
        };

        await bot.sendMessage(chatId, `🔄 Selected: *${typeLabels[type]} Update*\n\n*Step 2:* Please enter one or more 10-digit mobile numbers separated by comma or new line.`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[cancelBtn]] }
        });
    });

    router.registerCallback(/^upd_stat_rtp_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'updateStatus') as UpdateStatusSession | undefined;
        if (!session || session.stage !== 'AWAIT_RTP_STATUS') return;

        const val = query.data?.split('_').pop() as any;
        session.data.updates.status = val;

        if (val === 'Non-RTP') {
            session.stage = 'AWAIT_RTP_DATE';
            setSession(chatId, 'updateStatus', session);
            const today = formatToDDMMYYYY(new Date());
            await bot.sendMessage(chatId, `Please enter RTP Date (DD/MM/YYYY):\n(Type 'today' for ${today})`, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `📅 Today (${today})`, callback_data: 'upd_stat_date_rtp_today' }],
                        [cancelBtn]
                    ]
                }
            });
        } else {
            session.stage = 'CONFIRM';
            setSession(chatId, 'updateStatus', session);
            await showConfirmation(bot, chatId, session);
        }
    });

    router.registerCallback('upd_stat_date_rtp_today', async (query: TelegramBot.CallbackQuery) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'updateStatus') as UpdateStatusSession | undefined;
        if (!session || session.stage !== 'AWAIT_RTP_DATE') return;

        session.data.updates.rtpDate = new Date() as any;
        session.stage = 'CONFIRM';
        setSession(chatId, 'updateStatus', session);
        await showConfirmation(bot, chatId, session);
    });

    router.registerCallback(/^upd_stat_upload_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'updateStatus') as UpdateStatusSession | undefined;
        if (!session || session.stage !== 'AWAIT_UPLOAD_STATUS') return;

        session.data.updates.uploadStatus = query.data?.split('_').pop() as any;
        session.stage = 'CONFIRM';
        setSession(chatId, 'updateStatus', session);
        await showConfirmation(bot, chatId, session);
    });

    router.registerCallback(/^upd_stat_loc_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'updateStatus') as UpdateStatusSession | undefined;
        if (!session || session.stage !== 'AWAIT_LOCATION_TYPE') return;

        session.data.updates.locationType = query.data?.split('_').pop() as any;
        session.stage = 'AWAIT_NEW_LOCATION';
        setSession(chatId, 'updateStatus', session);
        await bot.sendMessage(chatId, "Please enter the New Current Location:", {
            reply_markup: { inline_keyboard: [[cancelBtn]] }
        });
    });

    router.registerCallback('upd_stat_confirm', async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'updateStatus') as UpdateStatusSession | undefined;
        if (!session || session.stage !== 'CONFIRM') return;

        try {
            const creator = query.from.first_name + (query.from.last_name ? ' ' + query.from.last_name : '');
            const result = await updateNumbersStatusBatch(session.data.numbers, session.data.updates, creator);

            await bot.sendMessage(chatId, `✅ *Update Successful!*\n\nSuccessfully updated ${result.successCount} number(s).`, { parse_mode: 'Markdown' });

            // Log Activity
            const isLocationUpdate = session.data.updateType === 'Location';
            await logActivity(bot, {
                employeeName: creator,
                action: isLocationUpdate ? 'Updated Number Location' : 'Updated Number Status',
                description: `Updated properties for ${result.successCount} numbers:\n${session.data.numbers.join(', ')}\nChanges: ${JSON.stringify(session.data.updates)}`,
                createdBy: creator,
                source: 'BOT',
                groupName: isLocationUpdate ? 'SIM_LOCATIONS' : 'INVENTORY'
            }, true);

            clearSession(chatId, 'updateStatus');
        } catch (error: any) {
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            clearSession(chatId, 'updateStatus');
        }
    });

    router.registerCallback('update_status_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'updateStatus');
        await bot.sendMessage(query.message!.chat.id, "❌ Status update flow cancelled.");
    });
}

async function showConfirmation(bot: TelegramBot, chatId: number, session: UpdateStatusSession) {
    const updates = session.data.updates;
    let updateSummary = "";
    if (updates.status) updateSummary += `🔹 RTP Status: ${updates.status}\n`;
    if (updates.rtpDate) updateSummary += `🔹 RTP Date: ${formatToDDMMYYYY(updates.rtpDate as any)}\n`;
    if (updates.uploadStatus) updateSummary += `🔹 Upload Status: ${updates.uploadStatus}\n`;
    if (updates.locationType) updateSummary += `🔹 Location Type: ${updates.locationType}\n`;
    if (updates.currentLocation) updateSummary += `🔹 Current Location: ${updates.currentLocation}\n`;
    if (updates.salePrice !== undefined) updateSummary += `🔹 Sale Price: ₹${updates.salePrice}\n`;

    const summary = `*Confirm Updates*\n\n` +
        `📱 *Numbers:* ${session.data.numbers.join(', ')}\n\n` +
        `*Changes:*\n${updateSummary}\n` +
        `*Apply these changes?*`;

    await bot.sendMessage(chatId, summary, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '✅ Confirm & Update', callback_data: 'upd_stat_confirm' }],
                [cancelBtn]
            ]
        }
    });
}
