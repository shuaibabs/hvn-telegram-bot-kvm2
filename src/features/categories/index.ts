import { CommandRouter } from '../../core/router/commandRouter';
import { registerCategoriesMenu } from './commands/categoriesMenu';

export function registerCategoriesFeature(router: CommandRouter) {
    registerCategoriesMenu(router);
}
