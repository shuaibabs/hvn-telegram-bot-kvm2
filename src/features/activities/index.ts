import { CommandRouter } from '../../core/router/commandRouter';
import { registerActivityCommands } from './commands';
import { registerActivityFlows } from './flows';

export function registerActivitiesFeature(router: CommandRouter) {
    registerActivityCommands(router);
    registerActivityFlows(router);
}
