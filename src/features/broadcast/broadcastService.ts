
import TelegramBot from 'node-telegram-bot-api';
import { env, GROUPS } from '../../config/env';
import { logger } from '../../core/logger/logger';
import { splitTelegramMessage } from '../../shared/utils/telegramMessages';

const botToken = env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(botToken); // Dedicated broadcast instance

/**
 * Space multi-part sends and retry Telegram's rate-limit responses.
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Retry only the failed part/destination so delivered messages are not duplicated.
async function sendPart(chatId: string, part: ReturnType<typeof splitTelegramMessage>[number]) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await bot.sendMessage(chatId, part.text, {
                entities: part.entities,
                disable_web_page_preview: true
            });
            return;
        } catch (error: any) {
            const details = error.response?.body;
            const message = details?.description || error.description || error.message || 'Unknown Telegram Error';
            if (!(details?.error_code === 429 || message.includes('429')) || attempt === 2) throw error;
            const seconds = details?.parameters?.retry_after || Number(message.match(/retry after (\d+)/)?.[1]) || 30;
            logger.warn(`⚠️ Telegram rate limit for ${chatId}; retrying part after ${seconds}s.`);
            await sleep((seconds + 1) * 1000);
        }
    }
}

/**
 * Robust broadcast service with centralized error handling.
 */
export async function broadcast(
    groupInput: string,
    message: string,
    source: 'BOT' | 'UI' = 'BOT',
    delivery?: { progress: Record<string, number>; onPartSent: (chatId: string, completedParts: number) => Promise<void> }
): Promise<{ success: boolean; error?: string }> {

    const masterPrefix = `**🔔 Master Alert**\n**Source:** ${source}\n**Action Type:** ${groupInput}\n\n`;

    // 1. Determine Target Group ID
    let targetGroupId = groupInput;
    if (GROUPS[groupInput as keyof typeof GROUPS]) {
        targetGroupId = GROUPS[groupInput as keyof typeof GROUPS];
    }

    const results: string[] = [];

    const targets: { id: string; prefix: string; label: string }[] = [];
    if (targetGroupId?.startsWith('-')) targets.push({ id: targetGroupId, prefix: '', label: 'Sent to Group' });
    const masterId = GROUPS.MASTER_CHANNEL;
    if (masterId?.startsWith('-') && masterId !== targetGroupId) {
        targets.push({ id: masterId, prefix: masterPrefix, label: 'Mirrored to Master Channel' });
    }
    if (!targets.length) return { success: false, error: `No Telegram destination configured for ${groupInput}` };
    if (!message.trim()) return { success: false, error: 'Cannot broadcast an empty message' };

    const errors: string[] = [];
    for (const target of targets) {
        try {
            const parts = splitTelegramMessage(message, target.prefix);
            const completed = delivery?.progress[target.id] || 0;
            for (let index = completed; index < parts.length; index++) {
                if (index > completed) await sleep(3100);
                await sendPart(target.id, parts[index]);
                if (delivery) {
                    delivery.progress[target.id] = index + 1;
                    await delivery.onPartSent(target.id, index + 1);
                }
            }
            results.push(`${target.label}: ${target.id} (${parts.length} part(s))`);
        } catch (err: any) {
            const errMsg = err.response?.body?.description || err.description || err.message || 'Unknown Telegram Error';
            errors.push(`${target.id}: ${errMsg}`);
            logger.error(`❌ Broadcast Error for ${target.id}: ${errMsg}`);
        }
    }
    if (results.length) logger.info(`📡 Broadcast completed: ${JSON.stringify(results)}`);
    return errors.length ? { success: false, error: errors.join('; ') } : { success: true };
}

