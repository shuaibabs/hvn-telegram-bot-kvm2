
import TelegramBot from 'node-telegram-bot-api';
import { env } from '../../config/env';
import { logger } from '../logger/logger';
import { CommandRouter } from '../router/commandRouter';
import { registerGeneralCommands } from '../../commands/general';
import { registerUsersFeature } from '../../features/users';
import { registerActivitiesFeature } from '../../features/activities';
import { registerInventoryFeature } from '../../features/inventory';
import { registerSalesFeature } from '../../features/sales';
import { registerPrebookingFeature } from '../../features/prebooking';
import { registerPartnersFeature } from '../../features/partners';
import { registerPostpaidFeature } from '../../features/postpaid';
import { registerCOCPFeature } from '../../features/cocp';
import { registerHistoryFeature } from '../../features/history';
import { registerLocationsFeature } from '../../features/locations';
import { registerDealerFeature } from '../../features/dealer';
import { registerDeletedFeature } from '../../features/deleted';
import { initRemindersFeature } from '../../features/reminders';

let bot: TelegramBot | null = null;
let commandRouter: CommandRouter | null = null;

export function initializeBot(): TelegramBot {
    if (env.TELEGRAM_BOT_TOKEN) {
        bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN, { polling: true });
        logger.info("Bot has been initialized.");

        commandRouter = new CommandRouter(bot);

        // Register Features
        registerGeneralCommands(commandRouter);
        registerUsersFeature(commandRouter);
        registerActivitiesFeature(commandRouter);
        registerInventoryFeature(commandRouter);
        registerSalesFeature(commandRouter);
        registerPrebookingFeature(commandRouter);
        registerPartnersFeature(commandRouter);
        registerPostpaidFeature(commandRouter);
        registerCOCPFeature(commandRouter);
        registerHistoryFeature(commandRouter);
        registerLocationsFeature(commandRouter);
        registerDealerFeature(commandRouter);
        registerDeletedFeature(commandRouter);
        initRemindersFeature(commandRouter);

        // Start listening for commands
        commandRouter.listen();

        // Generic error handling
        bot.on('polling_error', (error) => {
            logger.error(`Polling error: ${error.message}`);
        });

        return bot;

    } else {
        logger.error("Telegram bot token is not defined.");
        throw new Error("Telegram bot token is not defined.");
    }
}

export function getBot() {
    if (!bot) {
        throw new Error("Bot is not initialized.");
    }
    return bot;
}
