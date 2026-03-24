import TelegramBot from 'node-telegram-bot-api';

type CallbackQueryHandler = (bot: TelegramBot, callbackQuery: TelegramBot.CallbackQuery) => void;

export class CallbackQueryRouter {
    private routes: Map<RegExp, CallbackQueryHandler> = new Map();

    public register(pattern: RegExp, handler: CallbackQueryHandler) {
        this.routes.set(pattern, handler);
    }

    public handle(bot: TelegramBot, callbackQuery: TelegramBot.CallbackQuery) {
        const data = callbackQuery.data;
        if (data) {
            for (const [pattern, handler] of this.routes.entries()) {
                if (pattern.test(data)) {
                    handler(bot, callbackQuery);
                    return;
                }
            }
        }
    }
}
