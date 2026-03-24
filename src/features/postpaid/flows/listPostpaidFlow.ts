import TelegramBot from 'node-telegram-bot-api';
import { CommandRouter } from '../../../core/router/commandRouter';
import { getPostpaidNumbers } from '../postpaidService';
import { getUserProfile, isAdmin } from '../../../core/auth/permissions';
import { logger } from '../../../core/logger/logger';
import { formatToDDMMYYYY } from '../../../shared/utils/dateUtils';

export async function startListPostpaidFlow(bot: TelegramBot, chatId: number, username?: string) {
    try {
        const isUserAdmin = await isAdmin(username);
        const profile = await getUserProfile(username);
        
        if (!isUserAdmin && !profile?.displayName) {
            await bot.sendMessage(chatId, "❌ *Profile Incomplete*\n\nYour profile does not have a display name set in the system. Please contact an administrator.", { parse_mode: 'Markdown' });
            return;
        }

        const employeeName = isUserAdmin ? undefined : profile?.displayName;
        const results = await getPostpaidNumbers(employeeName);

        if (results.length === 0) {
            await bot.sendMessage(chatId, "📋 No postpaid records found" + (employeeName ? ` for ${employeeName}` : "") + ".");
            return;
        }

        let text = `📱 *Postpaid Records (${results.length})*\n`;
        text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

        const list = results.slice(0, 20);
        list.forEach((num, i) => {
            text += `${i + 1}. \`${num.mobile}\` | ${num.status}\n`;
            if (num.billDate) text += `   └ Bill Date: ${formatToDDMMYYYY(num.billDate)}\n`;
            text += `   └ PD Bill: ${num.pdBill || 'N/A'}\n`;
        });

        if (results.length > 20) {
            text += `\n...and ${results.length - 20} more. Use search for specific numbers.`;
        }

        text += `\n━━━━━━━━━━━━━━━━━━━━`;

        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (error: any) {
        logger.error(`Error in listPostpaidFlow: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}

export function registerListPostpaidFlow(router: CommandRouter) { }
