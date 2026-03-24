import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { validateNumbersExistence, assignNumbersToUser } from '../inventoryService';
import { getAllUsers } from '../../users/userService';
import { logActivity } from '../../activities/activityService';
import { CommandRouter } from '../../../core/router/commandRouter';

const ASSIGN_USER_STAGES = {
    AWAIT_NUMBERS: 'AWAIT_NUMBERS',
    AWAIT_USER_SELECTION: 'AWAIT_USER_SELECTION',
    CONFIRM: 'CONFIRM',
} as const;

type AssignUserSession = {
    stage: keyof typeof ASSIGN_USER_STAGES;
    data: {
        numbers: string[];
        assignedTo?: string;
    };
};

const cancelBtn = { text: '❌ Cancel', callback_data: 'assign_user_cancel' };

export async function startAssignToUserFlow(bot: TelegramBot, chatId: number) {
    setSession(chatId, 'assignToUser', {
        stage: 'AWAIT_NUMBERS',
        data: {
            numbers: []
        }
    });

    await bot.sendMessage(chatId, "👤 *Assign Number(s) to User*\n\n*Step 1:* Please enter one or more 10-digit mobile numbers separated by comma or new line.", {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[cancelBtn]] }
    });
}

export function registerAssignToUserFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'assignToUser') as AssignUserSession | undefined;
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
                    clearSession(chatId, 'assignToUser');
                    return;
                }

                session.data.numbers = existing;
                session.stage = 'AWAIT_USER_SELECTION';
                setSession(chatId, 'assignToUser', session);

                const users = await getAllUsers();
                const userButtons = users.map(u => [{ text: u.displayName, callback_data: `assn_usr_uid_${u.uid}` }]);
                userButtons.push([{ text: '🔓 Unassigned', callback_data: 'assn_usr_uid_Unassigned' }]);
                userButtons.push([cancelBtn]);

                let statusMsg = `✅ Found ${existing.length} number(s).`;
                if (missing.length > 0) statusMsg += `\n⚠️ Rejected (not found): ${missing.length}`;

                await bot.sendMessage(chatId, `${statusMsg}\n\n*Step 2:* Select user to assign these numbers:`, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: userButtons }
                });
                break;
            }
        }
    });

    router.registerCallback(/^assn_usr_uid_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'assignToUser') as AssignUserSession | undefined;
        if (!session || session.stage !== 'AWAIT_USER_SELECTION') return;

        const val = query.data?.split('_').pop();
        if (val === 'Unassigned') {
            session.data.assignedTo = 'Unassigned';
        } else {
            const users = await getAllUsers();
            const user = users.find(u => u.uid === val);
            session.data.assignedTo = user?.displayName || 'Unassigned';
        }

        session.stage = 'CONFIRM';
        setSession(chatId, 'assignToUser', session);

        const summary = `*Confirm Assignment*\n\n` +
            `📱 *Numbers:* ${session.data.numbers.join(', ')}\n` +
            `👤 *Assign To:* ${session.data.assignedTo}\n\n` +
            `*Proceed with assignment?*`;

        await bot.sendMessage(chatId, summary, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Confirm & Assign', callback_data: 'assn_usr_confirm' }],
                    [cancelBtn]
                ]
            }
        });
    });

    router.registerCallback('assn_usr_confirm', async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'assignToUser') as AssignUserSession | undefined;
        if (!session || session.stage !== 'CONFIRM') return;

        try {
            const creator = query.from.first_name + (query.from.last_name ? ' ' + query.from.last_name : '');
            const result = await assignNumbersToUser(session.data.numbers, session.data.assignedTo!, creator);

            await bot.sendMessage(chatId, `✅ *Assignment Successful!*\n\nSuccessfully assigned ${result.successCount} number(s) to *${session.data.assignedTo}*.`, { parse_mode: 'Markdown' });

            // Log Activity
            await logActivity(bot, {
                employeeName: creator,
                action: 'Assigned Numbers',
                description: `Assigned ${result.successCount} numbers to ${session.data.assignedTo}:\n${session.data.numbers.join(', ')}`,
                createdBy: creator,
                source: 'BOT',
                groupName: 'SIM_LOCATIONS'
            }, true);

            clearSession(chatId, 'assignToUser');
        } catch (error: any) {
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            clearSession(chatId, 'assignToUser');
        }
    });

    router.registerCallback('assign_user_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'assignToUser');
        await bot.sendMessage(query.message!.chat.id, "❌ Assignment flow cancelled.");
    });
}
