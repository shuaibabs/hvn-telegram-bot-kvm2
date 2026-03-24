import { CommandRouter } from '../../core/router/commandRouter';
import { registerHistoryMenu } from './commands/historyMenu';
import { registerDetailHistoryFlow } from './flows/detailHistoryFlow';

export function registerHistoryFeature(router: CommandRouter) {
    registerHistoryMenu(router);
    registerDetailHistoryFlow(router);
}
