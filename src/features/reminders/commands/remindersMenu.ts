import TelegramBot from 'node-telegram-bot-api';
import { Guard } from '../../../core/auth/guard';
import { CommandRouter } from '../../../core/router/commandRouter';
import { env } from '../../../config/env';
import { startAddReminderFlow } from '../flows/addReminderFlow';
import { startListRemindersFlow } from '../flows/listRemindersFlow';

export async function remindersMenuCommand(bot: TelegramBot, chatId: number, username?: string) {
    const opts: TelegramBot.SendMessageOptions = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '➕ Add Reminder', callback_data: 'reminders_add' }],
                [{ text: '📜 List My Reminders', callback_data: 'reminders_list' }],
            ]
        }
    };

    await bot.sendMessage(chatId, "📅 *Work Reminders Menu*\n\nManage your tasks and reminders here.", opts);
}

export function registerRemindersFeature(router: CommandRouter) {
    const bot = router.bot;

    // Handle /reminders, /start, START (case insensitive)
    router.register(/\/(reminders|start)/i, Guard.registeredOnlyCommand(bot, async (msg) => {
        await remindersMenuCommand(bot, msg.chat.id, msg.from?.username);
    }), [env.TG_GROUP_WORK_REMINDERS || '']);

    router.register(/^START$/i, Guard.registeredOnlyCommand(bot, async (msg) => {
        await remindersMenuCommand(bot, msg.chat.id, msg.from?.username);
    }), [env.TG_GROUP_WORK_REMINDERS || '']);

    router.registerCallback('reminders_add', Guard.registeredOnlyCallback(bot, async (query) => {
        await startAddReminderFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_WORK_REMINDERS || '']);

    router.registerCallback('reminders_list', Guard.registeredOnlyCallback(bot, async (query) => {
        await startListRemindersFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_WORK_REMINDERS || '']);
}
