import { CommandRouter } from '../../core/router/commandRouter';
import { registerBPFeature as registerMain } from './commands/bpMenu';
import { registerAddBPVendorFlow } from './flows/addBPVendorFlow';
import { registerAddBPNumberFlow } from './flows/addBPNumberFlow';
import { registerAddBPPaymentFlow } from './flows/addBPPaymentFlow';
import { registerBPStatsFlow } from './flows/bpStatsFlow';
import { registerListBPInventoryFlow } from './flows/listBPInventoryFlow';
import { registerManageBPNumberFlow } from './flows/manageBPNumberFlow';

export function registerBasicPremiumFeature(router: CommandRouter) {
    registerMain(router);
    registerAddBPVendorFlow(router);
    registerAddBPNumberFlow(router);
    registerAddBPPaymentFlow(router);
    registerBPStatsFlow(router);
    registerListBPInventoryFlow(router);
    registerManageBPNumberFlow(router);
}
