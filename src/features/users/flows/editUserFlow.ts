import TelegramBot from 'node-telegram-bot-api';
import { getAllUsers, updateUserTelegramUsername, updateUserDisplayName } from '../userService';
import { User } from '../../../shared/types/data';
import { setSession, getSession, clearSession } from '../../../core/bot/sessionManager';
import { logActivity } from '../../activities/activityService';
import { escapeMarkdown } from '../../../shared/utils/telegram';
import { CommandRouter } from '../../../core/router/commandRouter';
import { Guard } from '../../../core/auth/guard';
import { isAdmin } from '../../../core/auth/permissions';

const EDIT_STAGES = {
    AWAIT_USER_SELECTION: 'AWAIT_USER_SELECTION',
    AWAIT_FIELD_SELECTION: 'AWAIT_FIELD_SELECTION',
    AWAIT_NEW_NAME: 'AWAIT_NEW_NAME',
    AWAIT_NEW_USERNAME: 'AWAIT_NEW_USERNAME',
} as const;

type EditUserSession = {
    stage: keyof typeof EDIT_STAGES;
    userId?: string;
    displayName?: string;
};

const cancelBtn = { text: '❌ Cancel', callback_data: 'edit_user_cancel' };


export async function startEditUserFlow(bot: TelegramBot, chatId: number) {
    try {
        const users = await getAllUsers();

        if (users.length === 0) {
            await bot.sendMessage(chatId, "There are no users to edit.");
            return;
        }

        const userButtons = users.map((user: User) => ([{
            text: `${user.displayName} - @${user.telegramUsername || 'N/A'}`,
            callback_data: `edit_user_select_${user.id}`
        }]));

        userButtons.push([cancelBtn]);

        const options = {
            reply_markup: {
                inline_keyboard: userButtons
            }
        };

        setSession(chatId, 'editUser', {
            stage: 'AWAIT_USER_SELECTION',
        });
        await bot.sendMessage(chatId, "*Select a user to edit:*", { parse_mode: 'Markdown', ...options });

    } catch (error: any) {
        await bot.sendMessage(chatId, `❌ Error fetching users: ${error.message}`);
    }
}

async function handleUserSelection(bot: TelegramBot, callbackQuery: TelegramBot.CallbackQuery) {
    const msg = callbackQuery.message;
    if (!msg) return;

    const chatId = msg.chat.id;
    const session = getSession(chatId, 'editUser') as EditUserSession | undefined;
    if (!session || session.stage !== 'AWAIT_USER_SELECTION') return;

    const userId = callbackQuery.data?.replace('edit_user_select_', '');
    if (!userId) return;

    try {
        const users = await getAllUsers();
        const user = users.find(u => u.id === userId);
        if (!user) throw new Error('User not found.');

        session.stage = 'AWAIT_FIELD_SELECTION';
        session.userId = userId;
        session.displayName = user.displayName;
        setSession(chatId, 'editUser', session);

        await bot.answerCallbackQuery(callbackQuery.id);

        const name = escapeMarkdown(user.displayName);
        const username = escapeMarkdown(user.telegramUsername || 'N/A');

        await bot.sendMessage(chatId, `Editing user: *${name}* (@${username})\n\nWhat would you like to update?`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📝 Edit Name', callback_data: 'edit_user_field_name' }],
                    [{ text: '👤 Edit Username', callback_data: 'edit_user_field_username' }],
                    [cancelBtn]
                ]
            }
        });
    } catch (error: any) {
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        clearSession(chatId, 'editUser');
    }
}

async function handleFieldSelection(bot: TelegramBot, callbackQuery: TelegramBot.CallbackQuery) {
    const chatId = callbackQuery.message!.chat.id;
    const session = getSession(chatId, 'editUser') as EditUserSession | undefined;
    if (!session || session.stage !== 'AWAIT_FIELD_SELECTION') return;

    const field = callbackQuery.data;
    await bot.answerCallbackQuery(callbackQuery.id);

    if (field === 'edit_user_field_name') {
        session.stage = 'AWAIT_NEW_NAME';
        setSession(chatId, 'editUser', session);
        await bot.sendMessage(chatId, `Enter the new full name for *${escapeMarkdown(session.displayName || '')}*:\n\n(Type /cancel to stop)`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[cancelBtn]] }
        });
    } else {
        session.stage = 'AWAIT_NEW_USERNAME';
        setSession(chatId, 'editUser', session);
        await bot.sendMessage(chatId, `Enter the new Telegram username for *${escapeMarkdown(session.displayName || '')}* (e.g., @username):\n\n(Type /cancel to stop)`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[cancelBtn]] }
        });
    }
}

async function handleNameInput(bot: TelegramBot, message: TelegramBot.Message) {
    const chatId = message.chat.id;
    const session = getSession(chatId, 'editUser') as EditUserSession | undefined;
    if (!session || session.stage !== 'AWAIT_NEW_NAME' || !session.userId) return;

    const newName = message.text?.trim();
    if (!newName || newName === '/cancel') return;

    try {
        await updateUserDisplayName(session.userId, newName);
        const name = escapeMarkdown(newName);
        const creator = message.from?.first_name + (message.from?.last_name ? ' ' + message.from?.last_name : '');

        await bot.sendMessage(chatId, `✅ Success! Name updated to *${name}*.`, { parse_mode: 'Markdown' });

        // Log Activity
        await logActivity(bot, {
            employeeName: session.displayName || 'Unknown',
            action: 'UPDATE_USER_NAME',
            description: `Updated name for user ${session.displayName} to ${newName}`,
            createdBy: creator,
            source: 'BOT',
            groupName: 'USERS'
        }, true);
    } catch (error: any) {
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    } finally {
        clearSession(chatId, 'editUser');
    }
}

async function handleUsernameInput(bot: TelegramBot, message: TelegramBot.Message) {
    const chatId = message.chat.id;
    const session = getSession(chatId, 'editUser') as EditUserSession | undefined;
    if (!session || session.stage !== 'AWAIT_NEW_USERNAME' || !session.userId) return;

    const newUsername = message.text?.trim().replace(/^@/, '');
    if (!newUsername || message.text === '/cancel') return;

    try {
        await updateUserTelegramUsername(session.userId, newUsername);
        const username = escapeMarkdown(newUsername);
        const creator = message.from?.first_name + (message.from?.last_name ? ' ' + message.from?.last_name : '');

        await bot.sendMessage(chatId, `✅ Success! Username updated to @${username}.`, { parse_mode: 'Markdown' });

        // Log Activity
        await logActivity(bot, {
            employeeName: session.displayName || 'Unknown',
            action: 'UPDATE_USER_USERNAME',
            description: `Updated telegram username for user ${session.displayName} to @${newUsername}`,
            createdBy: creator,
            source: 'BOT',
            groupName: 'USERS'
        }, true);
    } catch (error: any) {
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    } finally {
        clearSession(chatId, 'editUser');
    }
}

export function registerEditUserFlow(router: CommandRouter) {
    const bot = router.bot;

    router.registerCallback('edit_user_cancel', Guard.adminOnlyCallback(bot, (query) => {
        const chatId = query.message!.chat.id;
        if (getSession(chatId, 'editUser')) {
            clearSession(chatId, 'editUser');
            bot.answerCallbackQuery(query.id, { text: 'Edit cancelled' });
            bot.sendMessage(chatId, "❌ Edit flow cancelled.");
        }
    }));

    router.registerCallback(/^edit_user_select_/, Guard.adminOnlyCallback(bot, (query) => {
        handleUserSelection(bot, query);
    }));

    router.registerCallback(/^edit_user_field_/, Guard.adminOnlyCallback(bot, (query) => {
        handleFieldSelection(bot, query);
    }));

    bot.on('message', async (message) => {
        if (message.text === '/cancel') {
            const chatId = message.chat.id;
            if (getSession(chatId, 'editUser')) {
                const username = message.from?.username;
                if (await isAdmin(username)) {
                    clearSession(chatId, 'editUser');
                    bot.sendMessage(chatId, "❌ Edit flow cancelled.");
                }
            }
            return;
        }

        const session = getSession(message.chat.id, 'editUser') as EditUserSession | undefined;
        if (!session) return;

        // Security check
        const username = message.from?.username;
        if (!(await isAdmin(username))) return;

        if (session.stage === 'AWAIT_NEW_NAME') {
            handleNameInput(bot, message);
        } else if (session.stage === 'AWAIT_NEW_USERNAME') {
            handleUsernameInput(bot, message);
        }
    });
}
