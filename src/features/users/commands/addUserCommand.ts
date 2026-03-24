import TelegramBot from 'node-telegram-bot-api';
import { startCreateUserFlow } from '../flows/createUserFlow';

export function addUserCommand(bot: TelegramBot, msg: TelegramBot.Message) {
    startCreateUserFlow(bot, msg.chat.id);
}
