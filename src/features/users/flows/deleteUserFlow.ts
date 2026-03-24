import TelegramBot from 'node-telegram-bot-api';
import { getAllUsers, deleteUser } from '../userService';
import { User } from '../../../shared/types/data';
import { setSession, getSession, clearSession } from '../../../core/bot/sessionManager';
import { logActivity } from '../../activities/activityService';
import { escapeMarkdown } from '../../../shared/utils/telegram';

const DELETE_STAGES = {
    AWAIT_USER_SELECTION: 'AWAIT_USER_SELECTION',
    AWAIT_CONFIRMATION: 'AWAIT_CONFIRMATION',
} as const;

type DeleteUserSession = {
    stage: keyof typeof DELETE_STAGES;
    userId?: string;
    displayName?: string;
};

const cancelBtn = { text: '❌ Cancel', callback_data: 'delete_user_cancel' };


export async function startDeleteUserFlow(bot: TelegramBot, chatId: number) {
    try {
        const users = await getAllUsers();
        if (users.length === 0) {
            await bot.sendMessage(chatId, "There are no users to delete.");
            return;
        }

        const userButtons = users.map((user: User) => ([{
            text: `${user.displayName} (@${user.telegramUsername || 'N/A'})`,
            callback_data: `delete_user_select_${user.id}`,
        }]));

        userButtons.push([cancelBtn]);

        setSession(chatId, 'deleteUser', {
            stage: 'AWAIT_USER_SELECTION',
        });

        await bot.sendMessage(chatId, "*Select a user to delete:*", {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: userButtons,
            },
        });
    } catch (error: any) {
        await bot.sendMessage(chatId, `❌ Error fetching users: ${error.message}`);
    }
}

async function handleUserSelection(bot: TelegramBot, callbackQuery: TelegramBot.CallbackQuery) {
    const chatId = callbackQuery.message!.chat.id;
    const session = getSession(chatId, 'deleteUser') as DeleteUserSession | undefined;
    if (!session || session.stage !== 'AWAIT_USER_SELECTION') return;

    const userId = callbackQuery.data?.replace('delete_user_select_', '');
    if (!userId) return;

    try {
        const users = await getAllUsers();
        const user = users.find(u => u.id === userId);
        if (!user) throw new Error('User not found.');

        session.stage = 'AWAIT_CONFIRMATION';
        session.userId = userId;
        session.displayName = user.displayName;
        setSession(chatId, 'deleteUser', session);

        await bot.answerCallbackQuery(callbackQuery.id);

        const name = escapeMarkdown(user.displayName);
        await bot.sendMessage(chatId, `Are you sure you want to delete user *${name}*?`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: "✅ Yes, I'm sure", callback_data: `delete_user_confirm_yes` },
                    cancelBtn,
                ]],
            },
        });
    } catch (error: any) {
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        clearSession(chatId, 'deleteUser');
    }
}

async function handleConfirmation(bot: TelegramBot, callbackQuery: TelegramBot.CallbackQuery) {
    const chatId = callbackQuery.message!.chat.id;
    const session = getSession(chatId, 'deleteUser') as DeleteUserSession | undefined;
    if (!session || session.stage !== 'AWAIT_CONFIRMATION' || !session.userId) return;

    const decision = callbackQuery.data;
    await bot.answerCallbackQuery(callbackQuery.id);

    if (decision === 'delete_user_confirm_yes') {
        try {
            await deleteUser(session.userId);
            const name = escapeMarkdown(session.displayName || '');
            const creator = callbackQuery.from.first_name + (callbackQuery.from.last_name ? ' ' + callbackQuery.from.last_name : '');

            await bot.sendMessage(chatId, `✅ Success! User *${name}* has been deleted.`, { parse_mode: 'Markdown' });

            // Log Activity
            await logActivity(bot, {
                employeeName: session.displayName || 'Unknown',
                action: 'DELETE_USER',
                description: `Deleted user ${session.displayName}`,
                createdBy: creator,
                source: 'BOT',
                groupName: 'USERS'
            }, true);
        } catch (error: any) {
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        } finally {
            clearSession(chatId, 'deleteUser');
        }
    }
}

import { CommandRouter } from '../../../core/router/commandRouter';
import { Guard } from '../../../core/auth/guard';
import { isAdmin } from '../../../core/auth/permissions';

export function registerDeleteUserFlow(router: CommandRouter) {
    const bot = router.bot;

    router.registerCallback('delete_user_cancel', Guard.adminOnlyCallback(bot, (query) => {
        const chatId = query.message!.chat.id;
        if (getSession(chatId, 'deleteUser')) {
            clearSession(chatId, 'deleteUser');
            bot.answerCallbackQuery(query.id, { text: 'Deletion cancelled' });
            bot.sendMessage(chatId, "❌ Deletion flow cancelled.");
        }
    }));

    router.registerCallback(/^delete_user_select_/, Guard.adminOnlyCallback(bot, (query) => {
        handleUserSelection(bot, query);
    }));

    router.registerCallback('delete_user_confirm_yes', Guard.adminOnlyCallback(bot, (query) => {
        handleConfirmation(bot, query);
    }));

    bot.on('message', async (message) => {
        if (message.text === '/cancel') {
            const chatId = message.chat.id;
            if (getSession(chatId, 'deleteUser')) {
                const username = message.from?.username;
                if (await isAdmin(username)) {
                    clearSession(chatId, 'deleteUser');
                    bot.sendMessage(chatId, "❌ Deletion flow cancelled.");
                }
            }
            return;
        }
    });
}
