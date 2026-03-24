import { CommandRouter } from '../../core/router/commandRouter';
import { registerUserCommands } from './commands';
import { registerUserFlows } from './flows';

export function registerUsersFeature(router: CommandRouter) {
    registerUserCommands(router);
    registerUserFlows(router);
}
