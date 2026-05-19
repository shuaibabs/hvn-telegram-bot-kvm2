import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { getBPNumberByMobile, markBPNumberAsSold, moveBPNumberToDeletes } from '../basicPremiumService';
import { CommandRouter } from '../../../core/router/commandRouter';
import { getUserProfile } from '../../../core/auth/permissions';
import { logActivity } from '../../activities/activityService';

const MANAGE_STAGES = {
    AWAIT_NUMBERS: 'AWAIT_NUMBERS',
    SELECT_ACTION: 'SELECT_ACTION',
    AWAIT_PRICE: 'AWAIT_PRICE',
    CONFIRMATION: 'CONFIRMATION',
    SAVING: 'SAVING'
} as const;

type ManageSession = {
    chatId: number;
    stage: keyof typeof MANAGE_STAGES;
    mobiles?: string[];
    action?: 'markSold' | 'editPrice' | 'delete';
    price?: number;
};

const cancelBtn = { text: '❌ Cancel', callback_data: 'bp_manage_cancel' };

export async function startManageBPNumberFlow(bot: TelegramBot, chatId: number, username?: string) {
    setSession(chatId, 'manageBP', { stage: 'AWAIT_NUMBERS', chatId });
    await bot.sendMessage(chatId, "⚙️ *Manage Basic / Premium Numbers*\n\nPlease enter the mobile number(s) to manage (separated by comma or new line):", {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[cancelBtn]] }
    });
}

export function registerManageBPNumberFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'manageBP') as ManageSession | undefined;
        if (!session || !msg.text || msg.text.startsWith('/')) return;

        const chatId = msg.chat.id;
        const text = msg.text.trim();

        if (session.stage === 'AWAIT_NUMBERS') {
            const numbers = text.split(/[\n,]+/).map(n => n.trim().replace(/\D/g, '')).filter(n => n.length === 10);
            if (numbers.length === 0) {
                await bot.sendMessage(chatId, "❌ No valid 10-digit numbers found. Please try again.");
                return;
            }

            const validMobiles: string[] = [];
            const missingMobiles: string[] = [];

            for (const mobile of numbers) {
                const record = await getBPNumberByMobile(mobile);
                if (record) {
                    validMobiles.push(mobile);
                } else {
                    missingMobiles.push(mobile);
                }
            }

            if (validMobiles.length === 0) {
                await bot.sendMessage(chatId, `❌ None of the provided numbers have a Basic/Premium record.\n\n*Numbers tried:* ${numbers.join(', ')}`, { parse_mode: 'Markdown' });
                clearSession(chatId, 'manageBP');
                return;
            }

            session.mobiles = validMobiles;
            session.stage = 'SELECT_ACTION';
            setSession(chatId, 'manageBP', session);

            let resp = `✅ Found ${validMobiles.length} records.`;
            if (missingMobiles.length > 0) resp += `\n⚠️ Not found: ${missingMobiles.length}`;
            resp += `\n\nWhat would you like to do?`;

            await bot.sendMessage(chatId, resp, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💰 Mark as Sold', callback_data: 'bp_act_markSold' }],
                        [{ text: '✏️ Edit Sale Price', callback_data: 'bp_act_editPrice' }],
                        [{ text: '🗑️ Delete Records', callback_data: 'bp_act_delete' }],
                        [cancelBtn]
                    ]
                }
            });
        } else if (session.stage === 'AWAIT_PRICE') {
            const price = parseFloat(text);
            if (isNaN(price)) {
                await bot.sendMessage(chatId, "❌ Invalid price. Please enter a number.");
                return;
            }
            session.price = price;
            session.stage = 'CONFIRMATION';
            setSession(chatId, 'manageBP', session);

            const actionLabel = session.action === 'markSold' ? 'Mark as Sold' : 'Update Sale Price';
            await bot.sendMessage(chatId, `🔔 *Confirm ${actionLabel}*\n\n📱 Numbers: ${session.mobiles?.join(', ')}\n💰 Price: ₹${price}\n\nProceed?`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Confirm', callback_data: 'bp_act_confirm' }],
                        [cancelBtn]
                    ]
                }
            });
        }
    });

    router.registerCallback(/^bp_act_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'manageBP') as ManageSession | undefined;
        if (!session) return;

        const action = query.data?.replace('bp_act_', '');

        if (action === 'markSold' || action === 'editPrice') {
            session.action = action as any;
            session.stage = 'AWAIT_PRICE';
            setSession(chatId, 'manageBP', session);
            const prompt = action === 'markSold' ? 'Enter the *Actual Sale Price*:' : 'Enter the new *Intended Sale Price*:';
            await bot.sendMessage(chatId, prompt, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[cancelBtn]] } });
        } else if (action === 'delete') {
            session.action = 'delete';
            session.stage = 'CONFIRMATION';
            setSession(chatId, 'manageBP', session);
            await bot.sendMessage(chatId, `⚠️ *Confirm Deletion*\n\nYou are about to delete ${session.mobiles?.length} Basic/Premium records. They will be moved to the Deletes collection.\n\nProceed?`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🗑️ Yes, Delete', callback_data: 'bp_act_confirm' }],
                        [cancelBtn]
                    ]
                }
            });
        } else if (action === 'confirm') {
            if (session.stage !== 'CONFIRMATION') return;

            session.stage = 'SAVING';
            setSession(chatId, 'manageBP', session);

            await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message!.message_id }).catch(() => {});

            try {
                const profile = await getUserProfile(query.from.username);
                const performedBy = profile?.displayName || query.from.username || 'Unknown';
                let successCount = 0;

                for (const mobile of session.mobiles!) {
                    const record = await getBPNumberByMobile(mobile);
                    if (!record) continue;

                    if (session.action === 'markSold') {
                        await markBPNumberAsSold(record.id, record.type, session.price!, performedBy);
                    } else if (session.action === 'editPrice') {
                        const { updateBPNumberSalePrice } = await import('../basicPremiumService');
                        await updateBPNumberSalePrice(record.id, record.type, session.price!);
                    } else if (session.action === 'delete') {
                        await moveBPNumberToDeletes(record.id, record.type, performedBy);
                    }
                    successCount++;
                }

                const actionLabel = session.action === 'markSold' ? 'marked as sold' : 'deleted';
                await bot.sendMessage(chatId, `✅ Successfully ${actionLabel} ${successCount} record(s).`);

                await logActivity(bot, {
                    employeeName: performedBy,
                    action: `MANAGE_BP_${session.action?.toUpperCase()}`,
                    description: `${performedBy} ${actionLabel} ${successCount} Basic/Premium numbers: ${session.mobiles?.join(', ')}`,
                    createdBy: performedBy,
                    source: 'BOT',
                    groupName: 'BASIC_PREMIUM_NUMBERS'
                }, true);

            } catch (error: any) {
                await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
            clearSession(chatId, 'manageBP');
        }
    });

    router.registerCallback('bp_manage_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'manageBP');
        await bot.sendMessage(query.message!.chat.id, "Operation cancelled.");
    });
}
