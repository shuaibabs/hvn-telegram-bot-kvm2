import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { getGlobalNumberHistory } from '../historyService';
import { CommandRouter } from '../../../core/router/commandRouter';
import { getUserProfile, isAdmin } from '../../../core/auth/permissions';
import { formatToDDMMYYYY } from '../../../shared/utils/dateUtils';

export async function startDetailHistoryFlow(bot: TelegramBot, chatId: number, username?: string) {
    setSession(chatId, 'historyDetail', { stage: 'AWAIT_MOBILE' });
    await bot.sendMessage(chatId, "ℹ️ *Global History Details*\n\nPlease enter the mobile number to show its full history:", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'history_detail_cancel' }]]
        }
    });
}

export function registerDetailHistoryFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'historyDetail');
        if (!session || !msg.text || msg.text.startsWith('/')) return;

        const chatId = msg.chat.id;
        const mobile = msg.text.trim();

        if (!/^\d{10}$/.test(mobile)) {
            await bot.sendMessage(chatId, "❌ Invalid mobile number. Please enter a 10-digit number.");
            return;
        }

        try {
            const isUserAdmin = await isAdmin(msg.from?.username);
            const profile = await getUserProfile(msg.from?.username);

            if (!isUserAdmin && !profile?.displayName) {
                await bot.sendMessage(chatId, "❌ *Profile Incomplete*\n\nYour profile does not have a display name set in the system. Please contact an administrator.", { parse_mode: 'Markdown' });
                clearSession(chatId, 'historyDetail');
                return;
            }

            const employeeName = isUserAdmin ? undefined : profile?.displayName;

            const result = await getGlobalNumberHistory(mobile, employeeName);

            if (!result.found) {
                await bot.sendMessage(chatId, `❌ No history record found for \`${mobile}\`${employeeName ? ` assigned to you` : ""}.`, { parse_mode: 'Markdown' });
            } else {
                const history = result.data.history || result.data.originalNumberData?.history || [];
                
                let text = `📜 *Global History: ${mobile}*\n`;
                text += `━━━━━━━━━━━━━━━━━━━━\n`;
                text += `📍 *Current Status:* ${result.location}\n`;
                text += `👤 *Assigned To:* ${result.data.assignedTo || result.data.originalNumberData?.assignedTo || 'Unassigned'}\n\n`;
                
                if (history.length === 0) {
                    text += "_No history events recorded._";
                } else {
                    history.forEach((event: any, i: number) => {
                        text += `*${i + 1}. ${event.action}*\n`;
                        text += `📅 ${formatToDDMMYYYY(event.timestamp)}\n`;
                        text += `👤 By: ${event.performedBy}\n`;
                        text += `📝 ${event.description}\n\n`;
                    });
                }
                text += `━━━━━━━━━━━━━━━━━━━━`;

                await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
            }
            clearSession(chatId, 'historyDetail');
        } catch (error: any) {
            logger.error(`Error in detailHistoryFlow: ${error.message}`);
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    });

    router.registerCallback('history_detail_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'historyDetail');
        await bot.sendMessage(query.message!.chat.id, "Operation cancelled.");
    });
}
