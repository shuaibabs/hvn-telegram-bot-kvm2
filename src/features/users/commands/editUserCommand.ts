import TelegramBot from 'node-telegram-bot-api';
import { startEditUserFlow } from '../flows/editUserFlow';

export function editUserCommand(bot: TelegramBot, msg: TelegramBot.Message) {
    startEditUserFlow(bot, msg.chat.id);
}
