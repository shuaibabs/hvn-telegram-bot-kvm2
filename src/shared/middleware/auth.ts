import TelegramBot from 'node-telegram-bot-api';
import { getUserByTelegramUsername } from '../../features/users/userService';
import { User } from '../../shared/types/data';
import { RESPONSES } from '../utils/telegram';

const isAdmin = (user: User | null): user is User => {
    return user?.role === 'admin';
};

/**
 * Ensures the sender is a registered user.
 */
export const authorized = (
    bot: TelegramBot,
    handler: (msg: TelegramBot.Message, match: RegExpExecArray | null, username: string) => void
) => async (msg: TelegramBot.Message, match: RegExpExecArray | null) => {

    const telegramUsername = msg.from?.username;
    if (!telegramUsername) {
        bot.sendMessage(msg.chat.id, RESPONSES.ERROR("We couldn't get your Telegram username. Please set one in your Settings."), { parse_mode: 'Markdown' });
        return;
    }

    const user = await getUserByTelegramUsername(telegramUsername);
    if (!user) {
        bot.sendMessage(msg.chat.id, RESPONSES.WARNING("You are not authorized to use this bot. Please contact the Admin."), { parse_mode: 'Markdown' });
        return;
    }

    const displayName = user.displayName || user.email || telegramUsername;
    handler(msg, match, displayName);
};

/**
 * Ensures the sender is an Admin.
 */
export const adminOnly = (
    bot: TelegramBot,
    handler: (msg: TelegramBot.Message, match: RegExpExecArray | null, username: string) => void
) => authorized(bot, async (msg, match, username) => {
    const telegramUsername = msg.from?.username;

    if (!telegramUsername) {
        bot.sendMessage(msg.chat.id, RESPONSES.ERROR("We couldn't get your Telegram username. Please set one in your Settings."), { parse_mode: 'Markdown' });
        return;
    }

    const user = await getUserByTelegramUsername(telegramUsername);

    if (!isAdmin(user)) {
        bot.sendMessage(msg.chat.id, RESPONSES.WARNING("⛔ **Admin Only Command.**\nAccess denied."), { parse_mode: 'Markdown' });
        return;
    }

    handler(msg, match, username);
});
