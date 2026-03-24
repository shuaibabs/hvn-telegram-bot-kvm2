import TelegramBot from 'node-telegram-bot-api';
import { getDealerPurchases } from '../dealerService';
import { CommandRouter } from '../../../core/router/commandRouter';

export async function startListDealerPurchasesFlow(bot: TelegramBot, chatId: number, employeeUid?: string) {
    const purchases = await getDealerPurchases(employeeUid);
    if (purchases.length === 0) {
        await bot.sendMessage(chatId, "📋 No dealer purchase records found.");
        return;
    }

    let text = `📋 *Dealer Purchase Records (${purchases.length})*\n\n`;
    
    // Show top 20 most recent
    const recent = purchases.sort((a: any, b: any) => b.srNo - a.srNo).slice(0, 20);
    
    recent.forEach((p: any) => {
        text += `🔹 \`${p.mobile}\` | ₹${p.price.toLocaleString()} | ${p.dealerName}\n`;
    });

    if (purchases.length > 20) {
        text += `\n...and ${purchases.length - 20} more. Use Search to find a specific number.`;
    }

    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}

export function registerListDealerPurchasesFlow(router: CommandRouter) {
    // This flow is mostly triggered from the menu, no complex interactive stages needed for now.
}
