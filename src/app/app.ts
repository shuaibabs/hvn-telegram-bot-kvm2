import TelegramBot from 'node-telegram-bot-api';
import { startServer } from '../core/server/server';
import { env } from '../config/env';
import '../features/misc/new-feature';
import { logger } from '../core/logger/logger';

const bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN, { polling: true });

logger.info('🤖 Telegram bot initialized and listening...');

// Start the Express server for UI notifications if configured
if (env.ENABLE_SERVER) {
    startServer(bot);
}
