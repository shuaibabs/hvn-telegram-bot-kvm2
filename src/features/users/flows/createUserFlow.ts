import TelegramBot from 'node-telegram-bot-api';
import { addUser, getAllUsers } from '../userService';
import { User } from '../../../shared/types/data';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { isValidEmail } from '../../../shared/utils/emailValidation';
import { logActivity } from '../../activities/activityService';
import { escapeMarkdown } from '../../../shared/utils/telegram';

const CREATE_STAGES = {
    AWAIT_NAME: 'AWAIT_NAME',
    AWAIT_EMAIL: 'AWAIT_EMAIL',
    AWAIT_ROLE: 'AWAIT_ROLE',
    AWAIT_TELEGRAM: 'AWAIT_TELEGRAM',
    AWAIT_PASSWORD: 'AWAIT_PASSWORD',
    CONFIRM: 'CONFIRM',
} as const;

type CreateUserSession = {
    stage: keyof typeof CREATE_STAGES;
    newUser: Partial<User> & { password?: string };
};

const cancelBtn = { text: '❌ Cancel', callback_data: 'cancel_flow' };

export async function startCreateUserFlow(bot: TelegramBot, chatId: number) {
    setSession(chatId, 'createUser', {
        stage: 'AWAIT_NAME',
        newUser: {},
    });
    await bot.sendMessage(chatId, "Let's create a new user. What is their full name?\n\n(Type /cancel to stop)", {
        reply_markup: {
            inline_keyboard: [[cancelBtn]]
        }
    });
}

async function handleNameInput(bot: TelegramBot, msg: TelegramBot.Message) {
    const session = getSession(msg.chat.id, 'createUser') as CreateUserSession | undefined;
    if (!session || session.stage !== 'AWAIT_NAME') return;

    const name = msg.text?.trim();
    if (name === '/cancel') return; // Handled by global command potentially, but safe here

    if (!name) {
        await bot.sendMessage(msg.chat.id, "Name cannot be empty. Please enter the user's full name.");
        return;
    }

    session.newUser.displayName = name;
    session.stage = 'AWAIT_EMAIL';
    setSession(msg.chat.id, 'createUser', session);

    await bot.sendMessage(msg.chat.id, `Got it. Now, what is ${name}'s email address?\n\n(Type /cancel to stop)`, {
        reply_markup: {
            inline_keyboard: [[cancelBtn]]
        }
    });
}

async function handleEmailInput(bot: TelegramBot, msg: TelegramBot.Message) {
    const session = getSession(msg.chat.id, 'createUser') as CreateUserSession | undefined;
    if (!session || session.stage !== 'AWAIT_EMAIL') return;

    const email = msg.text?.trim();
    if (email === '/cancel') return;

    if (!email || !isValidEmail(email)) {
        await bot.sendMessage(msg.chat.id, "That doesn't look like a valid email. Please try again.", {
            reply_markup: {
                inline_keyboard: [[cancelBtn]]
            }
        });
        return;
    }

    // Check if email already exists
    try {
        const users = await getAllUsers();
        if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
            await bot.sendMessage(msg.chat.id, `❌ The email *${email}* is already in use. Please enter a different email address.`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[cancelBtn]]
                }
            });
            return;
        }
    } catch (error: any) {
        logger.error('Error checking duplicate email: ' + error.message);
    }

    session.newUser.email = email;
    session.stage = 'AWAIT_ROLE';
    setSession(msg.chat.id, 'createUser', session);

    await bot.sendMessage(msg.chat.id, 'What role should this user have?', {
        reply_markup: {
            inline_keyboard: [
                [{
                    text: '👑 Admin',
                    callback_data: 'create_user_role_admin'
                }, {
                    text: '👷 Employee',
                    callback_data: 'create_user_role_employee'
                }],
                [cancelBtn]
            ],
        },
    });
}

async function handleRoleSelection(bot: TelegramBot, callbackQuery: TelegramBot.CallbackQuery) {
    const session = getSession(callbackQuery.message!.chat.id, 'createUser') as CreateUserSession | undefined;
    if (!session || session.stage !== 'AWAIT_ROLE') return;

    const role = callbackQuery.data === 'create_user_role_admin' ? 'admin' : 'employee';
    session.newUser.role = role;
    session.stage = 'AWAIT_TELEGRAM';
    setSession(callbackQuery.message!.chat.id, 'createUser', session);

    await bot.answerCallbackQuery(callbackQuery.id);
    await bot.sendMessage(callbackQuery.message!.chat.id, `Role set to ${role}. Finally, what is their Telegram username? (e.g., @username)\n\n(Type /cancel to stop)`, {
        reply_markup: {
            inline_keyboard: [[cancelBtn]]
        }
    });
}

async function handleTelegramInput(bot: TelegramBot, msg: TelegramBot.Message) {
    const session = getSession(msg.chat.id, 'createUser') as CreateUserSession | undefined;
    if (!session || session.stage !== 'AWAIT_TELEGRAM') return;

    const text = msg.text?.trim();
    if (text === '/cancel') return;

    const username = text?.replace(/^@/, '');
    if (!username) {
        await bot.sendMessage(msg.chat.id, "Username cannot be empty. Please enter their Telegram username.", {
            reply_markup: {
                inline_keyboard: [[cancelBtn]]
            }
        });
        return;
    }

    session.newUser.telegramUsername = username;
    session.stage = 'AWAIT_PASSWORD';
    setSession(msg.chat.id, 'createUser', session);

    await bot.sendMessage(msg.chat.id, "Almost done! Please enter a temporary password for this user.\n\n(Type /cancel to stop)", {
        reply_markup: {
            inline_keyboard: [[cancelBtn]]
        }
    });
}

async function handlePasswordInput(bot: TelegramBot, msg: TelegramBot.Message) {
    const session = getSession(msg.chat.id, 'createUser') as CreateUserSession | undefined;
    if (!session || session.stage !== 'AWAIT_PASSWORD') return;

    const password = msg.text?.trim();
    if (password === '/cancel') return;

    if (!password || password.length < 6) {
        await bot.sendMessage(msg.chat.id, "Password must be at least 6 characters long. Please try again.", {
            reply_markup: {
                inline_keyboard: [[cancelBtn]]
            }
        });
        return;
    }

    session.newUser.password = password;
    session.stage = 'CONFIRM';
    setSession(msg.chat.id, 'createUser', session);

    await sendConfirmation(bot, msg.chat.id, session);
}


async function sendConfirmation(bot: TelegramBot, chatId: number, session: CreateUserSession) {
    const displayName = escapeMarkdown(session.newUser.displayName || '');
    const email = escapeMarkdown(session.newUser.email || '');
    const role = escapeMarkdown(session.newUser.role || '');
    const telegramUsername = escapeMarkdown(session.newUser.telegramUsername || '');

    const text = `Please confirm the details:\n\n*Name*: ${displayName}\n*Email*: ${email}\n*Role*: ${role}\n*Telegram*: @${telegramUsername}\n*Password*: \`*******\`\n\nDoes this look correct?`;

    await bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{
                text: '✅ Yes, Create User',
                callback_data: 'create_user_confirm_yes'
            }], [{
                text: '🔄 No, Start Over',
                callback_data: 'create_user_confirm_no'
            }], [cancelBtn]],
        },
    });
}

async function handleConfirmation(bot: TelegramBot, callbackQuery: TelegramBot.CallbackQuery) {
    const session = getSession(callbackQuery.message!.chat.id, 'createUser') as CreateUserSession | undefined;
    if (!session || session.stage !== 'CONFIRM') return;

    const decision = callbackQuery.data;
    const chatId = callbackQuery.message!.chat.id;

    await bot.answerCallbackQuery(callbackQuery.id);

    if (decision === 'create_user_confirm_yes') {
        try {
            const { password, ...userData } = session.newUser;
            await addUser(userData as User, password);
            const name = escapeMarkdown(session.newUser.displayName || '');
            const creator = callbackQuery.from.first_name + (callbackQuery.from.last_name ? ' ' + callbackQuery.from.last_name : '');

            await bot.sendMessage(chatId, `✅ Success! User *${name}* has been created.`, { parse_mode: 'Markdown' });

            // Log Activity
            await logActivity(bot, {
                employeeName: session.newUser.displayName || 'Unknown',
                action: 'CREATE_USER',
                description: `Created new user ${session.newUser.displayName} with role ${session.newUser.role}`,
                createdBy: creator,
                source: 'BOT',
                groupName: 'USERS'
            }, true); // shouldBroadcast = true for successful completion

            clearSession(chatId, 'createUser');
        } catch (error: any) {
            await bot.sendMessage(chatId, `❌ An error occurred: ${error.message}`);
            // Keep session for retry if needed? For now just clear
            clearSession(chatId, 'createUser');
        }
    } else {
        await bot.sendMessage(chatId, "Let's start over.");
        await startCreateUserFlow(bot, chatId);
    }
}

import { CommandRouter } from '../../../core/router/commandRouter';
import { Guard } from '../../../core/auth/guard';
import { isAdmin } from '../../../core/auth/permissions';

export function registerCreateUserFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg) => {
        if (msg.text === '/cancel') {
            if (getSession(msg.chat.id, 'createUser')) {
                clearSession(msg.chat.id, 'createUser');
                bot.sendMessage(msg.chat.id, "❌ Creation flow cancelled.");
            }
            return;
        }

        const session = getSession(msg.chat.id, 'createUser') as CreateUserSession | undefined;
        if (!session) return;

        // Security check: Only admins should be able to continue the create user flow
        // (This handles text input stage)
        const username = msg.from?.username;
        const allowed = await isAdmin(username);
        if (!allowed) return;

        switch (session.stage) {
            case 'AWAIT_NAME':
                handleNameInput(bot, msg);
                break;
            case 'AWAIT_EMAIL':
                handleEmailInput(bot, msg);
                break;
            case 'AWAIT_TELEGRAM':
                handleTelegramInput(bot, msg);
                break;
            case 'AWAIT_PASSWORD':
                handlePasswordInput(bot, msg);
                break;
        }
    });

    // Callbacks protected by Guard
    router.registerCallback('cancel_flow', Guard.adminOnlyCallback(bot, (query) => {
        if (getSession(query.message!.chat.id, 'createUser')) {
            clearSession(query.message!.chat.id, 'createUser');
            bot.answerCallbackQuery(query.id, { text: 'Flow cancelled' });
            bot.sendMessage(query.message!.chat.id, "❌ Creation flow cancelled.");
        }
    }));

    router.registerCallback(/^create_user_role_/, Guard.adminOnlyCallback(bot, (query) => {
        handleRoleSelection(bot, query);
    }));

    router.registerCallback(/^create_user_confirm_/, Guard.adminOnlyCallback(bot, (query) => {
        handleConfirmation(bot, query);
    }));
}
