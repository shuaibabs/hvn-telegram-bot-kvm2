import { CommandRouter } from '../../core/router/commandRouter';
import { registerDealerFeature as registerMain } from './commands/dealerMenu';
import { registerAddDealerFlow } from './flows/addDealerFlow';
import { registerDeleteDealerFlow } from './flows/deleteDealerFlow';
import { registerDetailsDealerFlow } from './flows/detailsDealerFlow';
import { registerAddDealerPaymentFlow } from './flows/addDealerPaymentFlow';
import { registerDealerStatsFlow } from './flows/dealerStatsFlow';
import { registerSearchDealerPurchasesFlow } from './flows/searchDealerPurchasesFlow';
import { registerListDealerPurchasesFlow } from './flows/listDealerPurchasesFlow';

export function registerDealerFeature(router: CommandRouter) {
    registerMain(router);
    registerAddDealerFlow(router);
    registerDeleteDealerFlow(router);
    registerDetailsDealerFlow(router);
    registerAddDealerPaymentFlow(router);
    registerDealerStatsFlow(router);
    registerSearchDealerPurchasesFlow(router);
    registerListDealerPurchasesFlow(router);
}
