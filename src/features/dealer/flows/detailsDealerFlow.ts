import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { getDealerPurchaseByMobile } from '../dealerService';
import { isAdmin, getUserProfile } from '../../../core/auth/permissions';
import { CommandRouter } from '../../../core/router/commandRouter';
import { logger } from '../../../core/logger/logger';

export async function startDetailsDealerFlow(bot: TelegramBot, chatId: number, username?: string) {
    const profile = await getUserProfile(username);
    if (!profile) {
        await bot.sendMessage(chatId, "❌ *Access Denied*\n\nUser profile not found.", { parse_mode: 'Markdown' });
        return;
    }

    setSession(chatId, 'detailsDealer', { stage: 'AWAIT_MOBILE' });

    await bot.sendMessage(chatId, "🔍 *Dealer Purchase Details*\n\nPlease enter the 10-digit mobile number:", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'dealer_details_cancel' }]]
        }
    });
}

export function registerDetailsDealerFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'detailsDealer');
        if (!session || !msg.text || msg.text.startsWith('/')) return;

        const chatId = msg.chat.id;
        const text = msg.text.trim();

        if (session.stage === 'AWAIT_MOBILE') {
            if (!/^\d{10}$/.test(text)) {
                await bot.sendMessage(chatId, "❌ Invalid mobile number. Please enter 10 digits.");
                return;
            }

            try {
                const profile = await getUserProfile(msg.from?.username);
                const isUserAdmin = await isAdmin(msg.from?.username);
                const employeeUid = isUserAdmin ? undefined : profile?.uid;

                const result = await getDealerPurchaseByMobile(text, employeeUid);
                if (result) {
                    let textMsg = `📋 *Dealer Purchase Details:*\n`;
                    textMsg += `━━━━━━━━━━━━━━━━━━━━\n`;
                    textMsg += `📱 *Mobile:* \`${result.mobile}\`\n`;
                    textMsg += `🤝 *Dealer:* ${result.dealerName}\n`;
                    textMsg += `💰 *Price:* ₹${result.price}\n`;
                    textMsg += `🔢 *Digital Root:* ${result.sum}\n`;
                    if (result.srNo) textMsg += `🆔 *Sr No:* ${result.srNo}\n`;
                    textMsg += `━━━━━━━━━━━━━━━━━━━━`;

                    await bot.sendMessage(chatId, textMsg, { parse_mode: 'Markdown' });
                } else {
                    const errorMsg = isUserAdmin 
                        ? `❌ Number \`${text}\` not found in dealer purchases.`
                        : `❌ Number \`${text}\` not found in your dealer purchases.`;
                    await bot.sendMessage(chatId, errorMsg, { parse_mode: 'Markdown' });
                }
            } catch (error: any) {
                logger.error(`Error in detailsDealerFlow: ${error.message}`);
                await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
            clearSession(chatId, 'detailsDealer');
        }
    });

    router.registerCallback('dealer_details_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'detailsDealer');
        await bot.sendMessage(query.message!.chat.id, "Operation cancelled.");
    });
}
