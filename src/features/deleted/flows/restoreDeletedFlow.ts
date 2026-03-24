import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { getDeletedNumbers, restoreNumber } from '../deletedService';
import { isAdmin, getUserProfile } from '../../../core/auth/permissions';
import { CommandRouter } from '../../../core/router/commandRouter';
import { logger } from '../../../core/logger/logger';
import { logActivity } from '../../activities/activityService';

export async function startRestoreDeletedFlow(bot: TelegramBot, chatId: number, username?: string) {
    const isUserAdmin = await isAdmin(username);
    if (!isUserAdmin) {
        await bot.sendMessage(chatId, "⛔ *Access Denied*\n\nOnly administrators can restore deleted numbers.", { parse_mode: 'Markdown' });
        return;
    }

    setSession(chatId, 'restoreNumber', { stage: 'AWAIT_MOBILE' });

    await bot.sendMessage(chatId, "♻️ *Restore Number*\n\nPlease enter the 10-digit mobile number to restore:", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'restore_cancel' }]]
        }
    });
}

export function registerRestoreDeletedFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'restoreNumber');
        if (!session || !msg.text || msg.text.startsWith('/')) return;

        const chatId = msg.chat.id;
        const text = msg.text.trim();

        if (session.stage === 'AWAIT_MOBILE') {
            if (!/^\d{10}$/.test(text)) {
                await bot.sendMessage(chatId, "❌ Invalid mobile number. Please enter 10 digits.");
                return;
            }

            try {
                const deletedList = await getDeletedNumbers();
                const record = deletedList.find((d: any) => d.mobile === text);

                if (!record) {
                    await bot.sendMessage(chatId, `❌ Number \`${text}\` not found in deleted records.`, { parse_mode: 'Markdown' });
                    clearSession(chatId, 'restoreNumber');
                    return;
                }

                session.recordId = record.id;
                session.mobile = text;
                session.stage = 'CONFIRMATION';
                setSession(chatId, 'restoreNumber', session);

                let confirmText = `♻️ *Confirm Restoration*\n\n`;
                confirmText += `📱 Number: \`${text}\`\n`;
                confirmText += `🗑️ Deleted By: ${record.deletedBy}\n`;
                confirmText += `💬 Reason: ${record.deletionReason}\n\n`;
                confirmText += `Are you sure you want to restore this number to the master inventory?`;

                await bot.sendMessage(chatId, confirmText, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '✅ Restore Now', callback_data: 'restore_confirm' }],
                            [{ text: '❌ Cancel', callback_data: 'restore_cancel' }]
                        ]
                    }
                });
            } catch (error: any) {
                await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
                clearSession(chatId, 'restoreNumber');
            }
        }
    });

    router.registerCallback('restore_confirm', async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'restoreNumber');
        if (!session) return;

        try {
            const profile = await getUserProfile(query.from.username);
            const performer = profile?.displayName || query.from.username || 'Admin';

            const result = await restoreNumber(session.recordId, performer);
            if (result) {
                await bot.sendMessage(chatId, `✅ *Success!*\n\nNumber \`${session.mobile}\` has been restored to inventory.`, { parse_mode: 'Markdown' });
                
                // Log Activity
                await logActivity(bot, {
                    employeeName: performer,
                    action: 'RESTORE_NUMBER',
                    description: `Restored number ${session.mobile} to inventory.`,
                    createdBy: performer,
                    source: 'BOT',
                    groupName: 'DELETED_NUMBERS'
                }, true);
            } else {
                await bot.sendMessage(chatId, "❌ Restoration failed. Record might have already been restored.");
            }
        } catch (error: any) {
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
        clearSession(chatId, 'restoreNumber');
    });

    router.registerCallback('restore_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'restoreNumber');
        await bot.sendMessage(query.message!.chat.id, "Operation cancelled.");
    });
}
