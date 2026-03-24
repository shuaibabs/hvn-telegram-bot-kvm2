import TelegramBot from 'node-telegram-bot-api';
import { hasAnySession } from '../bot/sessionManager';
import { logger } from '../logger/logger';
import { env } from '../../config/env';

export interface CommandCallback {
    (msg: TelegramBot.Message, match: RegExpExecArray | null): void;
}

export interface CallbackCallback {
    (query: TelegramBot.CallbackQuery): void;
}

export interface RegisteredCommand {
    pattern: RegExp;
    callback: CommandCallback;
    allowedGroupIds?: string[];
}

export interface RegisteredCallback {
    data: string | RegExp;
    callback: CallbackCallback;
    allowedGroupIds?: string[];
}

export class CommandRouter {
    private commands: RegisteredCommand[] = [];
    private callbacks: RegisteredCallback[] = [];
    private fallbackHandler: ((msg: TelegramBot.Message) => void) | null = null;
    public bot: TelegramBot;

    constructor(bot: TelegramBot) {
        this.bot = bot;
    }

    register(pattern: RegExp, callback: CommandCallback, allowedGroupIds?: string[]) {
        this.commands.push({ pattern, callback, allowedGroupIds });
    }

    registerCallback(data: string | RegExp, callback: CallbackCallback, allowedGroupIds?: string[]) {
        this.callbacks.push({ data, callback, allowedGroupIds });
    }

    setFallbackHandler(handler: (msg: TelegramBot.Message) => void) {
        this.fallbackHandler = handler;
    }

    listen() {
        // Handle text commands
        this.bot.on('message', (msg: TelegramBot.Message) => {
            const user = msg.from;
            const userName = user ? `${user.first_name}${user.last_name ? ' ' + user.last_name : ''}` : 'Unknown';
            const userHandle = user?.username ? ` (@${user.username})` : '';
            logger.info(`[MESSAGE] From: ${userName}${userHandle} [ID: ${user?.id}] | Text: ${msg.text || '[No Text]'}`);

            this.handleMessage(msg).catch(err => {
                logger.error(`[FATAL] Error in handleMessage promise: ${err.stack || err}`);
            });
        });

        // Handle inline button clicks (callback queries)
        this.bot.on('callback_query', (query: TelegramBot.CallbackQuery) => {
            const user = query.from;
            const userName = user.first_name + (user.last_name ? ' ' + user.last_name : '');
            const userHandle = user.username ? ` (@${user.username})` : '';
            logger.info(`[CALLBACK] From: ${userName}${userHandle} [ID: ${user.id}] | Data: ${query.data}`);

            this.handleCallbackQuery(query).catch(err => {
                logger.error(`[FATAL] Error in handleCallbackQuery promise: ${err.stack || err}`);
            });
        });
    }

    private async handleMessage(msg: TelegramBot.Message) {
        if (!msg.text) return;

        const chatId = msg.chat.id.toString();
        const text = msg.text.trim();

        const startRegex = /^(?:\/start|start)$/i;
        const isStart = startRegex.test(text);

        let matched = false;

        for (const cmd of this.commands) {
            const patternToUse = isStart && cmd.pattern.source.includes('start') ? startRegex : cmd.pattern;

            const match = patternToUse.exec(text);
            if (match) {
                if (cmd.allowedGroupIds && cmd.allowedGroupIds.length > 0) {
                    if (cmd.allowedGroupIds.indexOf(chatId) === -1) continue;
                }

                try {
                    await cmd.callback(msg, match);
                } catch (error) {
                    await this.handleError(error, msg);
                }
                matched = true;
                break;
            }
        }

        if (matched) return;

        // If not a command, check if user is in a session
        if (hasAnySession(msg.chat.id)) {
            return;
        }

        if (this.fallbackHandler) {
            try {
                await this.fallbackHandler(msg);
            } catch (error) {
                await this.handleError(error, msg);
            }
        }
    }

    private async handleCallbackQuery(query: TelegramBot.CallbackQuery) {
        if (!query.data) return;

        const chatId = query.message?.chat.id.toString();
        const data = query.data;

        for (const cb of this.callbacks) {
            let isMatch = false;
            if (typeof cb.data === 'string') {
                isMatch = cb.data === data;
            } else if (cb.data instanceof RegExp) {
                isMatch = cb.data.test(data);
            }

            if (isMatch) {
                // Check group permissions if chatId is available
                if (chatId && cb.allowedGroupIds && cb.allowedGroupIds.length > 0) {
                    if (cb.allowedGroupIds.indexOf(chatId) === -1) continue;
                }

                try {
                    await cb.callback(query);
                    // Answer callback query to stop the loading icon in Telegram
                    try {
                        await this.bot.answerCallbackQuery(query.id);
                    } catch (ansErr: any) {
                        // Ignore harmless "query too old" errors
                        if (!ansErr.message?.includes('query is too old')) {
                            logger.warn(`Failed to answer callback query: ${ansErr.message}`);
                        }
                    }
                } catch (error) {
                    await this.handleError(error, query);
                }
                return;
            }
        }
    }

    private async handleError(error: any, context: TelegramBot.Message | TelegramBot.CallbackQuery) {
        const isCallback = 'data' in context;
        const msg = isCallback ? (context as TelegramBot.CallbackQuery).message : (context as TelegramBot.Message);
        const chatId = msg?.chat.id;
        const userId = context.from?.id;
        const username = context.from?.username || 'Unknown';

        logger.error(`[CRASH PREVENTION] Error triggered by @${username} (ID: ${userId}): ${error.message || error}`);
        if (error.stack) logger.error(error.stack);

        let userMessage = "❌ *An unexpected error occurred.*";
        
        // Detect Firestore Quota Exhaustion (Code 8)
        if (error.message?.includes('RESOURCE_EXHAUSTED') || error.code === 8 || error.details?.includes('Quota exceeded')) {
            userMessage = "⏳ *Service Temporarily Overloaded*\n\nThe database has reached its temporary limit. Please try again in 5-10 minutes. We apologize for the inconvenience.";
        } else {
            userMessage += "\nThe developers have been notified. Please try again later.";
        }

        if (chatId) {
            try {
                await this.bot.sendMessage(chatId, userMessage, { parse_mode: 'Markdown' });
            } catch (err) {
                logger.error(`Failed to send error message to user: ${err}`);
            }
        }

        // Notify Master Channel if configured
        if (env.TG_MASTER_CHANNEL) {
            const errorReport = `🚨 *Bot Error Report*\n` +
                `👤 *User:* @${username} (${userId})\n` +
                `💭 *Context:* ${isCallback ? 'Callback: ' + context.data : 'Message: ' + (context as TelegramBot.Message).text}\n` +
                `❌ *Error:* \`${error.message || error}\`\n` +
                `📍 *Time:* ${new Date().toISOString()}`;
            
            try {
                await this.bot.sendMessage(env.TG_MASTER_CHANNEL, errorReport, { parse_mode: 'Markdown' });
            } catch (err) {
                logger.error(`Failed to send report to master channel: ${err}`);
            }
        }
    }
}
