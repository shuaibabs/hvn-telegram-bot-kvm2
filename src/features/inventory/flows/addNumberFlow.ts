import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { escapeMarkdown } from '../../../shared/utils/telegram';
import { formatToDDMMYYYY, parseFromDDMMYYYY } from '../../../shared/utils/dateUtils';
import { NewNumberData, User } from '../../../shared/types/data';
import { addInventoryNumbers } from '../inventoryService';
import { getAllUsers } from '../../users/userService';
import { logActivity } from '../../activities/activityService';
import { CommandRouter } from '../../../core/router/commandRouter';

const ADD_NUMBER_STAGES = {
    AWAIT_NUMBERS: 'AWAIT_NUMBERS',
    AWAIT_TYPE: 'AWAIT_TYPE',
    AWAIT_POSTPAID_BILL_DATE: 'AWAIT_POSTPAID_BILL_DATE',
    AWAIT_POSTPAID_PD_BILL: 'AWAIT_POSTPAID_PD_BILL',
    AWAIT_COCP_ACCOUNT: 'AWAIT_COCP_ACCOUNT',
    AWAIT_COCP_SAFE_CUSTODY: 'AWAIT_COCP_SAFE_CUSTODY',
    AWAIT_PURCHASE_VENDOR: 'AWAIT_PURCHASE_VENDOR',
    AWAIT_PURCHASE_DATE: 'AWAIT_PURCHASE_DATE',
    AWAIT_PURCHASE_PRICE: 'AWAIT_PURCHASE_PRICE',
    AWAIT_SALE_PRICE: 'AWAIT_SALE_PRICE',
    AWAIT_OWNERSHIP: 'AWAIT_OWNERSHIP',
    AWAIT_PARTNER_NAME: 'AWAIT_PARTNER_NAME',
    AWAIT_RTP_STATUS: 'AWAIT_RTP_STATUS',
    AWAIT_RTP_DATE: 'AWAIT_RTP_DATE',
    AWAIT_UPLOAD_STATUS: 'AWAIT_UPLOAD_STATUS',
    AWAIT_CURRENT_LOCATION: 'AWAIT_CURRENT_LOCATION',
    AWAIT_LOCATION_TYPE: 'AWAIT_LOCATION_TYPE',
    AWAIT_ASSIGNMENT: 'AWAIT_ASSIGNMENT',
    CONFIRM: 'CONFIRM',
    SAVING: 'SAVING',
} as const;

type AddNumberSession = {
    stage: keyof typeof ADD_NUMBER_STAGES;
    data: Partial<NewNumberData> & { rawNumbers?: string[] };
};

const cancelBtn = { text: '❌ Cancel', callback_data: 'add_num_cancel' };

export async function startAddNumberFlow(bot: TelegramBot, chatId: number) {
    setSession(chatId, 'addNumber', {
        stage: 'AWAIT_NUMBERS',
        data: {
            status: 'RTP', // default
            uploadStatus: 'Pending',
            locationType: 'Store',
            ownershipType: 'Individual',
            pdBill: 'No'
        }
    });

    await bot.sendMessage(chatId, "🚀 *Add New Number(s)*\n\n*Step 1:* Please enter one or more 10-digit mobile numbers separated by comma or new line.", {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[cancelBtn]] }
    });
}

// Handler functions for each stage...

async function handleNumbersInput(bot: TelegramBot, msg: TelegramBot.Message, session: AddNumberSession) {
    const text = msg.text?.trim();
    if (!text) return;

    const numbers = text.split(/[\n,]+/).map(n => n.trim().replace(/\D/g, '')).filter(n => n.length === 10);

    if (numbers.length === 0) {
        await bot.sendMessage(msg.chat.id, "❌ No valid 10-digit numbers found. Please try again.");
        return;
    }

    const uniqueNumbers = [...new Set(numbers)];
    session.data.rawNumbers = uniqueNumbers;
    session.stage = 'AWAIT_TYPE';
    setSession(msg.chat.id, 'addNumber', session);

    await bot.sendMessage(msg.chat.id, `✅ Received ${numbers.length} number(s).\n\n*Step 2:* Select Number Type:`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Prepaid', callback_data: 'add_num_type_Prepaid' },
                    { text: 'Postpaid', callback_data: 'add_num_type_Postpaid' },
                    { text: 'COCP', callback_data: 'add_num_type_COCP' }
                ],
                [cancelBtn]
            ]
        }
    });
}

async function handleTypeSelection(bot: TelegramBot, query: TelegramBot.CallbackQuery, session: AddNumberSession) {
    const type = query.data?.split('_').pop() as any;
    session.data.numberType = type;

    if (type === 'Prepaid') {
        session.stage = 'AWAIT_PURCHASE_VENDOR';
        setSession(query.message!.chat.id, 'addNumber', session);
        await bot.sendMessage(query.message!.chat.id, "*Step 4:* Enter Purchase From (Vendor Name):", {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[cancelBtn]] }
        });
    } else if (type === 'Postpaid') {
        session.stage = 'AWAIT_POSTPAID_BILL_DATE';
        setSession(query.message!.chat.id, 'addNumber', session);
        const today = formatToDDMMYYYY(new Date());
        await bot.sendMessage(query.message!.chat.id, `*Step 3:* Enter Bill Date (DD/MM/YYYY):\n(Type 'today' for ${today})`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `📅 Today (${today})`, callback_data: 'add_num_date_bill_today' }],
                    [cancelBtn]
                ]
            }
        });
    } else if (type === 'COCP') {
        session.stage = 'AWAIT_COCP_ACCOUNT';
        setSession(query.message!.chat.id, 'addNumber', session);
        await bot.sendMessage(query.message!.chat.id, "*Step 3:* Enter Account Name:", {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[cancelBtn]] }
        });
    }
}

// Helper for date parsing - moved to dateUtils
const parseDate = parseFromDDMMYYYY;

// ... more handlers ...
// (I will implement the rest in the final file writing)

export function registerAddNumberFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'addNumber') as AddNumberSession | undefined;
        if (!session || !msg.text || msg.text === '/cancel') return;

        switch (session.stage) {
            case 'AWAIT_NUMBERS': await handleNumbersInput(bot, msg, session); break;
            case 'AWAIT_POSTPAID_BILL_DATE':
                let bDateStr = msg.text.trim().toLowerCase();
                let bDate: Date | null;
                if (bDateStr === 'today') {
                    bDate = new Date();
                } else {
                    bDate = parseDate(msg.text);
                }

                if (!bDate) {
                    await bot.sendMessage(msg.chat.id, "❌ Invalid date format. Use DD/MM/YYYY.");
                    return;
                }
                session.data.billDate = bDate;
                session.stage = 'AWAIT_POSTPAID_PD_BILL';
                setSession(msg.chat.id, 'addNumber', session);
                await bot.sendMessage(msg.chat.id, "Is this a PD Bill?", {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Yes', callback_data: 'add_num_pdbill_Yes' }, { text: 'No', callback_data: 'add_num_pdbill_No' }],
                            [cancelBtn]
                        ]
                    }
                });
                break;
            case 'AWAIT_COCP_ACCOUNT':
                session.data.accountName = msg.text.trim();
                session.stage = 'AWAIT_COCP_SAFE_CUSTODY';
                setSession(msg.chat.id, 'addNumber', session);
                const todaySC = formatToDDMMYYYY(new Date());
                await bot.sendMessage(msg.chat.id, `Enter Safe Custody Date (DD/MM/YYYY):\n(Type 'today' for ${todaySC})`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `📅 Today (${todaySC})`, callback_data: 'add_num_date_sc_today' }],
                            [cancelBtn]
                        ]
                    }
                });
                break;
            case 'AWAIT_COCP_SAFE_CUSTODY':
                let scDateStr = msg.text.trim().toLowerCase();
                let scDate: Date | null;
                if (scDateStr === 'today') {
                    scDate = new Date();
                } else {
                    scDate = parseDate(msg.text);
                }

                if (!scDate) {
                    await bot.sendMessage(msg.chat.id, "❌ Invalid date format. Use DD/MM/YYYY.");
                    return;
                }
                session.data.safeCustodyDate = scDate;
                session.stage = 'AWAIT_PURCHASE_VENDOR';
                setSession(msg.chat.id, 'addNumber', session);
                await bot.sendMessage(msg.chat.id, "*Step 4:* Enter Purchase From (Vendor Name):", {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[cancelBtn]] }
                });
                break;
            case 'AWAIT_PURCHASE_VENDOR':
                session.data.purchaseFrom = msg.text.trim();
                session.stage = 'AWAIT_PURCHASE_DATE';
                setSession(msg.chat.id, 'addNumber', session);
                const todayP = formatToDDMMYYYY(new Date());
                await bot.sendMessage(msg.chat.id, `Enter Purchase Date (DD/MM/YYYY):\n(Type 'today' for ${todayP})`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `📅 Today (${todayP})`, callback_data: 'add_num_date_purchase_today' }],
                            [cancelBtn]
                        ]
                    }
                });
                break;
            case 'AWAIT_PURCHASE_DATE':
                let pDateStr = msg.text.trim().toLowerCase();
                let pDate: Date | null;
                if (pDateStr === 'today') {
                    pDate = new Date();
                } else {
                    pDate = parseDate(msg.text);
                }

                if (!pDate) {
                    await bot.sendMessage(msg.chat.id, "❌ Invalid date format. Use DD/MM/YYYY.");
                    return;
                }
                session.data.purchaseDate = pDate;
                session.stage = 'AWAIT_PURCHASE_PRICE';
                setSession(msg.chat.id, 'addNumber', session);
                await bot.sendMessage(msg.chat.id, "Enter Purchase Price (₹):", {
                    reply_markup: { inline_keyboard: [[cancelBtn]] }
                });
                break;
            case 'AWAIT_PURCHASE_PRICE':
                const pPrice = parseFloat(msg.text);
                if (isNaN(pPrice)) {
                    await bot.sendMessage(msg.chat.id, "❌ Invalid price. Enter a number.");
                    return;
                }
                session.data.purchasePrice = pPrice;
                session.stage = 'AWAIT_SALE_PRICE';
                setSession(msg.chat.id, 'addNumber', session);
                await bot.sendMessage(msg.chat.id, "Enter Intended Sale Price (₹) (or type 0 for none):", {
                    reply_markup: { inline_keyboard: [[cancelBtn]] }
                });
                break;
            case 'AWAIT_SALE_PRICE':
                const sPrice = parseFloat(msg.text);
                if (isNaN(sPrice)) {
                    await bot.sendMessage(msg.chat.id, "❌ Invalid price. Enter a number.");
                    return;
                }
                session.data.salePrice = sPrice;
                session.stage = 'AWAIT_OWNERSHIP';
                setSession(msg.chat.id, 'addNumber', session);
                await bot.sendMessage(msg.chat.id, "*Step 5:* Ownership Type:", {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Individual', callback_data: 'add_num_owner_Individual' }, { text: 'Partnership', callback_data: 'add_num_owner_Partnership' }],
                            [cancelBtn]
                        ]
                    }
                });
                break;
            case 'AWAIT_PARTNER_NAME':
                session.data.partnerName = msg.text.trim();
                session.stage = 'AWAIT_RTP_STATUS';
                setSession(msg.chat.id, 'addNumber', session);
                await bot.sendMessage(msg.chat.id, "*Step 7:* RTP Status:", {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'RTP', callback_data: 'add_num_rtp_RTP' }, { text: 'Non-RTP', callback_data: 'add_num_rtp_Non-RTP' }],
                            [cancelBtn]
                        ]
                    }
                });
                break;
            case 'AWAIT_RTP_DATE':
                let rDateStr = msg.text.trim().toLowerCase();
                let rDate: Date | null;
                if (rDateStr === 'today') {
                    rDate = new Date();
                } else {
                    rDate = parseDate(msg.text);
                }

                if (!rDate) {
                    await bot.sendMessage(msg.chat.id, "❌ Invalid date format. Use DD/MM/YYYY.");
                    return;
                }
                session.data.rtpDate = rDate;
                session.stage = 'AWAIT_UPLOAD_STATUS';
                setSession(msg.chat.id, 'addNumber', session);
                await bot.sendMessage(msg.chat.id, "*Step 8:* Upload Status:", {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Pending', callback_data: 'add_num_upload_Pending' }, { text: 'Done', callback_data: 'add_num_upload_Done' }],
                            [cancelBtn]
                        ]
                    }
                });
                break;
            case 'AWAIT_CURRENT_LOCATION':
                session.data.currentLocation = msg.text.trim();
                session.stage = 'AWAIT_LOCATION_TYPE';
                setSession(msg.chat.id, 'addNumber', session);
                await bot.sendMessage(msg.chat.id, "Select Location Type:", {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: 'Store', callback_data: 'add_num_loctype_Store' },
                                { text: 'Employee', callback_data: 'add_num_loctype_Employee' },
                                { text: 'Dealer', callback_data: 'add_num_loctype_Dealer' }
                            ],
                            [cancelBtn]
                        ]
                    }
                });
                break;
        }
    });

    // Callback handlers...
    router.registerCallback(/^add_num_type_/, async (query: TelegramBot.CallbackQuery) => {
        const session = getSession(query.message!.chat.id, 'addNumber') as AddNumberSession | undefined;
        if (!session || session.stage !== 'AWAIT_TYPE') return;
        await handleTypeSelection(bot, query, session);
    });

    router.registerCallback(/^add_num_pdbill_/, async (query: TelegramBot.CallbackQuery) => {
        const session = getSession(query.message!.chat.id, 'addNumber') as AddNumberSession | undefined;
        if (!session || session.stage !== 'AWAIT_POSTPAID_PD_BILL') return;
        session.data.pdBill = query.data?.split('_').pop() as any;
        session.stage = 'AWAIT_PURCHASE_VENDOR';
        setSession(query.message!.chat.id, 'addNumber', session);
        await bot.sendMessage(query.message!.chat.id, "*Step 4:* Enter Purchase From (Vendor Name):", {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[cancelBtn]] }
        });
    });

    router.registerCallback('add_num_date_bill_today', async (query: TelegramBot.CallbackQuery) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'addNumber') as AddNumberSession | undefined;
        if (!session || session.stage !== 'AWAIT_POSTPAID_BILL_DATE') return;

        session.data.billDate = new Date();
        session.stage = 'AWAIT_POSTPAID_PD_BILL';
        setSession(chatId, 'addNumber', session);
        await bot.sendMessage(chatId, "Is this a PD Bill?", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Yes', callback_data: 'add_num_pdbill_Yes' }, { text: 'No', callback_data: 'add_num_pdbill_No' }],
                    [cancelBtn]
                ]
            }
        });
    });

    router.registerCallback('add_num_date_sc_today', async (query: TelegramBot.CallbackQuery) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'addNumber') as AddNumberSession | undefined;
        if (!session || session.stage !== 'AWAIT_COCP_SAFE_CUSTODY') return;

        session.data.safeCustodyDate = new Date();
        session.stage = 'AWAIT_PURCHASE_VENDOR';
        setSession(chatId, 'addNumber', session);
        await bot.sendMessage(chatId, "*Step 4:* Enter Purchase From (Vendor Name):", {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[cancelBtn]] }
        });
    });

    router.registerCallback('add_num_date_purchase_today', async (query: TelegramBot.CallbackQuery) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'addNumber') as AddNumberSession | undefined;
        if (!session || session.stage !== 'AWAIT_PURCHASE_DATE') return;

        session.data.purchaseDate = new Date();
        session.stage = 'AWAIT_PURCHASE_PRICE';
        setSession(chatId, 'addNumber', session);
        await bot.sendMessage(chatId, "Enter Purchase Price (₹):", {
            reply_markup: { inline_keyboard: [[cancelBtn]] }
        });
    });

    router.registerCallback(/^add_num_owner_/, async (query: TelegramBot.CallbackQuery) => {
        const session = getSession(query.message!.chat.id, 'addNumber') as AddNumberSession | undefined;
        if (!session || session.stage !== 'AWAIT_OWNERSHIP') return;
        const owner = query.data?.split('_').pop() as any;
        session.data.ownershipType = owner;
        if (owner === 'Partnership') {
            session.stage = 'AWAIT_PARTNER_NAME';
            setSession(query.message!.chat.id, 'addNumber', session);
            await bot.sendMessage(query.message!.chat.id, "*Step 6:* Enter Partner Name:", {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[cancelBtn]] }
            });
        } else {
            session.stage = 'AWAIT_RTP_STATUS';
            setSession(query.message!.chat.id, 'addNumber', session);
            await bot.sendMessage(query.message!.chat.id, "*Step 7:* RTP Status:", {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'RTP', callback_data: 'add_num_rtp_RTP' }, { text: 'Non-RTP', callback_data: 'add_num_rtp_Non-RTP' }],
                        [cancelBtn]
                    ]
                }
            });
        }
    });

    router.registerCallback(/^add_num_rtp_/, async (query: TelegramBot.CallbackQuery) => {
        const session = getSession(query.message!.chat.id, 'addNumber') as AddNumberSession | undefined;
        if (!session || session.stage !== 'AWAIT_RTP_STATUS') return;
        const rtp = query.data?.split('_').pop() as any;
        session.data.status = rtp;
        if (rtp === 'Non-RTP') {
            session.stage = 'AWAIT_RTP_DATE';
            setSession(query.message!.chat.id, 'addNumber', session);
            const todayRTP = formatToDDMMYYYY(new Date());
            await bot.sendMessage(query.message!.chat.id, `*Step 8:* Enter Schedule RTP Date (DD/MM/YYYY):\n(Type 'today' for ${todayRTP})`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `📅 Today (${todayRTP})`, callback_data: 'add_num_date_rtp_today' }],
                        [cancelBtn]
                    ]
                }
            });
        } else {
            session.stage = 'AWAIT_UPLOAD_STATUS';
            setSession(query.message!.chat.id, 'addNumber', session);
            await bot.sendMessage(query.message!.chat.id, "*Step 8:* Upload Status:", {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Pending', callback_data: 'add_num_upload_Pending' }, { text: 'Done', callback_data: 'add_num_upload_Done' }],
                        [cancelBtn]
                    ]
                }
            });
        }
    });

    router.registerCallback('add_num_date_rtp_today', async (query: TelegramBot.CallbackQuery) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'addNumber') as AddNumberSession | undefined;
        if (!session || session.stage !== 'AWAIT_RTP_DATE') return;

        session.data.rtpDate = new Date();
        session.stage = 'AWAIT_UPLOAD_STATUS';
        setSession(chatId, 'addNumber', session);
        await bot.sendMessage(chatId, "*Step 8:* Upload Status:", {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Pending', callback_data: 'add_num_upload_Pending' }, { text: 'Done', callback_data: 'add_num_upload_Done' }],
                    [cancelBtn]
                ]
            }
        });
    });

    router.registerCallback(/^add_num_upload_/, async (query: TelegramBot.CallbackQuery) => {
        const session = getSession(query.message!.chat.id, 'addNumber') as AddNumberSession | undefined;
        if (!session || session.stage !== 'AWAIT_UPLOAD_STATUS') return;
        session.data.uploadStatus = query.data?.split('_').pop() as any;
        session.stage = 'AWAIT_CURRENT_LOCATION';
        setSession(query.message!.chat.id, 'addNumber', session);
        await bot.sendMessage(query.message!.chat.id, "*Step 9:* Enter Current Location:", {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[cancelBtn]] }
        });
    });

    router.registerCallback(/^add_num_loctype_/, async (query: TelegramBot.CallbackQuery) => {
        const session = getSession(query.message!.chat.id, 'addNumber') as AddNumberSession | undefined;
        if (!session || session.stage !== 'AWAIT_LOCATION_TYPE') return;
        session.data.locationType = query.data?.split('_').pop() as any;

        // Next Step: Assignment
        session.stage = 'AWAIT_ASSIGNMENT';
        setSession(query.message!.chat.id, 'addNumber', session);

        const users = await getAllUsers();
        const userButtons = users.map(u => [{ text: u.displayName, callback_data: `add_num_assign_${u.uid}` }]);
        userButtons.push([{ text: '🔓 Unassigned', callback_data: 'add_num_assign_Unassigned' }]);
        userButtons.push([cancelBtn]);

        await bot.sendMessage(query.message!.chat.id, "*Step 10:* Assign To:", {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: userButtons }
        });
    });

    router.registerCallback(/^add_num_assign_/, async (query: TelegramBot.CallbackQuery) => {
        const session = getSession(query.message!.chat.id, 'addNumber') as AddNumberSession | undefined;
        if (!session || session.stage !== 'AWAIT_ASSIGNMENT') return;

        const assignValue = query.data?.split('_').pop();
        if (assignValue === 'Unassigned') {
            session.data.assignedTo = 'Unassigned';
        } else {
            const users = await getAllUsers();
            const user = users.find(u => u.uid === assignValue);
            session.data.assignedTo = user?.displayName || 'Unassigned';
        }

        session.stage = 'CONFIRM';
        setSession(query.message!.chat.id, 'addNumber', session);

        // Final Confirmation
        const d = session.data;
        const summary = `*Summary of New Number(s)*\n\n` +
            `📱 *Numbers:* ${d.rawNumbers?.join(', ')}\n` +
            `📝 *Type:* ${d.numberType}\n` +
            (d.numberType === 'Postpaid' ? `📅 *Bill Date:* ${formatToDDMMYYYY(d.billDate)}\n📊 *PD Bill:* ${d.pdBill}\n` : '') +
            (d.numberType === 'COCP' ? `🏢 *Account:* ${d.accountName}\n📅 *Custody Date:* ${formatToDDMMYYYY(d.safeCustodyDate)}\n` : '') +
            `👤 *Ownership:* ${d.ownershipType}${d.ownershipType === 'Partnership' ? ` (Partner: ${d.partnerName})` : ''}\n` +
            `💰 *Purchase:* From ${d.purchaseFrom} on ${formatToDDMMYYYY(d.purchaseDate)} for ₹${d.purchasePrice}\n` +
            `📈 *Intended Sale:* ₹${d.salePrice}\n` +
            `📍 *Status/Loc:* ${d.status} | ${d.uploadStatus} | ${d.currentLocation} (${d.locationType})\n` +
            `👷 *Assigned To:* ${d.assignedTo}\n\n` +
            `*Confirm to save?*`;

        await bot.sendMessage(query.message!.chat.id, summary, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Confirm & Save', callback_data: 'add_num_final_confirm' }],
                    [{ text: '🔄 Restart', callback_data: 'add_num_restart' }],
                    [cancelBtn]
                ]
            }
        });
    });

    // Final Final Confirm
    router.registerCallback('add_num_final_confirm', async (query: TelegramBot.CallbackQuery) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'addNumber') as AddNumberSession | undefined;
        if (!session || session.stage !== 'CONFIRM') return;

        // Immediately update session to SAVING to prevent concurrent executions
        session.stage = 'SAVING';
        setSession(chatId, 'addNumber', session);

        // Edit message to remove buttons immediately
        try {
            await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                chat_id: chatId,
                message_id: query.message!.message_id
            });
        } catch (e) {
            // Log and continue if message edit fails
            logger.warn('Failed to remove buttons during save: ' + (e as Error).message);
        }

        try {
            const creator = query.from.first_name + (query.from.last_name ? ' ' + query.from.last_name : '');
            const result = await addInventoryNumbers(
                session.data as NewNumberData,
                session.data.rawNumbers!,
                query.from.id.toString(), // Simplified check, should use UID from users collection if possible
                creator
            );

            let msg = `✅ *Success!*\n\n` +
                `🔹 Added: ${result.successCount}\n` +
                `🔹 Duplicates skipped: ${result.duplicateCount}`;

            if (result.duplicateCount > 0) {
                msg += `\n  (${result.duplicates.join(', ')})`;
            }

            await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });

            // Log Activity
            await logActivity(bot, {
                employeeName: creator,
                action: result.successCount > 1 ? 'Bulk Added Numbers' : 'Added Number',
                description: `Created ${result.successCount} numbers in inventory:\n${session.data.rawNumbers!.join(', ')}\n(Skipped ${result.duplicateCount} duplicates).`,
                createdBy: creator,
                source: 'BOT',
                groupName: 'INVENTORY'
            }, true);

            clearSession(chatId, 'addNumber');
        } catch (error: any) {
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            clearSession(chatId, 'addNumber');
        }
    });

    router.registerCallback('add_num_cancel', async (query: TelegramBot.CallbackQuery) => {
        clearSession(query.message!.chat.id, 'addNumber');
        await bot.sendMessage(query.message!.chat.id, "❌ Registration flow cancelled.");
    });

    router.registerCallback('add_num_restart', async (query: TelegramBot.CallbackQuery) => {
        await startAddNumberFlow(bot, query.message!.chat.id);
    });
}
