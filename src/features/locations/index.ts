import { CommandRouter } from '../../core/router/commandRouter';
import { registerLocationsFeature as registerMain } from './commands/locationsMenu';
import { registerListLocationsFlow } from './flows/listLocationsFlow';
import { registerEditLocationFlow } from './flows/editLocationFlow';
import { registerDetailsLocationFlow } from './flows/detailsLocationFlow';

export function registerLocationsFeature(router: CommandRouter) {
    registerMain(router);
    registerListLocationsFlow(router);
    registerEditLocationFlow(router);
    registerDetailsLocationFlow(router);
}
