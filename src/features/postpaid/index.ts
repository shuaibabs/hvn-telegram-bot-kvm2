import { CommandRouter } from '../../core/router/commandRouter';
import { registerPostpaidMenu } from './commands/postpaidMenu';
import { registerListPostpaidFlow } from './flows/listPostpaidFlow';
import { registerSearchPostpaidFlow } from './flows/searchPostpaidFlow';
import { registerDetailPostpaidFlow } from './flows/detailPostpaidFlow';
import { registerEditPostpaidFlow } from './flows/editPostpaidFlow';

export function registerPostpaidFeature(router: CommandRouter) {
    registerPostpaidMenu(router);
    registerListPostpaidFlow(router);
    registerSearchPostpaidFlow(router);
    registerDetailPostpaidFlow(router);
    registerEditPostpaidFlow(router);
}
