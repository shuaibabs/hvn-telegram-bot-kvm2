import TelegramBot from 'node-telegram-bot-api';
import { CommandRouter } from '../../../core/router/commandRouter';
import { getCOCPNumbers } from '../cocpService';
import { getUserProfile, isAdmin } from '../../../core/auth/permissions';
import { logger } from '../../../core/logger/logger';
import { formatToDDMMYYYY } from '../../../shared/utils/dateUtils';

export async function startListCOCPFlow(bot: TelegramBot, chatId: number, username?: string) {
    try {
        const isUserAdmin = await isAdmin(username);
        const profile = await getUserProfile(username);
        
        if (!isUserAdmin && !profile?.displayName) {
            await bot.sendMessage(chatId, "❌ *Profile Incomplete*\n\nYour profile does not have a display name set in the system. Please contact an administrator.", { parse_mode: 'Markdown' });
            return;
        }

        const employeeName = isUserAdmin ? undefined : profile?.displayName;
        const results = await getCOCPNumbers(employeeName);

        if (results.length === 0) {
            await bot.sendMessage(chatId, "📋 No COCP records found" + (employeeName ? ` for ${employeeName}` : "") + ".");
            return;
        }

        let text = `🏢 *COCP Records (${results.length})*\n`;
        text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

        const list = results.slice(0, 20);
        list.forEach((num, i) => {
            text += `${i + 1}. \`${num.mobile}\` | ${num.status}\n`;
            if (num.safeCustodyDate) text += `   └ Safe Custody: ${formatToDDMMYYYY(num.safeCustodyDate)}\n`;
            if (num.accountName) text += `   └ Account: ${num.accountName}\n`;
        });

        if (results.length > 20) {
            text += `\n...and ${results.length - 20} more. Use search for specific numbers.`;
        }

        text += `\n━━━━━━━━━━━━━━━━━━━━`;

        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (error: any) {
        logger.error(`Error in listCOCPFlow: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}

export function registerListCOCPFlow(router: CommandRouter) { }
