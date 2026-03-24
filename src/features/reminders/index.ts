import { CommandRouter } from '../../core/router/commandRouter';
import { registerRemindersFeature } from './commands/remindersMenu';
import { registerAddReminderFlow } from './flows/addReminderFlow';
import { registerListRemindersFlow } from './flows/listRemindersFlow';

export function initRemindersFeature(router: CommandRouter) {
    registerRemindersFeature(router);
    registerAddReminderFlow(router);
    registerListRemindersFlow(router);
}
