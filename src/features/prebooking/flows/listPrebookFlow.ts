import TelegramBot from 'node-telegram-bot-api';
import { CommandRouter } from '../../../core/router/commandRouter';
import { getPrebookingNumbers } from '../prebookingService';
import { getUserProfile, isAdmin } from '../../../core/auth/permissions';
import { logger } from '../../../core/logger/logger';
import { formatToDDMMYYYY } from '../../../shared/utils/dateUtils';

export async function startListPrebookFlow(bot: TelegramBot, chatId: number, username?: string) {
    try {
        const isUserAdmin = await isAdmin(username);
        const profile = await getUserProfile(username);
        
        if (!isUserAdmin && !profile?.displayName) {
            await bot.sendMessage(chatId, "❌ *Profile Incomplete*\n\nYour profile does not have a display name set in the system. Please contact an administrator.", { parse_mode: 'Markdown' });
            return;
        }

        const employeeName = isUserAdmin ? undefined : profile?.displayName;
        const results = await getPrebookingNumbers(employeeName);

        if (results.length === 0) {
            await bot.sendMessage(chatId, "📋 No pre-booking records found" + (employeeName ? ` for ${employeeName}` : "") + ".");
            return;
        }

        let text = `📋 *Pre-booking Records (${results.length})*\n`;
        text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

        // Limit to top 20
        const list = results.slice(0, 20);
        list.forEach((pb, i) => {
            text += `${i + 1}. \`${pb.mobile}\` | ${formatToDDMMYYYY(pb.preBookingDate)}\n`;
            text += `   └ Type: ${pb.originalNumberData.numberType}\n`;
        });

        if (results.length > 20) {
            text += `\n...and ${results.length - 20} more. Use search for specific numbers.`;
        }

        text += `\n━━━━━━━━━━━━━━━━━━━━`;

        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (error: any) {
        logger.error(`Error in listPrebookFlow: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}

export function registerListPrebookFlow(router: CommandRouter) {
}
