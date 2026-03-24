import TelegramBot from 'node-telegram-bot-api';
import { getDeletedNumbers } from '../deletedService';
import { isAdmin, getUserProfile } from '../../../core/auth/permissions';
import { CommandRouter } from '../../../core/router/commandRouter';
import { logger } from '../../../core/logger/logger';

export async function startListDeletedFlow(bot: TelegramBot, chatId: number, username?: string) {
    try {
        const isUserAdmin = await isAdmin(username);
        const profile = await getUserProfile(username);
        const employeeName = isUserAdmin ? undefined : profile?.displayName;

        const results = await getDeletedNumbers(employeeName);

        if (results.length === 0) {
            await bot.sendMessage(chatId, "🔍 No deleted numbers found.");
            return;
        }

        const count = results.length;
        let text = `📜 *Deleted Numbers (${count})*\n`;
        text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

        results.slice(0, 15).forEach((num: any, i: number) => {
            text += `${i + 1}. \`${num.mobile}\` | Deleted By: ${num.deletedBy}\n   Reason: ${num.deletionReason}\n\n`;
        });

        if (count > 15) text += `...and ${count - 15} more records.`;
        text += `\n━━━━━━━━━━━━━━━━━━━━`;

        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (error: any) {
        logger.error(`Error in listDeletedFlow: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}
