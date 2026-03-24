import TelegramBot from 'node-telegram-bot-api';
import { RESPONSES } from '../utils/telegram';

/**
 * Validates that a command is being typed in the correct Telegram group.
 * If typed elsewhere, it blocks and warns the user.
 */
export const validateGroup = (
    bot: TelegramBot,
    msg: TelegramBot.Message,
    expectedGroupId: string | string[],
    moduleName: string
): boolean => {

    const currentId = msg.chat.id.toString().trim();
    const targets = Array.isArray(expectedGroupId)
        ? expectedGroupId.map(id => id.toString().trim())
        : [expectedGroupId.toString().trim()];

    console.log(`🔍 [VALIDATE] Module: ${moduleName} | ChatID: ${currentId} | Target-List: ${targets.join(', ')}`);

    // 1. Bypass check for Private Chats (Admin direct management)
    if (msg.chat.type === 'private') {
        return true;
    }

    // 2. Validate Group ID
    const isValid = targets.includes(currentId);

    if (!isValid) {
        const warning = RESPONSES.WARNING(`This command is not allowed in this group. Please use it in the appropriate group for ${moduleName} management, or contact an administrator.`);
        bot.sendMessage(msg.chat.id, warning, { parse_mode: 'Markdown' });
        return false;
    }

    return true;
};
