import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { getDealerPurchaseByMobile } from '../dealerService';
import { CommandRouter } from '../../../core/router/commandRouter';

const SEARCH_STAGES = {
    AWAIT_MOBILE: 'AWAIT_MOBILE'
} as const;

type SearchSession = {
    stage: keyof typeof SEARCH_STAGES;
};

export async function startSearchDealerPurchasesFlow(bot: TelegramBot, chatId: number) {
    setSession(chatId, 'searchDealerPurchase', {
        stage: 'AWAIT_MOBILE'
    });

    await bot.sendMessage(chatId, "🔍 *Search Dealer Purchase*\n\nPlease enter the 10-digit mobile number to search:", {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'search_dealer_cancel' }]] }
    });
}

export function registerSearchDealerPurchasesFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'searchDealerPurchase') as SearchSession | undefined;
        if (!session || !msg.text || msg.text.startsWith('/')) return;

        if (session.stage === 'AWAIT_MOBILE') {
            const mobile = msg.text.trim().replace(/\D/g, '');
            if (mobile.length !== 10) {
                await bot.sendMessage(msg.chat.id, "⚠️ Please enter a valid 10-digit mobile number.");
                return;
            }

            const purchase = await getDealerPurchaseByMobile(mobile);
            if (!purchase) {
                await bot.sendMessage(msg.chat.id, `❌ No dealer purchase record found for number: ${mobile}`);
            } else {
                let text = `ℹ️ *Dealer Purchase Details*\n\n`;
                text += `📱 *Number:* ${purchase.mobile}\n`;
                text += `🔢 *Sr.No:* ${purchase.srNo}\n`;
                text += `🏢 *Dealer:* ${purchase.dealerName}\n`;
                text += `💰 *Purchase Price:* ₹${purchase.price.toLocaleString()}\n`;
                text += `🔢 *Sum:* ${purchase.sum}\n`;

                await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
            }
            clearSession(msg.chat.id, 'searchDealerPurchase');
        }
    });

    router.registerCallback('search_dealer_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'searchDealerPurchase');
        await bot.sendMessage(query.message!.chat.id, "❌ Search cancelled.");
    });
}
