import { CommandRouter } from '../../core/router/commandRouter';
import { registerInventoryMenu } from './commands/inventoryMenu';
import { registerAddNumberFlow } from './flows/addNumberFlow';
import { registerUpdateStatusFlow } from './flows/updateStatusFlow';
import { registerAssignToUserFlow } from './flows/assignToUserFlow';
import { registerDeleteNumbersFlow } from './flows/deleteNumbersFlow';
import { registerMarkAsSoldFlow } from './flows/markAsSoldFlow';
import { registerPrebookFlow } from './flows/prebookFlow';
import { registerSearchFlow } from './flows/searchFlow';
import { registerDetailNumberFlow } from './flows/detailNumberFlow';
import { registerQuickAddNumberFlow } from './flows/quickAddNumberFlow';

export function registerInventoryFeature(router: CommandRouter) {
    registerInventoryMenu(router);
    registerAddNumberFlow(router);
    registerUpdateStatusFlow(router);
    registerAssignToUserFlow(router);
    registerDeleteNumbersFlow(router);
    registerMarkAsSoldFlow(router);
    registerPrebookFlow(router);
    registerSearchFlow(router);
    registerDetailNumberFlow(router);
    registerQuickAddNumberFlow(router);
}
