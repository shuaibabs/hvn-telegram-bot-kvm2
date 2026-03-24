import { CommandRouter } from '../../../core/router/commandRouter';
import { handleViewActivities } from './viewActivitiesFlow';
import { handleClearActivities } from './clearActivitiesFlow';
import { startDeleteActivityFlow, registerDeleteActivityFlow } from './deleteActivityFlow';
import { Guard } from '../../../core/auth/guard';

export function registerActivityFlows(router: CommandRouter) {
    const bot = router.bot;

    // View Activities (Registered Only)
    router.registerCallback(/^view_recent_/, Guard.registeredOnlyCallback(bot, (query) => handleViewActivities(bot, query)));
    router.registerCallback('view_all_activities', Guard.registeredOnlyCallback(bot, (query) => handleViewActivities(bot, query)));

    // Clear Activities (Admin Only)
    router.registerCallback(/^clear_activities_/, Guard.adminOnlyCallback(bot, (query) => handleClearActivities(bot, query)));

    // Delete Single Activity Start (Admin Only)
    router.registerCallback('delete_act_start', Guard.adminOnlyCallback(bot, (query) => {
        bot.answerCallbackQuery(query.id);
        startDeleteActivityFlow(bot, query.message!.chat.id);
    }));

    // Register Multi-step Delete Flow
    registerDeleteActivityFlow(router);
}
