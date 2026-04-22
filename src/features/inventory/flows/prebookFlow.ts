import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { validateNumbersExistence, prebookNumbersBatch } from '../inventoryService';
import { logActivity } from '../../activities/activityService';
import { CommandRouter } from '../../../core/router/commandRouter';

const PREBOOK_STAGES = {
    AWAIT_NUMBERS: 'AWAIT_NUMBERS',
    CONFIRM: 'CONFIRM',
    SAVING: 'SAVING',
} as const;

type PrebookSession = {
    stage: keyof typeof PREBOOK_STAGES;
    data: {
        numbers: string[];
    };
};

const cancelBtn = { text: '❌ Cancel', callback_data: 'prebook_cancel' };

export async function startPrebookFlow(bot: TelegramBot, chatId: number) {
    setSession(chatId, 'prebook', {
        stage: 'AWAIT_NUMBERS',
        data: {
            numbers: []
        }
    });

    await bot.sendMessage(chatId, "📖 *Prebook Number(s)*\n\n*Step 1:* Please enter one or more 10-digit mobile numbers separated by comma or new line.", {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[cancelBtn]] }
    });
}

export function registerPrebookFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'prebook') as PrebookSession | undefined;
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
                    clearSession(chatId, 'prebook');
                    return;
                }

                session.data.numbers = existing;
                session.stage = 'CONFIRM';
                setSession(chatId, 'prebook', session);

                let statusMsg = `✅ Found ${existing.length} number(s).`;
                if (missing.length > 0) statusMsg += `\n⚠️ Rejected (not found): ${missing.length}`;

                const summary = `${statusMsg}\n\n*Confirm Prebook*\n\n` +
                    `📱 *Numbers:* ${existing.join(', ')}\n\n` +
                    `*Move these numbers to Prebooking list?*`;

                await bot.sendMessage(chatId, summary, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '✅ Confirm & Prebook', callback_data: 'prebook_confirm' }],
                            [cancelBtn]
                        ]
                    }
                });
                break;
            }
        }
    });

    router.registerCallback('prebook_confirm', async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'prebook') as PrebookSession | undefined;
        if (!session || session.stage !== 'CONFIRM') return;

        // Lock session
        session.stage = 'SAVING';
        setSession(chatId, 'prebook', session);

        // Remove buttons
        try {
            await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                chat_id: chatId,
                message_id: query.message!.message_id
            });
        } catch (e) {
            logger.warn('Failed to remove buttons in prebook: ' + (e as Error).message);
        }

        try {
            const creator = query.from.first_name + (query.from.last_name ? ' ' + query.from.last_name : '');
            const result = await prebookNumbersBatch(session.data.numbers, query.from.id.toString(), creator);

            await bot.sendMessage(chatId, `✅ *Numbers Prebooked!*\n\nSuccessfully moved ${result.successCount} number(s) to Prebookings.`, { parse_mode: 'Markdown' });

            // Log Activity
            await logActivity(bot, {
                employeeName: creator,
                action: 'Pre-Booked Numbers',
                description: `Prebooked ${result.successCount} numbers:\n${session.data.numbers.join(', ')}`,
                createdBy: creator,
                source: 'BOT',
                groupName: 'PREBOOKING'
            }, true);

            clearSession(chatId, 'prebook');
        } catch (error: any) {
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            clearSession(chatId, 'prebook');
        }
    });

    router.registerCallback('prebook_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'prebook');
        await bot.sendMessage(query.message!.chat.id, "❌ Prebook flow cancelled.");
    });
}
