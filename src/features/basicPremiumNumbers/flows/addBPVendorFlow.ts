import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { addBPVendor } from '../basicPremiumService';
import { getUserProfile } from '../../../core/auth/permissions';
import { CommandRouter } from '../../../core/router/commandRouter';
import { logActivity } from '../../activities/activityService';

export async function startAddBPVendorFlow(bot: TelegramBot, chatId: number, username?: string) {
    setSession(chatId, 'addBPVendor', { stage: 'AWAIT_NAME' });
    await bot.sendMessage(chatId, "🤝 *Add Basic/Premium Vendor*\n\nPlease enter the name of the new vendor:", {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'bp_vendor_add_cancel' }]] }
    });
}

export function registerAddBPVendorFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'addBPVendor');
        if (!session || !msg.text || msg.text.startsWith('/')) return;

        const chatId = msg.chat.id;
        const name = msg.text.trim();

        if (session.stage === 'AWAIT_NAME') {
            try {
                const profile = await getUserProfile(msg.from?.username);
                if (!profile?.uid) throw new Error("User profile not found.");

                await addBPVendor({ name }, profile.uid);
                await bot.sendMessage(chatId, `✅ Vendor *${name}* added successfully!`, { parse_mode: 'Markdown' });

                await logActivity(bot, {
                    employeeName: profile.displayName || msg.from?.username || 'Unknown',
                    action: 'ADD_BP_VENDOR',
                    description: `Added new Basic/Premium vendor: ${name}`,
                    createdBy: profile.displayName || msg.from?.username || 'Unknown',
                    source: 'BOT',
                    groupName: 'BASIC_PREMIUM_NUMBERS'
                }, true);
            } catch (error: any) {
                await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
            clearSession(chatId, 'addBPVendor');
        }
    });

    router.registerCallback('bp_vendor_add_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'addBPVendor');
        await bot.sendMessage(query.message!.chat.id, "Cancelled.");
    });
}
