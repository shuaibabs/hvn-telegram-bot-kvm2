import { CommandRouter } from '../../../core/router/commandRouter';
import { env } from '../../../config/env';
import { manageActivitiesCommand } from './manageActivitiesCommand';
import { Guard } from '../../../core/auth/guard';

export function registerActivityCommands(router: CommandRouter) {
    const bot = router.bot;
    const activityGroupId = env.TG_GROUP_ACTIVITY;
    const adminGroupId = env.TG_GROUP_USERS;

    const allowedGroups = [];
    if (activityGroupId) allowedGroups.push(activityGroupId);
    if (adminGroupId) allowedGroups.push(adminGroupId);

    // Activity Command (Registered only can view activities)
    router.register(/\/activities/, Guard.registeredOnlyCommand(bot, (msg) => manageActivitiesCommand(bot, msg)), allowedGroups);

    const activityGroupsOnly = activityGroupId ? [activityGroupId] : [];
    router.register(/^(?:\/start|start)$/i, Guard.registeredOnlyCommand(bot, (msg) => manageActivitiesCommand(bot, msg)), activityGroupsOnly);

    // Register Callbacks
    router.registerCallback('manage_activities_start', Guard.registeredOnlyCallback(bot, (query) => manageActivitiesCommand(bot, query.message!, query.from)), allowedGroups);

    // BUG-2 Fix Refined: Restrict deletion callbacks to Admin
    router.registerCallback('delete_act_start', Guard.adminOnlyCallback(bot, async (query) => {
        const { startDeleteActivityFlow } = await import('../flows/deleteActivityFlow');
        await startDeleteActivityFlow(bot, query.message!.chat.id);
    }), allowedGroups);

    router.registerCallback('clear_activities_start', Guard.adminOnlyCallback(bot, async (query) => {
        await bot.sendMessage(query.message!.chat.id, "⚠️ Are you sure you want to clear ALL activity logs? This cannot be undone.", {
            reply_markup: {
                inline_keyboard: [[
                    { text: "✅ Yes, Clear All", callback_data: "clear_activities_confirm_yes" },
                    { text: "❌ No, Cancel", callback_data: "manage_activities_start" }
                ]]
            }
        });
    }), allowedGroups);
}
