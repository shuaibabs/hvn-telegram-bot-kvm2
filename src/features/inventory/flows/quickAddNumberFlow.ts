import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { formatToDDMMYYYY, parseFromDDMMYYYY } from '../../../shared/utils/dateUtils';
import { NewNumberData, User } from '../../../shared/types/data';
import { addInventoryNumbers } from '../inventoryService';
import { getAllUsers } from '../../users/userService';
import { logActivity } from '../../activities/activityService';
import { CommandRouter } from '../../../core/router/commandRouter';

const QUICK_ADD_STAGES = {
    AWAIT_TYPE: 'AWAIT_TYPE',
    AWAIT_TEMPLATE: 'AWAIT_TEMPLATE',
    AWAIT_ASSIGNMENT: 'AWAIT_ASSIGNMENT',
    CONFIRM: 'CONFIRM',
    SAVING: 'SAVING',
} as const;

type QuickAddSession = {
    stage: keyof typeof QUICK_ADD_STAGES;
    selectedType: 'Prepaid' | 'Postpaid' | 'COCP';
    data?: Partial<NewNumberData> & { rawNumbers?: string[] };
};

const cancelBtn = { text: '❌ Cancel', callback_data: 'quick_add_cancel' };

export async function startQuickAddNumberFlow(bot: TelegramBot, chatId: number) {
    setSession(chatId, 'quickAddNumber', {
        stage: 'AWAIT_TYPE',
    });

    await bot.sendMessage(chatId, "⚡ *Quick Add Number(s)*\n\n*Step 1:* Select Number Type to get the template:", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Prepaid', callback_data: 'quick_add_type_Prepaid' },
                    { text: 'Postpaid', callback_data: 'quick_add_type_Postpaid' },
                    { text: 'COCP', callback_data: 'quick_add_type_COCP' }
                ],
                [cancelBtn]
            ]
        }
    });
}

function getTemplate(type: string): string {
    const today = formatToDDMMYYYY(new Date());
    const common =
        `NUMBER=9999999999
SP=0
PP=0
PDATE=${today}
PFROM=Aamir
LOC=Delhi
LOCTYPE=Store       (Employee || Dealer)
OWN=Individual      (PARTNER:NAME)
STS=RTP             (Non-RTP:${today})
UPLOADSTS=Pending   (Done)`;

    if (type === 'Prepaid') {
        return `TYPE=Prepaid\n${common}`;
    } else if (type === 'Postpaid') {
        return `TYPE=Postpaid:${today}:NO  (Yes)\n${common}`;
    } else if (type === 'COCP') {
        return `TYPE=COCP:AccountName:${today}:${today}\n${common}`;
    }
    return common;
}

function parseTemplate(text: string): { data: Partial<NewNumberData> & { rawNumbers: string[] }, error?: string } {
    const lines = text.split('\n');
    const data: Partial<NewNumberData> = {};
    const rawNumbers: string[] = [];

    const cleanValue = (val: string) => {
        // Remove everything in parentheses/brackets
        return val.replace(/\s*\(.*?\)/g, '').replace(/\s*\[.*?\]/g, '').trim();
    };

    try {
        for (const line of lines) {
            const [key, ...valParts] = line.trim().split('=');
            if (!key || valParts.length === 0) continue;
            const value = cleanValue(valParts.join('=').trim());

            switch (key.toUpperCase()) {
                case 'NUMBER':
                    rawNumbers.push(...value.split(',').map(n => n.trim().replace(/\D/g, '')).filter(n => n.length === 10));
                    break;
                case 'SP':
                    data.salePrice = parseFloat(value);
                    break;
                case 'PP':
                    data.purchasePrice = parseFloat(value);
                    break;
                case 'TYPE':
                    const typeParts = value.split(':').map(p => p.trim());
                    data.numberType = typeParts[0] as any;
                    if (data.numberType === 'Postpaid') {
                        data.billDate = parseFromDDMMYYYY(typeParts[1]) || undefined;
                        data.pdBill = (typeParts[2] as any) || 'No';
                    } else if (data.numberType === 'COCP') {
                        data.accountName = typeParts[1];
                        data.safeCustodyDate = parseFromDDMMYYYY(typeParts[2]) || undefined;
                        data.unsafeCustodyDate = parseFromDDMMYYYY(typeParts[3]) || undefined;
                    }
                    break;
                case 'PDATE':
                    data.purchaseDate = parseFromDDMMYYYY(value) || undefined;
                    break;
                case 'PFROM':
                    data.purchaseFrom = value;
                    break;
                case 'LOC':
                    data.currentLocation = value;
                    break;
                case 'LOCTYPE':
                    data.locationType = value as any;
                    break;
                case 'OWN':
                    if (value.toUpperCase().startsWith('PARTNER')) {
                        data.ownershipType = 'Partnership';
                        data.partnerName = value.split(':')[1]?.trim() || '';
                    } else {
                        data.ownershipType = 'Individual';
                    }
                    break;
                case 'STS':
                    const stsParts = value.split(':').map(p => p.trim());
                    data.status = stsParts[0] as any;
                    if (data.status === 'Non-RTP') {
                        data.rtpDate = parseFromDDMMYYYY(stsParts[1]) || undefined;
                    }
                    break;
                case 'UPLOADSTS':
                    data.uploadStatus = value as any;
                    break;
            }
        }

        if (rawNumbers.length === 0) return { data: { rawNumbers: [] }, error: "❌ No valid 10-digit numbers found in 'NUMBER=' field." };
        if (!data.numberType) return { data: { rawNumbers }, error: "❌ 'TYPE=' field is missing or invalid." };
        if (!data.purchaseDate) return { data: { rawNumbers }, error: "❌ 'PDATE=' (Purchase Date) is missing or invalid format (Use DD/MM/YYYY)." };
        if (data.purchasePrice === undefined || isNaN(data.purchasePrice)) return { data: { rawNumbers }, error: "❌ 'PP=' (Purchase Price) is missing or invalid." };

        const uniqueNumbers = [...new Set(rawNumbers)];
        return { data: { ...data, rawNumbers: uniqueNumbers } };
    } catch (e: any) {
        return { data: { rawNumbers: [] }, error: `❌ Parsing error: ${e.message}` };
    }
}

export function registerQuickAddNumberFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'quickAddNumber') as QuickAddSession | undefined;
        if (!session || !msg.text || msg.text === '/cancel') return;

        if (session.stage === 'AWAIT_TEMPLATE') {
            const { data, error } = parseTemplate(msg.text);
            if (error) {
                await bot.sendMessage(msg.chat.id, error + "\n\nPlease correct the template and try again.");
                return;
            }

            session.data = data;
            session.stage = 'AWAIT_ASSIGNMENT';
            setSession(msg.chat.id, 'quickAddNumber', session);

            const users = await getAllUsers();
            const userButtons = users.map(u => [{ text: u.displayName, callback_data: `quick_add_assign_${u.uid}` }]);
            userButtons.push([{ text: '🔓 Unassigned', callback_data: 'quick_add_assign_Unassigned' }]);
            userButtons.push([cancelBtn]);

            await bot.sendMessage(msg.chat.id, "*Step 3:* Assign To:", {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: userButtons }
            });
        }
    });

    router.registerCallback(/^quick_add_type_/, async (query: TelegramBot.CallbackQuery) => {
        const session = getSession(query.message!.chat.id, 'quickAddNumber') as QuickAddSession | undefined;
        if (!session || session.stage !== 'AWAIT_TYPE') return;

        const type = query.data?.split('_').pop() as any;
        session.selectedType = type;
        session.stage = 'AWAIT_TEMPLATE';
        setSession(query.message!.chat.id, 'quickAddNumber', session);

        const template = getTemplate(type);
        await bot.sendMessage(query.message!.chat.id,
            `✅ Type Selected: *${type}*\n\n*Step 2:* Copy the template below, edit the details, and send it back:`, {
            parse_mode: 'Markdown',
        });

        await bot.sendMessage(query.message!.chat.id, `\`\`\`\n${template}\n\`\`\``, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[cancelBtn]] }
        });
    });

    router.registerCallback(/^quick_add_assign_/, async (query: TelegramBot.CallbackQuery) => {
        const session = getSession(query.message!.chat.id, 'quickAddNumber') as QuickAddSession | undefined;
        if (!session || session.stage !== 'AWAIT_ASSIGNMENT') return;

        const assignValue = query.data?.split('_').pop();
        if (assignValue === 'Unassigned') {
            session.data!.assignedTo = 'Unassigned';
        } else {
            const users = await getAllUsers();
            const user = users.find(u => u.uid === assignValue);
            session.data!.assignedTo = user?.displayName || 'Unassigned';
        }

        session.stage = 'CONFIRM';
        setSession(query.message!.chat.id, 'quickAddNumber', session);

        const d = session.data!;
        const summary = `⚡ *Summary of Quick Add*\n\n` +
            `📱 *Numbers:* ${d.rawNumbers?.join(', ')}\n` +
            `📝 *Type:* ${d.numberType}\n` +
            (d.numberType === 'Postpaid' ? `📅 *Bill Date:* ${formatToDDMMYYYY(d.billDate)}\n📊 *PD Bill:* ${d.pdBill}\n` : '') +
            (d.numberType === 'COCP' ? `🏢 *Account:* ${d.accountName}\n📅 *Safe Custody:* ${formatToDDMMYYYY(d.safeCustodyDate)}\n📅 *Unsafe Custody:* ${formatToDDMMYYYY(d.unsafeCustodyDate)}\n` : '') +
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
                    [{ text: '✅ Confirm & Save', callback_data: 'quick_add_final_confirm' }],
                    [{ text: '🔄 Restart', callback_data: 'quick_add_restart' }],
                    [cancelBtn]
                ]
            }
        });
    });

    router.registerCallback('quick_add_final_confirm', async (query: TelegramBot.CallbackQuery) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'quickAddNumber') as QuickAddSession | undefined;
        if (!session || session.stage !== 'CONFIRM') return;

        // Immediately update session to SAVING
        session.stage = 'SAVING';
        setSession(chatId, 'quickAddNumber', session);

        // Edit message to remove buttons immediately
        try {
            await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                chat_id: chatId,
                message_id: query.message!.message_id
            });
        } catch (e) {
            logger.warn('Failed to remove buttons during quick add save: ' + (e as Error).message);
        }

        try {
            const creator = query.from.first_name + (query.from.last_name ? ' ' + query.from.last_name : '');
            const result = await addInventoryNumbers(
                session.data as NewNumberData,
                session.data!.rawNumbers!,
                query.from.id.toString(),
                creator
            );

            let msg = `✅ *Quick Add Success!*\n\n` +
                `🔹 Added: ${result.successCount}\n` +
                `🔹 Duplicates skipped: ${result.duplicateCount}`;

            if (result.duplicateCount > 0) {
                msg += `\n  (${result.duplicates.join(', ')})`;
            }

            if (result.errors && result.errors.length > 0) {
                msg += `\n\n❌ Errors:\n${result.errors.join('\n')}`;
            }

            await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });

            await logActivity(bot, {
                employeeName: creator,
                action: 'QUICK_ADD_NUMBERS',
                description: `Quick added ${result.successCount} numbers to inventory:\n${session.data!.rawNumbers!.join(', ')}\n(Skipped ${result.duplicateCount} duplicates: ${result.duplicates.join(', ')}).`,
                createdBy: creator,
                source: 'BOT',
                groupName: 'INVENTORY'
            }, true);

            clearSession(chatId, 'quickAddNumber');
        } catch (error: any) {
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            clearSession(chatId, 'quickAddNumber');
        }
    });

    router.registerCallback('quick_add_cancel', async (query: TelegramBot.CallbackQuery) => {
        clearSession(query.message!.chat.id, 'quickAddNumber');
        await bot.sendMessage(query.message!.chat.id, "❌ Quick add flow cancelled.");
    });

    router.registerCallback('quick_add_restart', async (query: TelegramBot.CallbackQuery) => {
        await startQuickAddNumberFlow(bot, query.message!.chat.id);
    });
}
