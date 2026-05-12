import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { logger } from '../../../core/logger/logger';
import { advancedSearchNumbers, AdvancedSearchCriteria } from '../inventoryService';
import { CommandRouter } from '../../../core/router/commandRouter';
import { format } from 'date-fns';
import { generatePdfBuffer } from '../../../shared/utils/pdfGenerator';
import { calculateDigitSum } from '../../../shared/utils/utils';

const SEARCH_STAGES = {
    SELECT_TYPE: 'SELECT_TYPE',
    ADV_SEARCH_MENU: 'ADV_SEARCH_MENU',
    AWAIT_CRITERIA_VAL: 'AWAIT_CRITERIA_VAL',
    AWAIT_MUST_CONTAINS: 'AWAIT_MUST_CONTAINS',
    AWAIT_QUERY_TEMPLATE: 'AWAIT_QUERY_TEMPLATE',
} as const;

type SearchSession = {
    stage: keyof typeof SEARCH_STAGES;
    type?: 'Advanced' | 'MustContains' | 'QueryAdvanced';
    criteria: AdvancedSearchCriteria;
    currentSetting?: keyof AdvancedSearchCriteria;
    page: number;
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
    ownershipType: 'Ownership',
    minPrice: 'Min Sale Price',
    maxPrice: 'Max Sale Price'
};

export async function startSearchFlow(bot: TelegramBot, chatId: number) {
    setSession(chatId, 'searchNumbers', {
        stage: 'SELECT_TYPE',
        criteria: {},
        page: 0
    });

    await bot.sendMessage(chatId, "🔍 *Search Inventory*\n\nChoose search type:", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔍 Advanced Search', callback_data: 'search_type_adv' }],
                [{ text: '📋 Query Advanced Search', callback_data: 'search_type_query' }],
                [{ text: '🔢 Must Contains (Digits Only)', callback_data: 'search_type_must' }],
                [cancelBtn]
            ]
        }
    });
}

function getCriteriaMenu(criteria: AdvancedSearchCriteria) {
    const rows = [];
    const keys: (keyof AdvancedSearchCriteria)[] = [
        'startWith', 'anywhere', 'endWith', 'mustContain', 'notContain', 'onlyContain', 
        'total', 'sum', 'maxContain', 'ownershipType', 'minPrice', 'maxPrice'
    ];

    for (const key of keys) {
        const val = criteria[key] || 'Not Set';
        rows.push([{ text: `${criteriaLabels[key]}: ${val}`, callback_data: `search_set_${key}` }]);
    }

    rows.push([{ text: '✅ Apply Search', callback_data: 'search_apply' }]);
    rows.push([cancelBtn]);
    return { inline_keyboard: rows };
}

function getAdvancedQueryTemplate(): string {
    return `StartWith = 
Anywhere = 
EndWith = 
MustContain = 
NotContain = 
OnlyContain = 
TotalSum = 
DigitRoot = 
MaxRepeat = 
MinPrice = 
MaxPrice = `;
}

function parseAdvancedQueryTemplate(text: string): AdvancedSearchCriteria {
    const lines = text.split('\n');
    const criteria: AdvancedSearchCriteria = {};

    for (const line of lines) {
        const [key, ...valParts] = line.trim().split('=');
        if (!key || valParts.length === 0) continue;
        const value = valParts.join('=').trim();
        if (!value) continue;

        switch (key.trim().toLowerCase()) {
            case 'startwith': criteria.startWith = value; break;
            case 'anywhere': criteria.anywhere = value; break;
            case 'endwith': criteria.endWith = value; break;
            case 'mustcontain': criteria.mustContain = value; break;
            case 'notcontain': criteria.notContain = value; break;
            case 'onlycontain': criteria.onlyContain = value; break;
            case 'totalsum': criteria.total = value; break;
            case 'digitroot': criteria.sum = value; break;
            case 'maxrepeat': criteria.maxContain = value; break;
            case 'minprice': criteria.minPrice = value; break;
            case 'maxprice': criteria.maxPrice = value; break;
        }
    }

    return criteria;
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
        } else if (session.stage === 'AWAIT_QUERY_TEMPLATE') {
            const criteria = parseAdvancedQueryTemplate(msg.text);
            if (Object.keys(criteria).length === 0) {
                await bot.sendMessage(chatId, "⚠️ No search criteria found in the template. Please fill at least one field.");
                return;
            }
            session.criteria = criteria;
            session.page = 0;
            setSession(chatId, 'searchNumbers', session);
            await performSearch(bot, chatId, criteria);
            // We keep the session for pagination, but update stage
            session.stage = 'ADV_SEARCH_MENU'; 
            setSession(chatId, 'searchNumbers', session);
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
        } else if (type === 'query') {
            session.stage = 'AWAIT_QUERY_TEMPLATE';
            session.type = 'QueryAdvanced';
            setSession(chatId, 'searchNumbers', session);
            const template = getAdvancedQueryTemplate();
            await bot.sendMessage(chatId, "📋 *Query Advanced Search*\n\nCopy the template below, fill in your search parameters, and send it back:", {
                parse_mode: 'Markdown'
            });
            await bot.sendMessage(chatId, `\`\`\`\n${template}\n\`\`\``, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[cancelBtn]] }
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

        session.page = 0;
        setSession(chatId, 'searchNumbers', session);
        await performSearch(bot, chatId, session.criteria);
    });

    router.registerCallback(/^search_page_/, async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'searchNumbers') as SearchSession | undefined;
        if (!session) return;

        const page = parseInt(query.data!.split('_').pop()!);
        session.page = page;
        setSession(chatId, 'searchNumbers', session);

        await bot.deleteMessage(chatId, query.message!.message_id).catch(() => {});
        await performSearch(bot, chatId, session.criteria, page);
    });

    router.registerCallback('search_cancel', async (query) => {
        clearSession(query.message!.chat.id, 'searchNumbers');
        await bot.sendMessage(query.message!.chat.id, "Search cancelled.");
    });

    router.registerCallback('search_download_pdf', async (query) => {
        const chatId = query.message!.chat.id;
        const session = getSession(chatId, 'searchNumbers') as SearchSession | undefined;
        if (!session) return;

        try {
            await bot.answerCallbackQuery(query.id, { text: 'Generating PDF...' });
            const results = await advancedSearchNumbers(session.criteria);
            
            if (results.length === 0) {
                await bot.sendMessage(chatId, "❌ No results found to generate PDF.");
                return;
            }

            const pdfBuffer = await generatePdfBuffer({
                title: 'Inventory Search Results',
                subtitle: `Filters: ${Object.entries(session.criteria).filter(([_, v]) => v).map(([k, v]) => `${criteriaLabels[k] || k}: ${v}`).join(' | ')}`,
                summary: [
                    { label: 'Total Records', value: results.length },
                    { label: 'Generated By', value: 'Telegram Bot' }
                ],
                headers: ['Mobile', 'Sum', '2-Digit Sum', 'Status', 'RTP Date', 'Price'],
                rows: results.map(num => [
                    num.mobile,
                    num.sum,
                    calculateDigitSum(num.mobile),
                    num.status,
                    num.rtpDate ? format(num.rtpDate.toDate(), 'dd-MM-yyyy') : 'N/A',
                    num.salePrice
                ])
            });

            await bot.sendDocument(chatId, pdfBuffer, {
                caption: `📊 Search Results PDF (${results.length} records)`
            }, {
                filename: `inventory_search_${format(new Date(), 'yyyyMMdd_HHmmss')}.pdf`,
                contentType: 'application/pdf'
            });

        } catch (error: any) {
            logger.error(`Error generating PDF: ${error.message}`);
            await bot.sendMessage(chatId, `❌ Error generating PDF: ${error.message}`);
        }
    });
}

async function performSearch(bot: TelegramBot, chatId: number, criteria: AdvancedSearchCriteria, page: number = 0) {
    try {
        const results = await advancedSearchNumbers(criteria);
        if (results.length === 0) {
            await bot.sendMessage(chatId, "🔍 No numbers found matching your criteria.");
        } else {
            const count = results.length;
            const PAGE_SIZE = 10;
            const totalPages = Math.ceil(count / PAGE_SIZE);
            const offset = page * PAGE_SIZE;

            // Generate criteria summary
            const activeCriteria = Object.entries(criteria)
                .filter(([_, v]) => v)
                .map(([k, v]) => `${criteriaLabels[k] || k}: ${v}`)
                .join(' | ');

            let text = `🔍 *Search Results (${count})*\n`;
            if (activeCriteria) text += `🎯 *Filters:* \`${activeCriteria}\`\n`;
            text += `_Page ${page + 1} of ${totalPages}_\n`;
            text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

            const displayResults = results.slice(offset, offset + PAGE_SIZE);
            displayResults.forEach((num, i) => {
                text += `${offset + i + 1}. \`${num.mobile}\`\n`;
                text += `   ├ Status: *${num.status}*\n`;
                text += `   ├ Type: ${num.numberType}\n`;
                text += `   ├ Sale: ₹${num.salePrice}\n`;
                text += `   └ Sum: ${num.sum}\n\n`;
            });

            text += `━━━━━━━━━━━━━━━━━━━━`;

            const inline_keyboard: TelegramBot.InlineKeyboardButton[][] = [];
            const navButtons: TelegramBot.InlineKeyboardButton[] = [];

            if (page > 0) navButtons.push({ text: '⬅️ Back', callback_data: `search_page_${page - 1}` });
            if (offset + PAGE_SIZE < count) navButtons.push({ text: 'Next ➡️', callback_data: `search_page_${page + 1}` });

            if (navButtons.length > 0) inline_keyboard.push(navButtons);
            inline_keyboard.push([
                { text: '📥 Download PDF', callback_data: 'search_download_pdf' },
                { text: '❌ Close', callback_data: 'search_cancel' }
            ]);

            await bot.sendMessage(chatId, text, { 
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard }
            });
        }
    } catch (error: any) {
        logger.error(`Error in search: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}
