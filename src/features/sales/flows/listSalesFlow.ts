import TelegramBot from 'node-telegram-bot-api';
import { CommandRouter } from '../../../core/router/commandRouter';
import { getSalesNumbers } from '../salesService';
import { getUserProfile, isAdmin } from '../../../core/auth/permissions';
import { logger } from '../../../core/logger/logger';

export async function startListSalesFlow(bot: TelegramBot, chatId: number, username?: string) {
    try {
        const isUserAdmin = await isAdmin(username);
        const profile = await getUserProfile(username);
        
        if (!isUserAdmin && !profile?.displayName) {
            await bot.sendMessage(chatId, "❌ *Profile Incomplete*\n\nYour profile does not have a display name set in the system. Please contact an administrator.", { parse_mode: 'Markdown' });
            return;
        }

        const employeeName = isUserAdmin ? undefined : profile?.displayName;
        const results = await getSalesNumbers(employeeName);

        if (results.length === 0) {
            await bot.sendMessage(chatId, "📋 No sales records found" + (employeeName ? ` for ${employeeName}` : "") + ".");
            return;
        }

        let text = `📋 *Sales Records (${results.length})*\n`;
        text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

        // Limit to top 20 for message size constraints
        const list = results.slice(0, 20);
        list.forEach((sale, i) => {
            text += `${i + 1}. \`${sale.mobile}\` | ₹${sale.salePrice}\n`;
            text += `   └ Sold to: ${sale.soldTo}\n`;
        });

        if (results.length > 20) {
            text += `\n...and ${results.length - 20} more. Use search for specific numbers.`;
        }

        text += `\n━━━━━━━━━━━━━━━━━━━━`;

        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (error: any) {
        logger.error(`Error in listSalesFlow: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}

export function registerListSalesFlow(router: CommandRouter) {
    // No specific callbacks needed if it's just a direct call from menu
}
