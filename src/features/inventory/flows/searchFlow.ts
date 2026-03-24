import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { advancedSearchNumbers, AdvancedSearchCriteria } from '../inventoryService';
import { CommandRouter } from '../../../core/router/commandRouter';

const SEARCH_STAGES = {
    SELECT_TYPE: 'SELECT_TYPE',
    ADV_SEARCH_MENU: 'ADV_SEARCH_MENU',
    AWAIT_CRITERIA_VAL: 'AWAIT_CRITERIA_VAL',
    AWAIT_MUST_CONTAINS: 'AWAIT_MUST_CONTAINS',
} as const;

type SearchSession = {
    stage: keyof typeof SEARCH_STAGES;
    type?: 'Advanced' | 'MustContains';
    criteria: AdvancedSearchCriteria;
    currentSetting?: keyof AdvancedSearchCriteria;
};

const cancelBtn = { text: '❌ Cancel', callback_data: 'search_cancel' };

const criteriaLabels: Record<string, string> = {
    startWith: 'Start With',
    endWith: 'End With',
    anywhere: 'Anywhere',
    mustContain: 'Must Contain',
    notContain: 'Not Contain',
    onlyContain: 'Only Contain',
    total: 'Total (Sum)',
    sum: 'Sum (Digital Root)',
    maxContain: 'Max Contain',
    ownershipType: 'Ownership'
};

export async function startSearchFlow(bot: TelegramBot, chatId: number) {
    setSession(chatId, 'searchNumbers', {
        stage: 'SELECT_TYPE',
        criteria: {}
    });

    await bot.sendMessage(chatId, "🔍 *Search Inventory*\n\nChoose search type:", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔍 Advanced Search', callback_data: 'search_type_adv' }],
                [{ text: '🔢 Must Contains (Digits Only)', callback_data: 'search_type_must' }],
                [cancelBtn]
            ]
        }
    });
}

function getCriteriaMenu(criteria: AdvancedSearchCriteria) {
    const rows = [];
    const keys: (keyof AdvancedSearchCriteria)[] = ['startWith', 'anywhere', 'endWith', 'mustContain', 'notContain', 'onlyContain', 'total', 'sum', 'maxContain', 'ownershipType'];

    for (const key of keys) {
        const val = criteria[key] || 'Not Set';
        rows.push([{ text: `${criteriaLabels[key]}: ${val}`, callback_data: `search_set_${key}` }]);
    }

    rows.push([{ text: '✅ Apply Search', callback_data: 'search_apply' }]);
    rows.push([cancelBtn]);
    return { inline_keyboard: rows };
}

export function registerSearchFlow(router: CommandRouter) {
    const bot = router.bot;

    bot.on('message', async (msg: TelegramBot.Message) => {
        const session = getSession(msg.chat.id, 'searchNumbers') as SearchSession | undefined;
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
            setSession(chatId, 'searchNumbers', session);
            await bot.sendMessage(chatId, "✅ Updated search criteria.", {
                reply_markup: getCriteriaMenu(session.criteria)
            });
        } else if (session.stage === 'AWAIT_MUST_CONTAINS') {
            const digits = msg.text.replace(/\s/g, '');
            if (!/^\d+(,\d+)*$/.test(digits)) {
                await bot.sendMessage(chatId, "❌ Invalid format. Please enter digits separated by comma (e.g. 9,1,5).");
                return;
            }
            await performSearch(bot, chatId, { onlyContain: digits.replace(/,/g, '') });
            clearSession(chatId, 'searchNumbers');
        }
    });

    router.registerCallback(/^search_type_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'searchNumbers') as SearchSession | undefined;
        if (!session) return;

        const type = query.data?.split('_').pop();
        if (type === 'adv') {
            session.stage = 'ADV_SEARCH_MENU';
            session.type = 'Advanced';
            setSession(chatId, 'searchNumbers', session);
            await bot.sendMessage(chatId, "*Advanced Search*\nConfigure your filters:", {
                parse_mode: 'Markdown',
                reply_markup: getCriteriaMenu(session.criteria)
            });
        } else {
            session.stage = 'AWAIT_MUST_CONTAINS';
            session.type = 'MustContains';
            setSession(chatId, 'searchNumbers', session);
            await bot.sendMessage(chatId, "🔢 *Must Only Contain Digits*\n\nPlease enter the digits allowed. The search will find numbers that consist *entirely* of combinations of these digits.\n\n*Format:* Comma separated (e.g. `9,1,2`)", {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[cancelBtn]] }
            });
        }
    });

    router.registerCallback(/^search_set_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'searchNumbers') as SearchSession | undefined;
        if (!session || session.stage !== 'ADV_SEARCH_MENU') return;

        const key = query.data?.replace('search_set_', '') as keyof AdvancedSearchCriteria;
        session.currentSetting = key;
        session.stage = 'AWAIT_CRITERIA_VAL';
        setSession(chatId, 'searchNumbers', session);

        if (key === 'ownershipType') {
            await bot.sendMessage(chatId, "Select Ownership Type:", {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Individual', callback_data: 'search_val_owner_Individual' }],
                        [{ text: 'Partnership', callback_data: 'search_val_owner_Partnership' }],
                        [{ text: 'Reset', callback_data: 'search_val_owner_all' }],
                        [cancelBtn]
                    ]
                }
            });
        } else {
            await bot.sendMessage(chatId, `Enter value for *${criteriaLabels[key]}*:\n(Type 'clear' to reset this field)`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[cancelBtn]] }
            });
        }
    });

    router.registerCallback(/^search_val_owner_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'searchNumbers') as SearchSession | undefined;
        if (!session || session.currentSetting !== 'ownershipType') return;

        const val = query.data?.split('_').pop() as any;
        if (val === 'all') delete session.criteria.ownershipType;
        else session.criteria.ownershipType = val;

        session.stage = 'ADV_SEARCH_MENU';
        delete session.currentSetting;
        setSession(chatId, 'searchNumbers', session);
        await bot.sendMessage(chatId, "✅ Updated ownership filter.", {
            reply_markup: getCriteriaMenu(session.criteria)
        });
    });

    router.registerCallback('search_apply', async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'searchNumbers') as SearchSession | undefined;
        if (!session) return;

        await performSearch(bot, chatId, session.criteria);
        clearSession(chatId, 'searchNumbers');
    });

    router.registerCallback('search_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'searchNumbers');
        await bot.sendMessage(query.message!.chat.id, "Search cancelled.");
    });
}

async function performSearch(bot: TelegramBot, chatId: number, criteria: AdvancedSearchCriteria) {
    try {
        const results = await advancedSearchNumbers(criteria);
        if (results.length === 0) {
            await bot.sendMessage(chatId, "🔍 No numbers found matching your criteria.");
        } else {
            const count = results.length;

            // Generate criteria summary
            const activeCriteria = Object.entries(criteria)
                .filter(([_, v]) => v)
                .map(([k, v]) => `${criteriaLabels[k] || k}: ${v}`)
                .join(' | ');

            let text = `🔍 *Search Results (${count})*\n`;
            if (activeCriteria) text += `🎯 *Filters:* \`${activeCriteria}\`\n`;
            text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

            // Limit to top 15 for message size constraints (more details per item now)
            const displayResults = results.slice(0, 15);
            displayResults.forEach((num, i) => {
                text += `${i + 1}. \`${num.mobile}\`\n`;
                text += `   ├ Status: *${num.status}*\n`;
                text += `   ├ Type: ${num.numberType}\n`;
                text += `   ├ Sale: ₹${num.salePrice}\n`;
                text += `   └ Sum: ${num.sum} | Loc: ${num.currentLocation || 'N/A'}\n\n`;
            });

            if (count > 15) {
                text += `...and ${count - 15} more. Use more specific filters to narrow down.`;
            }

            text += `\n━━━━━━━━━━━━━━━━━━━━`;

            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        }
    } catch (error: any) {
        logger.error(`Error in search: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}
