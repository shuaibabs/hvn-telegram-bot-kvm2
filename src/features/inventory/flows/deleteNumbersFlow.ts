import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { validateNumbersExistence, softDeleteNumbers } from '../inventoryService';
import { logActivity } from '../../activities/activityService';
import { CommandRouter } from '../../../core/router/commandRouter';

const DELETE_NUMBERS_STAGES = {
    AWAIT_NUMBERS: 'AWAIT_NUMBERS',
    AWAIT_REASON: 'AWAIT_REASON',
    CONFIRM: 'CONFIRM',
    SAVING: 'SAVING',
} as const;

type DeleteNumbersSession = {
    stage: keyof typeof DELETE_NUMBERS_STAGES;
    data: {
        numbers: string[];
        reason?: string;
        missingMobiles?: string[];
    };
};

const cancelBtn = { text: '❌ Cancel', callback_data: 'delete_numbers_cancel' };

export async function startDeleteNumbersFlow(bot: TelegramBot, chatId: number) {
    setSession(chatId, 'deleteNumbers', {
        stage: 'AWAIT_NUMBERS',
        data: {
            numbers: [],
            missingMobiles: []
        }
    });

    await bot.sendMessage(chatId, "🗑 *Soft Delete Number(s)*\n\n*Step 1:* Please enter one or more 10-digit mobile numbers separated by comma or new line.", {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[cancelBtn]] }
    });
}

export function registerDeleteNumbersFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'deleteNumbers') as DeleteNumbersSession | undefined;
        if (!session || !msg.text || msg.text.startsWith('/')) return;

        const chatId = msg.chat.id;

        if (session.stage === 'AWAIT_NUMBERS') {
            const numbers = msg.text.split(/[\n,]+/).map(n => n.trim().replace(/\D/g, '')).filter(n => n.length === 10);
            if (numbers.length === 0) {
                await bot.sendMessage(chatId, "❌ No valid 10-digit numbers found. Please try again.");
                return;
            }

            // Validate existence
            const { existing, missing } = await validateNumbersExistence(numbers);
            if (existing.length === 0) {
                await bot.sendMessage(chatId, `❌ None of the provided numbers exist in the inventory.\n\n*Rejected:* ${missing.join(', ')}`, { parse_mode: 'Markdown' });
                clearSession(chatId, 'deleteNumbers');
                return;
            }

            session.data.numbers = existing;
            session.data.missingMobiles = missing;
            session.stage = 'AWAIT_REASON';
            setSession(chatId, 'deleteNumbers', session);

            let statusMsg = `🔍 *Validation Results*\n\n✅ *Found:* ${existing.length}\n`;
            if (missing.length > 0) statusMsg += `⚠️ *Not Found (skipped):* ${missing.length}\n`;
            statusMsg += `\n*Step 2:* Please enter the *Reason* for deleting these numbers (Mandatory):`;

            await bot.sendMessage(chatId, statusMsg, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[cancelBtn]] }
            });
        } else if (session.stage === 'AWAIT_REASON') {
            const reason = msg.text.trim();
            if (reason.length < 3) {
                await bot.sendMessage(chatId, "⚠️ Please enter a valid reason (at least 3 characters).");
                return;
            }

            session.data.reason = reason;
            session.stage = 'CONFIRM';
            setSession(chatId, 'deleteNumbers', session);

            let confirmMsg = `🗑 *Confirm Deletion*\n\n` +
                `📱 *Numbers:* ${session.data.numbers.join(', ')}\n` +
                `💬 *Reason:* ${reason}\n\n` +
                `*Are you sure you want to delete these numbers?*`;

            await bot.sendMessage(chatId, confirmMsg, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🗑 Yes, Confirm Delete', callback_data: 'del_num_confirm' }],
                        [cancelBtn]
                    ]
                }
            });
        }
    });

    router.registerCallback('del_num_confirm', async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'deleteNumbers') as DeleteNumbersSession | undefined;
        if (!session || session.stage !== 'CONFIRM') return;

        // Lock session
        session.stage = 'SAVING';
        setSession(chatId, 'deleteNumbers', session);

        // Remove buttons
        try {
            await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                chat_id: chatId,
                message_id: query.message!.message_id
            });
        } catch (e) {
            logger.warn('Failed to remove buttons in deleteNumbers: ' + (e as Error).message);
        }

        try {
            const creator = query.from.first_name + (query.from.last_name ? ' ' + query.from.last_name : '');
            const result = await softDeleteNumbers(session.data.numbers, creator, session.data.reason!);

            let successMsg = `✅ *Deletion Successful!*\n\nSuccessfully deleted ${result.successCount} number(s).`;
            if (session.data.missingMobiles && session.data.missingMobiles.length > 0) {
                successMsg += `\n⚠️ *Skipped missing:* ${session.data.missingMobiles.length} (${session.data.missingMobiles.join(', ')})`;
            }
            await bot.sendMessage(chatId, successMsg, { parse_mode: 'Markdown' });

            // Log Activity
            await logActivity(bot, {
                employeeName: creator,
                action: 'DELETE_NUMBERS',
                description: `Soft deleted ${result.successCount} numbers from inventory. Reason: ${session.data.reason}.\nDeleted: ${session.data.numbers.join(', ')}\nSkipped: ${session.data.missingMobiles?.join(', ') || 'None'}`,
                createdBy: creator,
                source: 'BOT',
                groupName: 'DELETED_NUMBERS'
            }, true);

            clearSession(chatId, 'deleteNumbers');
        } catch (error: any) {
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            clearSession(chatId, 'deleteNumbers');
        }
    });

    router.registerCallback('delete_numbers_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'deleteNumbers');
        await bot.sendMessage(query.message!.chat.id, "❌ Deletion flow cancelled.");
    });
}
