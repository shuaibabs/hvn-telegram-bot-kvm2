import { initializeBot } from './core/bot/bot';
import { startServer } from './core/server/server';
import { logger } from './core/logger/logger';

// Global error handlers to prevent process exit on unhandled rejections
process.on('unhandledRejection', (reason: any, promise) => {
    logger.error(`[FATAL] Unhandled Rejection at: ${promise}, reason: ${reason?.stack || reason}`);
});

process.on('uncaughtException', (error) => {
    logger.error(`[FATAL] Uncaught Exception: ${error.stack || error}`);
    // Optional: Allow some time for logging before exiting if it's truly critical
    // but for Telegram bot, we usually want to try and stay alive.
});

async function main() {
    try {
        logger.info("Starting the Telegram bot...");
        const bot = initializeBot();
        logger.info("Bot is now running.");

        // Start the notification server
        logger.info("Starting the Telegram Server...");
        await startServer(bot);
        logger.info("Server is now running.");

    } catch (error: any) {
        logger.error("Failed to start the bot or server: " + error.message);
    }
}

main();
