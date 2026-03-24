
import TelegramBot from 'node-telegram-bot-api';
import { env, GROUPS } from '../../config/env';
import { logger } from '../../core/logger/logger';

const botToken = env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(botToken); // Dedicated broadcast instance

/**
 * Escapes characters for HTML parse mode.
 */
function escapeHTML(text: string): string {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Robust broadcast service with centralized error handling.
 */
export async function broadcast(
    groupInput: string,
    message: string,
    source: 'BOT' | 'UI' = 'BOT'
): Promise<{ success: boolean; error?: string }> {

    const escapedSource = escapeHTML(source);
    const escapedGroupInput = escapeHTML(groupInput);
    
    // Note: message might contain <b>/<i> tags already if formatted by the caller, 
    // but in our case server.ts passes a string with **. 
    // Let's assume the caller provides plain text or we clean it up.
    // For now, let's transform ** to <b>.
    const htmlMessage = message.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

    const formattedMasterMsg = `<b>🔔 Master Alert</b>\n<b>Source:</b> ${escapedSource}\n<b>Action Type:</b> ${escapedGroupInput}\n\n${htmlMessage}`;

    // 1. Determine Target Group ID
    let targetGroupId = groupInput;
    if (GROUPS[groupInput as keyof typeof GROUPS]) {
        targetGroupId = GROUPS[groupInput as keyof typeof GROUPS];
    }

    const results: string[] = [];

    try {
        // 2. Send to Dedicated Group (if valid)
        if (targetGroupId && targetGroupId.startsWith('-')) {
            await bot.sendMessage(targetGroupId, htmlMessage, {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
            results.push(`Sent to Group: ${targetGroupId}`);
        }

        // 3. Mirror to Master Channel (if configured)
        const masterId = GROUPS.MASTER_CHANNEL;
        if (masterId && masterId.startsWith('-')) {
            await bot.sendMessage(masterId, formattedMasterMsg, {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
            results.push(`Mirrored to Master Channel: ${masterId}`);
        }

        logger.info(`📡 Broadcast completed: ${JSON.stringify(results)}`);
        return { success: true };

    } catch (err: any) {
        const errMsg = err.description || err.message || 'Unknown Telegram Error';
        logger.error(`❌ Broadcast Error: ${errMsg}`);
        return { success: false, error: errMsg };
    }
}

