import { CommandRouter } from '../../../core/router/commandRouter';
import { registerCreateUserFlow } from './createUserFlow';
import { registerDeleteUserFlow } from './deleteUserFlow';
import { registerEditUserFlow } from './editUserFlow';

export function registerUserFlows(router: CommandRouter) {
    registerCreateUserFlow(router);
    registerDeleteUserFlow(router);
    registerEditUserFlow(router);
}
