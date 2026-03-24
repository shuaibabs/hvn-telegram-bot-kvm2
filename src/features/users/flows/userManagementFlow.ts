import TelegramBot from 'node-telegram-bot-api';
import { startCreateUserFlow } from './createUserFlow';
import { startDeleteUserFlow } from './deleteUserFlow';
import { startEditUserFlow } from './editUserFlow';
import { listUsers } from './viewUsersFlow';

export async function handleUserManagementResponse(bot: TelegramBot, callbackQuery: TelegramBot.CallbackQuery) {
    const { data, message } = callbackQuery;
    if (!data || !message) return;

    const chatId = message.chat.id;

    // Remove the previous message to keep the chat clean
    await bot.deleteMessage(chatId, message.message_id);

    switch (data) {
        case 'create_user':
            await startCreateUserFlow(bot, chatId);
            break;
        case 'edit_user':
            await startEditUserFlow(bot, chatId);
            break;
        case 'delete_user':
            await startDeleteUserFlow(bot, chatId);
            break;
        case 'view_users':
            await listUsers(bot, chatId);
            break;
    }
}
