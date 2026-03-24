import { CommandRouter } from '../../../core/router/commandRouter';
import { env } from '../../../config/env';
import { addUserCommand } from './addUserCommand';
import { deleteUserCommand } from './deleteUserCommand';
import { editUserCommand } from './editUserCommand';
import { listUsersCommand } from './listUsersCommand';
import { manageUsersCommand } from './manageUsersCommand';
import { Guard } from '../../../core/auth/guard';

const hvnManageUsersGroupId = env.TG_GROUP_USERS;

export function registerUserCommands(router: CommandRouter) {
    const bot = router.bot;
    const allowedGroups = hvnManageUsersGroupId ? [hvnManageUsersGroupId] : [];

    // Group-specific Start/Menu command
    router.register(/\/start/, Guard.adminOnlyCommand(bot, (msg) => manageUsersCommand(bot, msg)), allowedGroups);

    router.register(/\/addUser/, Guard.adminOnlyCommand(bot, (msg) => addUserCommand(bot, msg)), allowedGroups);
    router.register(/\/deleteUser/, Guard.adminOnlyCommand(bot, (msg) => deleteUserCommand(bot, msg)), allowedGroups);
    router.register(/\/editUser/, Guard.adminOnlyCommand(bot, (msg) => editUserCommand(bot, msg)), allowedGroups);
    router.register(/\/listUsers/, Guard.adminOnlyCommand(bot, (msg) => listUsersCommand(bot, msg)), allowedGroups);
    router.register(/\/manageUsers/, Guard.adminOnlyCommand(bot, (msg) => manageUsersCommand(bot, msg)), allowedGroups);

    // Global Cancel Command
    router.register(/\/cancel/, (msg) => {
        // Handled individually by flow listeners
    });

    // Register Callbacks for Inline Menu
    router.registerCallback('manage_users_start', Guard.adminOnlyCallback(bot, (query) => manageUsersCommand(bot, query.message!)), allowedGroups);
    router.registerCallback('manage_users_list', Guard.adminOnlyCallback(bot, (query) => listUsersCommand(bot, query.message!)), allowedGroups);
    router.registerCallback('manage_users_add', Guard.adminOnlyCallback(bot, (query) => addUserCommand(bot, query.message!)), allowedGroups);
    router.registerCallback('manage_users_edit', Guard.adminOnlyCallback(bot, (query) => editUserCommand(bot, query.message!)), allowedGroups);
    router.registerCallback('manage_users_delete', Guard.adminOnlyCallback(bot, (query) => deleteUserCommand(bot, query.message!)), allowedGroups);
}
