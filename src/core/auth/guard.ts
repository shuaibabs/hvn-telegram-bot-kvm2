import TelegramBot from 'node-telegram-bot-api';
import { isAdmin, hasRole } from './permissions';
import { db } from '../../config/firebase';
import { logger } from '../logger/logger';

export class Guard {
    /**
     * Protector for callback queries.
     * Ensures only admins can trigger the wrapped handler.
     */
    static adminOnlyCallback(bot: TelegramBot, handler: (query: TelegramBot.CallbackQuery) => void | Promise<void>) {
        return async (query: TelegramBot.CallbackQuery) => {
            const username = query.from.username;
            if (!username) {
                await bot.answerCallbackQuery(query.id, { text: "No Telegram username set", show_alert: true });
                return;
            }

            try {
                const allowed = await isAdmin(username);
                if (!allowed) {
                    await this.handleDenial(bot, query, "admin");
                    return;
                }
            } catch (error) {
                logger.error(`Error in adminOnlyCallback: ${error}`);
                try {
                    await bot.answerCallbackQuery(query.id, { text: "⚠️ Database service unavailable. Please try later.", show_alert: true });
                } catch (ansErr) {
                    logger.warn(`Failed to answer callback query in error path: ${ansErr}`);
                }
                return;
            }

            await handler(query);
        };
    }

    /**
     * Protector for text commands.
     * Ensures only admins can trigger the wrapped handler.
     */
    static adminOnlyCommand(bot: TelegramBot, handler: (msg: TelegramBot.Message, match: RegExpExecArray | null) => void | Promise<void>) {
        return async (msg: TelegramBot.Message, match: RegExpExecArray | null) => {
            const username = msg.from?.username;
            if (!username) {
                await bot.sendMessage(msg.chat.id, "❌ Error: You need a Telegram username for this command.");
                return;
            }

            try {
                const allowed = await isAdmin(username);
                if (!allowed) {
                    await this.handleDenialCommand(bot, msg, "admin");
                    return;
                }
            } catch (error) {
                logger.error(`Error in adminOnlyCommand: ${error}`);
                await bot.sendMessage(msg.chat.id, "⚠️ Database service unavailable. Please try later.");
                return;
            }

            await handler(msg, match);
        };
    }

    /**
     * Protector for callback queries.
     * Ensures only registered users (admin or employee) can trigger.
     */
    static registeredOnlyCallback(bot: TelegramBot, handler: (query: TelegramBot.CallbackQuery) => void | Promise<void>) {
        return async (query: TelegramBot.CallbackQuery) => {
            const username = query.from.username;
            if (!username) {
                await bot.answerCallbackQuery(query.id, { text: "No Telegram username set", show_alert: true });
                return;
            }

            try {
                const isRegistered = await hasRole(username, 'employee'); // hasRole('employee') returns true for admins too
                if (!isRegistered) {
                    await this.handleDenial(bot, query, "registered");
                    return;
                }
            } catch (error) {
                logger.error(`Error in registeredOnlyCallback: ${error}`);
                try {
                    await bot.answerCallbackQuery(query.id, { text: "⚠️ Database service unavailable. Please try later.", show_alert: true });
                } catch (ansErr) {
                    logger.warn(`Failed to answer callback query in error path: ${ansErr}`);
                }
                return;
            }

            await handler(query);
        };
    }

    /**
     * Protector for text commands.
     * Ensures only registered users (admin or employee) can trigger.
     */
    static registeredOnlyCommand(bot: TelegramBot, handler: (msg: TelegramBot.Message, match: RegExpExecArray | null) => void | Promise<void>) {
        return async (msg: TelegramBot.Message, match: RegExpExecArray | null) => {
            const username = msg.from?.username;
            if (!username) {
                await bot.sendMessage(msg.chat.id, "❌ Error: You need a Telegram username for this command.");
                return;
            }

            try {
                const isRegistered = await hasRole(username, 'employee');
                if (!isRegistered) {
                    await this.handleDenialCommand(bot, msg, "registered");
                    return;
                }
            } catch (error) {
                logger.error(`Error in registeredOnlyCommand: ${error}`);
                await bot.sendMessage(msg.chat.id, "⚠️ Database service unavailable. Please try later.");
                return;
            }

            await handler(msg, match);
        };
    }

    private static async handleDenial(bot: TelegramBot, query: TelegramBot.CallbackQuery, requiredRole: string) {
        try {
            const username = query.from.username;
            const usersRef = db.collection('users');
            const querySnapshot = await usersRef.where('telegramUsername', '==', username).get();

            const message = querySnapshot.empty
                ? `❌ Access Denied: Your account (@${username}) is not registered.`
                : `❌ Permission Denied: This action requires ${requiredRole} privileges.`;

            try {
                await bot.answerCallbackQuery(query.id, { text: "Permission Denied", show_alert: true });
            } catch (ansErr: any) {
                if (!ansErr.message?.includes('query is too old')) {
                    logger.warn(`Failed to answer permission denial callback: ${ansErr.message}`);
                }
            }

            if (query.message) {
                await bot.sendMessage(query.message.chat.id, message);
            }
        } catch (error) {
            logger.error(`Error in handleDenial: ${error}`);
            try {
                await bot.answerCallbackQuery(query.id, { text: "❌ Permission check failed (Database error).", show_alert: true });
            } catch (ansErr) {
                logger.warn(`Failed to answer handleDenial error callback: ${ansErr}`);
            }
        }
    }

    private static async handleDenialCommand(bot: TelegramBot, msg: TelegramBot.Message, requiredRole: string) {
        try {
            const username = msg.from?.username;
            const usersRef = db.collection('users');
            const querySnapshot = await usersRef.where('telegramUsername', '==', username).get();

            const message = querySnapshot.empty
                ? `❌ Access Denied: Your account (@${username}) is not registered.`
                : `❌ Permission Denied: This command requires ${requiredRole} privileges.`;

            await bot.sendMessage(msg.chat.id, message);
        } catch (error) {
            logger.error(`Error in handleDenialCommand: ${error}`);
            await bot.sendMessage(msg.chat.id, "❌ Permission check failed due to a database error.");
        }
    }
}
