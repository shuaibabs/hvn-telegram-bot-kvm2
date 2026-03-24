import TelegramBot from 'node-telegram-bot-api';
import { GROUPS } from '../../../config/env';
import { adminOnly } from '../../../shared/middleware/auth';
import { validateGroup } from '../../../shared/services/validation';
import { startDeleteUserFlow } from '../flows/deleteUserFlow';

export function deleteUserCommand(bot: TelegramBot) {
    bot.onText(/\/deleteuser/, adminOnly(bot, async (msg) => {
        if (!validateGroup(bot, msg, GROUPS.USERS, 'User Management')) return;
        await startDeleteUserFlow(bot, msg.chat.id);
    }));
}
