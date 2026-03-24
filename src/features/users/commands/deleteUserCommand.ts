import TelegramBot from 'node-telegram-bot-api';
import { startDeleteUserFlow } from '../flows/deleteUserFlow';

export function deleteUserCommand(bot: TelegramBot, msg: TelegramBot.Message) {
    startDeleteUserFlow(bot, msg.chat.id);
}
