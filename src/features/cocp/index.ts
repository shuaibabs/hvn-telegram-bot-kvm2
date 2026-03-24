import { CommandRouter } from '../../core/router/commandRouter';
import { registerCOCPMenu } from './commands/cocpMenu';
import { registerListCOCPFlow } from './flows/listCOCPFlow';
import { registerSearchCOCPFlow } from './flows/searchCOCPFlow';
import { registerDetailCOCPFlow } from './flows/detailCOCPFlow';
import { registerEditCOCPFlow } from './flows/editCOCPFlow';

export function registerCOCPFeature(router: CommandRouter) {
    registerCOCPMenu(router);
    registerListCOCPFlow(router);
    registerSearchCOCPFlow(router);
    registerDetailCOCPFlow(router);
    registerEditCOCPFlow(router);
}
