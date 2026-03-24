import { CommandRouter } from '../../core/router/commandRouter';
import { registerPrebookMenu } from './commands/prebookMenu';
import { registerListPrebookFlow } from './flows/listPrebookFlow';
import { registerSearchPrebookFlow } from './flows/searchPrebookFlow';
import { registerDetailPrebookFlow } from './flows/detailPrebookFlow';
import { registerCancelPrebookFlow } from './flows/cancelPrebookFlow';

export function registerPrebookingFeature(router: CommandRouter) {
    registerPrebookMenu(router);
    registerListPrebookFlow(router);
    registerSearchPrebookFlow(router);
    registerDetailPrebookFlow(router);
    registerCancelPrebookFlow(router);
}
