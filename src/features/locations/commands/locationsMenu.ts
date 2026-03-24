import TelegramBot from 'node-telegram-bot-api';
import { CommandRouter } from '../../../core/router/commandRouter';
import { Guard } from '../../../core/auth/guard';
import { env } from '../../../config/env';
import { startListLocationsFlow } from '../flows/listLocationsFlow';
import { startEditLocationFlow } from '../flows/editLocationFlow';
import { startDetailsLocationFlow } from '../flows/detailsLocationFlow';

export async function locationsMenuCommand(bot: TelegramBot, chatId: number, username?: string) {
    const opts: TelegramBot.SendMessageOptions = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '📍 List SIM Locations', callback_data: 'locations_list' }],
                [{ text: '✏️ CheckIn / Edit Location', callback_data: 'locations_edit' }],
                [{ text: '🔍 View Details', callback_data: 'locations_details' }]
            ]
        }
    };

    await bot.sendMessage(chatId, "📍 *SIM Location Tracking*\n\nTrack and manage the current location of all SIMs.", opts);
}

export function registerLocationsFeature(router: CommandRouter) {
    const bot = router.bot;

    // Command: /start or start in this group
    router.register(/^(?:\/start|start)$/i, async (msg) => {
        await locationsMenuCommand(bot, msg.chat.id, msg.from?.username);
    }, [env.TG_GROUP_SIM_LOCATIONS || '']);

    // Callbacks
    router.registerCallback('sim_locations_start', async (query) => {
        await locationsMenuCommand(bot, query.message!.chat.id, query.from.username);
    }, [env.TG_GROUP_SIM_LOCATIONS || '']);

    router.registerCallback('locations_list', Guard.registeredOnlyCallback(bot, async (query) => {
        await startListLocationsFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_SIM_LOCATIONS || '']);

    router.registerCallback('locations_edit', Guard.registeredOnlyCallback(bot, async (query) => {
        await startEditLocationFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_SIM_LOCATIONS || '']);

    router.registerCallback('locations_details', Guard.registeredOnlyCallback(bot, async (query) => {
        await startDetailsLocationFlow(bot, query.message!.chat.id, query.from.username);
    }), [env.TG_GROUP_SIM_LOCATIONS || '']);
}
