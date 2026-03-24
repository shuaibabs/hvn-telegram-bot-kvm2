import { CommandRouter } from '../../core/router/commandRouter';
import { registerSalesMenu } from './commands/salesMenu';
import { registerListSalesFlow } from './flows/listSalesFlow';
import { registerSearchSalesFlow } from './flows/searchSalesFlow';
import { registerDetailSalesFlow } from './flows/detailSalesFlow';
import { registerVendorSalesFlow } from './flows/vendorSalesFlow';
import { registerCancelSaleFlow } from './flows/cancelSaleFlow';
import { registerAddPaymentFlow } from './flows/addPaymentFlow';

export function registerSalesFeature(router: CommandRouter) {
    registerSalesMenu(router);
    registerListSalesFlow(router);
    registerSearchSalesFlow(router);
    registerDetailSalesFlow(router);
    registerVendorSalesFlow(router);
    registerCancelSaleFlow(router);
    registerAddPaymentFlow(router);
}
