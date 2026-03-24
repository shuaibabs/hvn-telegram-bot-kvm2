import TelegramBot from 'node-telegram-bot-api';
import { CommandRouter } from '../core/router/commandRouter';
import { registerUserCommands } from '../features/users/commands/index';
import { registerGeneralCommands } from './general';

export function registerCommandHandlers(bot: TelegramBot) {
    const router = new CommandRouter(bot);

    registerUserCommands(router);
    registerGeneralCommands(router);

    router.listen();
}
