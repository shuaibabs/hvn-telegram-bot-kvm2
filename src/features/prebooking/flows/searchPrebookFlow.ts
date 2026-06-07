import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { searchPrebookingNumbers, PrebookSearchCriteria } from '../prebookingService';
import { CommandRouter } from '../../../core/router/commandRouter';
import { getUserProfile, isAdmin } from '../../../core/auth/permissions';
import { formatToDDMMYYYY } from '../../../shared/utils/dateUtils';

const SEARCH_STAGES = {
    SELECT_TYPE: 'SELECT_TYPE',
    ADV_SEARCH_MENU: 'ADV_SEARCH_MENU',
    AWAIT_CRITERIA_VAL: 'AWAIT_CRITERIA_VAL',
    AWAIT_MUST_CONTAINS: 'AWAIT_MUST_CONTAINS',
} as const;

type SearchSession = {
    stage: keyof typeof SEARCH_STAGES;
    type?: 'Advanced' | 'MustContains';
    criteria: PrebookSearchCriteria;
    currentSetting?: keyof PrebookSearchCriteria;
    page: number;
};

const cancelBtn = { text: '❌ Cancel', callback_data: 'pb_search_cancel' };

const criteriaLabels: Record<string, string> = {
    startWith: 'Start With',
    endWith: 'End With',
    anywhere: 'Anywhere',
    exactPlacement: 'Exact Placement',
    mustContain: 'Must Contain',
    notContain: 'Not Contain',
    onlyContain: 'Only Contain',
    total: 'Total (Sum)',
    sum: 'Sum (Digital Root)',
    minPrice: 'Min Sale Price',
    maxPrice: 'Max Sale Price'
};

export async function startSearchPrebookFlow(bot: TelegramBot, chatId: number) {
    setSession(chatId, 'searchPrebook', {
        stage: 'SELECT_TYPE',
        criteria: {},
        page: 0
    });

    await bot.sendMessage(chatId, "🔍 *Search Pre-bookings*\n\nChoose search type:", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔍 Advanced Search', callback_data: 'pb_search_type_adv' }],
                [{ text: '🔢 Must Contains (Digits Only)', callback_data: 'pb_search_type_must' }],
                [cancelBtn]
            ]
        }
    });
}

function getCriteriaMenu(criteria: PrebookSearchCriteria) {
    const rows = [];
    const keys: (keyof PrebookSearchCriteria)[] = ['startWith', 'anywhere', 'exactPlacement', 'endWith', 'mustContain', 'notContain', 'onlyContain', 'total', 'sum', 'minPrice', 'maxPrice'];

    for (const key of keys) {
        const val = criteria[key] || 'Not Set';
        rows.push([{ text: `${criteriaLabels[key]}: ${val}`, callback_data: `pb_search_set_${key}` }]);
    }

    rows.push([{ text: '✅ Apply Search', callback_data: 'pb_search_apply' }]);
    rows.push([cancelBtn]);
    return { inline_keyboard: rows };
}

export function registerSearchPrebookFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'searchPrebook') as SearchSession | undefined;
        if (!session || !msg.text || msg.text.startsWith('/')) return;

        const chatId = msg.chat.id;

        if (session.stage === 'AWAIT_CRITERIA_VAL' && session.currentSetting) {
            const val = msg.text.trim();
            if (val.toLowerCase() === 'clear') {
                delete session.criteria[session.currentSetting];
            } else {
                (session.criteria as any)[session.currentSetting] = val;
            }
            session.stage = 'ADV_SEARCH_MENU';
            delete session.currentSetting;
            setSession(chatId, 'searchPrebook', session);
            await bot.sendMessage(chatId, "✅ Updated search criteria.", {
                reply_markup: getCriteriaMenu(session.criteria)
            });
        } else if (session.stage === 'AWAIT_MUST_CONTAINS') {
            const digits = msg.text.replace(/\s/g, '');
            if (!/^\d+(,\d+)*$/.test(digits)) {
                await bot.sendMessage(chatId, "❌ Invalid format. Please enter digits separated by comma (e.g. 9,1,5).");
                return;
            }
            await performSearch(bot, chatId, { onlyContain: digits.replace(/,/g, '') }, msg.from?.username);
            clearSession(chatId, 'searchPrebook');
        }
    });

    router.registerCallback(/^pb_search_type_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'searchPrebook') as SearchSession | undefined;
        if (!session) return;

        const type = query.data?.split('_').pop();
        if (type === 'adv') {
            session.stage = 'ADV_SEARCH_MENU';
            session.type = 'Advanced';
            setSession(chatId, 'searchPrebook', session);
            await bot.sendMessage(chatId, "*Advanced Pre-booking Search*\nConfigure your filters:", {
                parse_mode: 'Markdown',
                reply_markup: getCriteriaMenu(session.criteria)
            });
        } else {
            session.stage = 'AWAIT_MUST_CONTAINS';
            session.type = 'MustContains';
            setSession(chatId, 'searchPrebook', session);
            await bot.sendMessage(chatId, "🔢 *Must Only Contain Digits*\n\nPlease enter the digits allowed.\n\n*Format:* Comma separated (e.g. `9,1,2`)", {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[cancelBtn]] }
            });
        }
    });

    router.registerCallback(/^pb_search_set_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'searchPrebook') as SearchSession | undefined;
        if (!session || session.stage !== 'ADV_SEARCH_MENU') return;

        const key = query.data?.replace('pb_search_set_', '') as keyof PrebookSearchCriteria;
        session.currentSetting = key;
        session.stage = 'AWAIT_CRITERIA_VAL';
        setSession(chatId, 'searchPrebook', session);

        await bot.sendMessage(chatId, key === 'exactPlacement'
            ? "🎯 *Exact Digit Placement*\n\nSend a 10-position pattern. Put a digit where you want it fixed and `x` (or `_`) for any other position.\n\n*Example:* `9xxxx5xxxx` → 1st digit = 9, 6th digit = 5.\n(Type 'clear' to reset)"
            : `Enter value for *${criteriaLabels[key]}*:\n(Type 'clear' to reset this field)`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[cancelBtn]] }
        });
    });

    router.registerCallback('pb_search_apply', async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'searchPrebook') as SearchSession | undefined;
        if (!session) return;

        session.page = 0;
        setSession(chatId, 'searchPrebook', session);
        await performSearch(bot, chatId, session.criteria, query.from.username);
    });

    router.registerCallback(/^pb_search_page_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'searchPrebook') as SearchSession | undefined;
        if (!session) return;

        const page = parseInt(query.data!.split('_').pop()!);
        session.page = page;
        setSession(chatId, 'searchPrebook', session);

        await bot.deleteMessage(chatId, query.message!.message_id).catch(() => {});
        await performSearch(bot, chatId, session.criteria, query.from.username, page);
    });

    router.registerCallback('pb_search_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'searchPrebook');
        await bot.sendMessage(query.message!.chat.id, "Search cancelled.");
    });
}

async function performSearch(bot: TelegramBot, chatId: number, criteria: PrebookSearchCriteria, username?: string, page: number = 0) {
    try {
        const isUserAdmin = await isAdmin(username);
        const profile = await getUserProfile(username);

        if (!isUserAdmin && !profile?.displayName) {
            await bot.sendMessage(chatId, "❌ *Profile Incomplete*\n\nYour profile does not have a display name set in the system. Please contact an administrator.", { parse_mode: 'Markdown' });
            return;
        }

        const employeeName = isUserAdmin ? undefined : profile?.displayName;

        const results = await searchPrebookingNumbers(criteria, employeeName);
        if (results.length === 0) {
            await bot.sendMessage(chatId, "🔍 No pre-booked numbers found matching your criteria.");
        } else {
            const count = results.length;
            const PAGE_SIZE = 10;
            const totalPages = Math.ceil(count / PAGE_SIZE);
            const offset = page * PAGE_SIZE;

            const activeCriteria = Object.entries(criteria)
                .filter(([_, v]) => v)
                .map(([k, v]) => `${criteriaLabels[k] || k}: ${v}`)
                .join(' | ');

            let text = `🔍 *Pre-booking Search Results (${count})*\n`;
            if (activeCriteria) text += `🎯 *Filters:* \`${activeCriteria}\`\n`;
            text += `_Page ${page + 1} of ${totalPages}_\n`;
            text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

            const displayResults = results.slice(offset, offset + PAGE_SIZE);
            displayResults.forEach((pb, i) => {
                text += `${offset + i + 1}. \`${pb.mobile}\` | ${formatToDDMMYYYY(pb.preBookingDate)}\n`;
                text += `   └ Type: ${pb.originalNumberData.numberType}\n`;
            });

            text += `\n━━━━━━━━━━━━━━━━━━━━`;

            const inline_keyboard: TelegramBot.InlineKeyboardButton[][] = [];
            const navButtons: TelegramBot.InlineKeyboardButton[] = [];

            if (page > 0) navButtons.push({ text: '⬅️ Back', callback_data: `pb_search_page_${page - 1}` });
            if (offset + PAGE_SIZE < count) navButtons.push({ text: 'Next ➡️', callback_data: `pb_search_page_${page + 1}` });

            if (navButtons.length > 0) inline_keyboard.push(navButtons);
            inline_keyboard.push([{ text: '❌ Close', callback_data: 'pb_search_cancel' }]);

            await bot.sendMessage(chatId, text, { 
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard }
            });
        }
    } catch (error: any) {
        logger.error(`Error in performSearch (Prebook): ${error.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}
