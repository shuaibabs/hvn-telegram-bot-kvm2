import { CommandRouter } from '../../core/router/commandRouter';
import { registerPartnersMenu } from './commands/partnersMenu';
import { registerListPartnersFlow } from './flows/listPartnersFlow';
import { registerSearchPartnersFlow } from './flows/searchPartnersFlow';
import { registerDetailPartnersFlow } from './flows/detailPartnersFlow';

export function registerPartnersFeature(router: CommandRouter) {
    registerPartnersMenu(router);
    registerListPartnersFlow(router);
    registerSearchPartnersFlow(router);
    registerDetailPartnersFlow(router);
}
