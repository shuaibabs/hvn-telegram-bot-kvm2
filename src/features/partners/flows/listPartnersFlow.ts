import TelegramBot from 'node-telegram-bot-api';
import { CommandRouter } from '../../../core/router/commandRouter';
import { getPartnershipNumbers } from '../partnersService';
import { getUserProfile, isAdmin } from '../../../core/auth/permissions';
import { logger } from '../../../core/logger/logger';

export async function startListPartnersFlow(bot: TelegramBot, chatId: number, username?: string) {
    try {
        const isUserAdmin = await isAdmin(username);
        const profile = await getUserProfile(username);
        
        if (!isUserAdmin && !profile?.displayName) {
            await bot.sendMessage(chatId, "❌ *Profile Incomplete*\n\nYour profile does not have a display name set in the system. Please contact an administrator.", { parse_mode: 'Markdown' });
            return;
        }

        const employeeName = isUserAdmin ? undefined : profile?.displayName;
        const results = await getPartnershipNumbers(employeeName);

        if (results.length === 0) {
            await bot.sendMessage(chatId, "📋 No partnership records found" + (employeeName ? ` for ${employeeName}` : "") + ".");
            return;
        }

        let text = `🤝 *Partnership Records (${results.length})*\n`;
        text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

        const list = results.slice(0, 20);
        list.forEach((num, i) => {
            text += `${i + 1}. \`${num.mobile}\` | ${num.status}\n`;
            if (num.partnerName) text += `   └ Partner: ${num.partnerName}\n`;
            text += `   └ Assigned: ${num.assignedTo}\n`;
        });

        if (results.length > 20) {
            text += `\n...and ${results.length - 20} more. Use search for specific numbers.`;
        }

        text += `\n━━━━━━━━━━━━━━━━━━━━`;

        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (error: any) {
        logger.error(`Error in listPartnersFlow: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}

export function registerListPartnersFlow(router: CommandRouter) { }
