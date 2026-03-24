import TelegramBot from 'node-telegram-bot-api';
import { getAllUsers } from '../userService';
import { User } from '../../../shared/types/data';
import { escapeMarkdown } from '../../../shared/utils/telegram';

export async function listUsers(bot: TelegramBot, chatId: number) {
    try {
        const users = await getAllUsers();

        if (users.length === 0) {
            await bot.sendMessage(chatId, "There are no users in the system.");
            return;
        }

        const userList = users.map((user: User) => {
            const name = escapeMarkdown(user.displayName);
            const role = escapeMarkdown(user.role);
            const username = escapeMarkdown(user.telegramUsername || 'N/A');
            return `*${name}* (${role}) - @${username}`;
        }).join('\n');

        const message = `*All Users: *\n\n${userList}`;

        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    } catch (error: any) {
        await bot.sendMessage(chatId, `Error fetching users: ${error.message}`);
    }
}
