import TelegramBot from 'node-telegram-bot-api';

export function manageUsersCommand(bot: TelegramBot, msg: TelegramBot.Message) {
    const chatId = msg.chat.id;

    const text = "*User Management*\n\nWhat would you like to do?";

    const options: TelegramBot.SendMessageOptions = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "List Users", callback_data: "manage_users_list" }],
                [{ text: "Add User", callback_data: "manage_users_add" }],
                [{ text: "Edit User", callback_data: "manage_users_edit" }],
                [{ text: "Delete User", callback_data: "manage_users_delete" }],
            ],
        },
    };

    bot.sendMessage(chatId, text, options);
}
