import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { Reminder } from '../../../shared/types/data';
import { addReminder } from '../remindersService';
import { getAllUsers } from '../../users/userService';
import { logActivity } from '../../activities/activityService';
import { CommandRouter } from '../../../core/router/commandRouter';
import { formatToDDMMYYYY, parseFromDDMMYYYY } from '../../../shared/utils/dateUtils';

const ADD_REMINDER_STAGES = {
    AWAIT_NAME: 'AWAIT_NAME',
    AWAIT_DATE: 'AWAIT_DATE',
    AWAIT_ASSIGNMENT: 'AWAIT_ASSIGNMENT',
    CONFIRM: 'CONFIRM',
} as const;

type AddReminderSession = {
    stage: keyof typeof ADD_REMINDER_STAGES;
    data: Partial<Reminder>;
};

const cancelBtn = { text: '❌ Cancel', callback_data: 'add_rem_cancel' };

export async function startAddReminderFlow(bot: TelegramBot, chatId: number, username?: string) {
    setSession(chatId, 'addReminder', {
        stage: 'AWAIT_NAME',
        data: {}
    });

    await bot.sendMessage(chatId, "➕ *Add New Work Reminder*\n\n*Step 1:* What is the task name?", {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[cancelBtn]] }
    });
}

const parseDate = parseFromDDMMYYYY;

export function registerAddReminderFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'addReminder') as AddReminderSession | undefined;
        if (!session || !msg.text || msg.text === '/cancel') return;

        switch (session.stage) {
            case 'AWAIT_NAME':
                session.data.taskName = msg.text.trim();
                session.stage = 'AWAIT_DATE';
                setSession(msg.chat.id, 'addReminder', session);
                const today = formatToDDMMYYYY(new Date());
                await bot.sendMessage(msg.chat.id, `*Step 2:* Enter Due Date (DD/MM/YYYY):\n(Type 'today' for ${today})`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `📅 Today (${today})`, callback_data: 'add_rem_date_today' }],
                            [cancelBtn]
                        ]
                    }
                });
                break;

            case 'AWAIT_DATE':
                let dateStr = msg.text.trim().toLowerCase();
                let date: Date | null;
                
                if (dateStr === 'today') {
                    date = new Date();
                } else {
                    date = parseDate(msg.text);
                }

                if (!date) {
                    await bot.sendMessage(msg.chat.id, "❌ Invalid date format. Please use DD/MM/YYYY.");
                    return;
                }
                session.data.dueDate = date as any;
                session.stage = 'AWAIT_ASSIGNMENT';
                setSession(msg.chat.id, 'addReminder', session);

                const users = await getAllUsers();
                const userButtons = users.map(u => [{ text: u.displayName, callback_data: `add_rem_assign_${u.displayName}` }]);
                userButtons.push([cancelBtn]);

                await bot.sendMessage(msg.chat.id, "*Step 3:* Assign this task to:", {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: userButtons }
                });
                break;
        }
    });

    router.registerCallback('add_rem_date_today', async (query: TelegramBot.CallbackQuery) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'addReminder') as AddReminderSession | undefined;
        if (!session || session.stage !== 'AWAIT_DATE') return;

        session.data.dueDate = new Date() as any;
        session.stage = 'AWAIT_ASSIGNMENT';
        setSession(chatId, 'addReminder', session);

        const users = await getAllUsers();
        const userButtons = users.map(u => [{ text: u.displayName, callback_data: `add_rem_assign_${u.displayName}` }]);
        userButtons.push([cancelBtn]);

        await bot.sendMessage(chatId, "*Step 3:* Assign this task to:", {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: userButtons }
        });
    });

    router.registerCallback(/^add_rem_assign_/, async (query: TelegramBot.CallbackQuery) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'addReminder') as AddReminderSession | undefined;
        if (!session || session.stage !== 'AWAIT_ASSIGNMENT') return;

        const assignedName = query.data?.split('_').pop();
        session.data.assignedTo = [assignedName!];
        session.stage = 'CONFIRM';
        setSession(chatId, 'addReminder', session);

        const summary = `*Confirm New Reminder*\n\n` +
            `📝 *Task:* ${session.data.taskName}\n` +
            `📅 *Due Date:* ${formatToDDMMYYYY(session.data.dueDate as any)}\n` +
            `👤 *Assigned To:* ${session.data.assignedTo?.join(', ')}\n\n` +
            `Save this reminder?`;

        await bot.sendMessage(chatId, summary, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Confirm & Save', callback_data: 'add_rem_final_confirm' }],
                    [cancelBtn]
                ]
            }
        });
    });

    router.registerCallback('add_rem_final_confirm', async (query: TelegramBot.CallbackQuery) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'addReminder') as AddReminderSession | undefined;
        if (!session || session.stage !== 'CONFIRM') return;

        try {
            await addReminder(session.data);
            await bot.sendMessage(chatId, "✅ *Reminder Saved Successfully!*", { parse_mode: 'Markdown' });
            
            // Log activity
            const creator = query.from.first_name + (query.from.last_name ? ' ' + query.from.last_name : '');
            await logActivity(bot, {
                employeeName: creator,
                action: 'Added Reminder',
                description: `Created task "${session.data.taskName}" assigned to ${session.data.assignedTo?.join(', ')}`,
                source: 'BOT',
                createdBy: creator,
                groupName: 'WORK_REMINDERS'
            }, true);

            clearSession(chatId, 'addReminder');
        } catch (error: any) {
            logger.error(`Error saving reminder: ${error.message}`);
            await bot.sendMessage(chatId, "❌ Failed to save reminder. Please try again.");
            clearSession(chatId, 'addReminder');
        }
    });

    router.registerCallback('add_rem_cancel', async (query: TelegramBot.CallbackQuery) => {
        clearSession(query.message!.chat.id, 'addReminder');
        await bot.sendMessage(query.message!.chat.id, "❌ Action cancelled.");
    });
}
