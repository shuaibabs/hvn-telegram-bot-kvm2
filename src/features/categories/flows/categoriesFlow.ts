import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import {
    getCategoriesWithCounts,
    getSubcategoriesWithCounts,
    getNumbersInCategory,
    getNumbersInSubcategory,
} from '../categoriesService';
import {
    getCategoryById,
    getSubcategoryName,
    getMatchingCategories,
} from '../../../shared/utils/vipNumberCategories';
import { NumberRecord } from '../../../shared/types/data';
import { generatePdfBuffer } from '../../../shared/utils/pdfGenerator';
import { calculateDigitSum } from '../../../shared/utils/utils';
import { logger } from '../../../core/logger/logger';
import { format } from 'date-fns';

type CategoriesSession = {
    stage: 'BROWSE' | 'SUBCATEGORY' | 'DETAIL' | 'AWAIT_CHECK_NUMBER';
    categoryPage?: number;
    selectedCategoryId?: number;
    subcategoryPage?: number;
    selectedSubcategory?: number | 'all';
    detailPage?: number;
};

const CAT_PAGE_SIZE = 8;
const SUB_PAGE_SIZE = 8;
const DETAIL_PAGE_SIZE = 10;

const cancelBtn = { text: '❌ Cancel', callback_data: 'cat_cancel' };
const backBtn = { text: '⬅️ Back to Menu', callback_data: 'cat_start' };

// ─── Step 1: Browse categories ──────────────────────────────────────────────────

export async function startBrowseCategoriesFlow(bot: TelegramBot, chatId: number, page: number = 0) {
    try {
        const categories = await getCategoriesWithCounts();
        const totalPages = Math.ceil(categories.length / CAT_PAGE_SIZE);
        const startIndex = page * CAT_PAGE_SIZE;
        const display = categories.slice(startIndex, startIndex + CAT_PAGE_SIZE);

        let text = `📋 *Browse VIP Categories*\n`;
        text += `_Page ${page + 1} of ${totalPages}_\n`;
        text += `━━━━━━━━━━━━━━━━━━━━\n`;
        text += `Select a category to see its subcategories:`;

        const inline_keyboard: TelegramBot.InlineKeyboardButton[][] = display.map(cat => ([{
            text: `${cat.name} (${cat.count})`,
            callback_data: `cat_pickcat_${cat.id}`,
        }]));

        const nav: TelegramBot.InlineKeyboardButton[] = [];
        if (page > 0) nav.push({ text: '⬅️ Prev', callback_data: `cat_browse_page_${page - 1}` });
        if (startIndex + CAT_PAGE_SIZE < categories.length) nav.push({ text: 'Next ➡️', callback_data: `cat_browse_page_${page + 1}` });
        if (nav.length) inline_keyboard.push(nav);
        inline_keyboard.push([backBtn]);

        setSession(chatId, 'categories', { stage: 'BROWSE', categoryPage: page } as CategoriesSession);
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard } });
    } catch (err: any) {
        logger.error(`Error browsing categories: ${err.message}`);
        await bot.sendMessage(chatId, `❌ Error loading categories: ${err.message}`);
    }
}

// ─── Step 2: Subcategories of a chosen category ─────────────────────────────────

export async function showSubcategories(bot: TelegramBot, chatId: number, catId: number, page: number = 0) {
    try {
        const { category, allCount, subcategories } = await getSubcategoriesWithCounts(catId);

        // Entries: an "All" pseudo-row first, then the real subcategories.
        const entries: { label: string; data: string; count: number }[] = [
            { label: `🗂 All ${category.name}`, data: `cat_picksub_${catId}_all`, count: allCount },
            ...subcategories.map(s => ({ label: s.name, data: `cat_picksub_${catId}_${s.id}`, count: s.count })),
        ];

        const totalPages = Math.max(1, Math.ceil(entries.length / SUB_PAGE_SIZE));
        const startIndex = page * SUB_PAGE_SIZE;
        const display = entries.slice(startIndex, startIndex + SUB_PAGE_SIZE);

        let text = `🏷️ *${category.name}*\n`;
        text += `_Subcategories — Page ${page + 1} of ${totalPages}_\n`;
        text += `━━━━━━━━━━━━━━━━━━━━\n`;
        text += `Select a subcategory to view matching numbers:`;

        const inline_keyboard: TelegramBot.InlineKeyboardButton[][] = display.map(e => ([{
            text: `${e.label} (${e.count})`,
            callback_data: e.data,
        }]));

        const nav: TelegramBot.InlineKeyboardButton[] = [];
        if (page > 0) nav.push({ text: '⬅️ Prev', callback_data: `cat_subpage_${catId}_${page - 1}` });
        if (startIndex + SUB_PAGE_SIZE < entries.length) nav.push({ text: 'Next ➡️', callback_data: `cat_subpage_${catId}_${page + 1}` });
        if (nav.length) inline_keyboard.push(nav);

        const session = getSession(chatId, 'categories') as CategoriesSession | undefined;
        inline_keyboard.push([
            { text: '⬅️ Back to Categories', callback_data: `cat_browse_page_${session?.categoryPage ?? 0}` },
            backBtn,
        ]);

        setSession(chatId, 'categories', {
            stage: 'SUBCATEGORY',
            categoryPage: session?.categoryPage ?? 0,
            selectedCategoryId: catId,
            subcategoryPage: page,
        } as CategoriesSession);

        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard } });
    } catch (err: any) {
        logger.error(`Error showing subcategories: ${err.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
}

// ─── Step 3: Numbers in a category/subcategory ──────────────────────────────────

export async function viewNumbers(bot: TelegramBot, chatId: number, catId: number, subId: number | 'all', page: number = 0) {
    try {
        const category = getCategoryById(catId);
        if (!category) { await bot.sendMessage(chatId, '❌ Invalid category.'); return; }

        const numbers = subId === 'all'
            ? await getNumbersInCategory(catId)
            : await getNumbersInSubcategory(subId);

        const label = subId === 'all' ? `All ${category.name}` : (getSubcategoryName(catId, subId) ?? 'Subcategory');
        const totalPages = Math.max(1, Math.ceil(numbers.length / DETAIL_PAGE_SIZE));
        const startIndex = page * DETAIL_PAGE_SIZE;
        const display = numbers.slice(startIndex, startIndex + DETAIL_PAGE_SIZE);

        let text = `🏷️ *${category.name} › ${label}*\n`;
        text += `📈 In stock: *${numbers.length}*`;
        if (numbers.length > 0) text += `  _(Page ${page + 1} of ${totalPages})_`;
        text += `\n━━━━━━━━━━━━━━━━━━━━\n\n`;

        if (numbers.length === 0) {
            text += `No inventory numbers currently match this filter.`;
        } else {
            display.forEach((num, idx) => {
                text += `${startIndex + idx + 1}. \`${num.mobile}\`\n`;
                text += `   ├ Status: *${num.status}*\n`;
                text += `   ├ Sum: ${num.sum} (2-Digit: ${calculateDigitSum(num.mobile)})\n`;
                text += `   └ Sale Price: ₹${num.salePrice}\n\n`;
            });
        }
        text += `━━━━━━━━━━━━━━━━━━━━`;

        const inline_keyboard: TelegramBot.InlineKeyboardButton[][] = [];
        const nav: TelegramBot.InlineKeyboardButton[] = [];
        if (page > 0) nav.push({ text: '⬅️ Prev', callback_data: `cat_detpage_${page - 1}` });
        if (startIndex + DETAIL_PAGE_SIZE < numbers.length) nav.push({ text: 'Next ➡️', callback_data: `cat_detpage_${page + 1}` });
        if (nav.length) inline_keyboard.push(nav);

        const actions: TelegramBot.InlineKeyboardButton[] = [];
        if (numbers.length > 0) actions.push({ text: '📥 Download PDF', callback_data: 'cat_pdf' });
        actions.push({ text: '⬅️ Back', callback_data: `cat_backsubs` });
        inline_keyboard.push(actions);
        inline_keyboard.push([backBtn]);

        const session = getSession(chatId, 'categories') as CategoriesSession | undefined;
        setSession(chatId, 'categories', {
            stage: 'DETAIL',
            categoryPage: session?.categoryPage ?? 0,
            selectedCategoryId: catId,
            subcategoryPage: session?.subcategoryPage ?? 0,
            selectedSubcategory: subId,
            detailPage: page,
        } as CategoriesSession);

        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard } });
    } catch (err: any) {
        logger.error(`Error viewing numbers: ${err.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
}

// ─── Check a single number's categories ─────────────────────────────────────────

export async function startCheckNumberCategoryFlow(bot: TelegramBot, chatId: number) {
    setSession(chatId, 'categories', { stage: 'AWAIT_CHECK_NUMBER' } as CategoriesSession);
    await bot.sendMessage(chatId, "🔍 *Check Number's Category*\n\nPlease send the 10-digit mobile number to analyze:", {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[cancelBtn]] },
    });
}

// ─── Callback router ────────────────────────────────────────────────────────────

export async function handleCategoriesCallback(bot: TelegramBot, query: TelegramBot.CallbackQuery) {
    const chatId = query.message!.chat.id;
    const data = query.data || '';
    const refresh = async (fn: () => Promise<void>) => {
        await bot.answerCallbackQuery(query.id);
        await bot.deleteMessage(chatId, query.message!.message_id).catch(() => {});
        await fn();
    };

    if (data === 'cat_cancel') {
        clearSession(chatId, 'categories');
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(chatId, '❌ Action cancelled.');
        return;
    }

    if (data === 'cat_check_number') {
        await bot.answerCallbackQuery(query.id);
        await startCheckNumberCategoryFlow(bot, chatId);
        return;
    }

    if (data.startsWith('cat_browse_page_')) {
        const page = parseInt(data.replace('cat_browse_page_', ''), 10) || 0;
        await refresh(() => startBrowseCategoriesFlow(bot, chatId, page));
        return;
    }

    if (data.startsWith('cat_pickcat_')) {
        const catId = parseInt(data.replace('cat_pickcat_', ''), 10);
        await refresh(() => showSubcategories(bot, chatId, catId, 0));
        return;
    }

    if (data.startsWith('cat_subpage_')) {
        const [, catIdStr, pageStr] = data.match(/^cat_subpage_(\d+)_(\d+)$/) || [];
        if (catIdStr) await refresh(() => showSubcategories(bot, chatId, parseInt(catIdStr, 10), parseInt(pageStr, 10) || 0));
        return;
    }

    if (data.startsWith('cat_picksub_')) {
        const m = data.match(/^cat_picksub_(\d+)_(all|\d+)$/);
        if (m) {
            const catId = parseInt(m[1], 10);
            const subId: number | 'all' = m[2] === 'all' ? 'all' : parseInt(m[2], 10);
            await refresh(() => viewNumbers(bot, chatId, catId, subId, 0));
        }
        return;
    }

    if (data.startsWith('cat_detpage_')) {
        const page = parseInt(data.replace('cat_detpage_', ''), 10) || 0;
        const session = getSession(chatId, 'categories') as CategoriesSession | undefined;
        if (session?.selectedCategoryId !== undefined && session.selectedSubcategory !== undefined) {
            await refresh(() => viewNumbers(bot, chatId, session.selectedCategoryId!, session.selectedSubcategory!, page));
        }
        return;
    }

    if (data === 'cat_backsubs') {
        const session = getSession(chatId, 'categories') as CategoriesSession | undefined;
        if (session?.selectedCategoryId !== undefined) {
            await refresh(() => showSubcategories(bot, chatId, session.selectedCategoryId!, session.subcategoryPage ?? 0));
        }
        return;
    }

    if (data === 'cat_pdf') {
        const session = getSession(chatId, 'categories') as CategoriesSession | undefined;
        if (!session || session.selectedCategoryId === undefined || session.selectedSubcategory === undefined) {
            await bot.answerCallbackQuery(query.id, { text: 'Session expired.' });
            return;
        }
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Generating PDF...' });
            const catId = session.selectedCategoryId;
            const subId = session.selectedSubcategory;
            const category = getCategoryById(catId);
            const results = subId === 'all' ? await getNumbersInCategory(catId) : await getNumbersInSubcategory(subId as number);
            const label = subId === 'all' ? `All ${category?.name}` : (getSubcategoryName(catId, subId as number) ?? 'Subcategory');

            if (!category || results.length === 0) {
                await bot.sendMessage(chatId, '❌ No results found to generate PDF.');
                return;
            }

            const pdfBuffer = await generatePdfBuffer({
                title: `VIP Numbers: ${category.name} › ${label}`,
                subtitle: `Category: ${category.name} | Subcategory: ${label}`,
                summary: [
                    { label: 'Total In Stock', value: results.length },
                    { label: 'Generated By', value: 'Telegram Bot' },
                ],
                headers: ['Mobile', 'Sum', '2-Digit Sum', 'Status', 'Sale Price'],
                rows: results.map(num => [num.mobile, num.sum, calculateDigitSum(num.mobile), num.status, num.salePrice]),
            });

            await bot.sendDocument(chatId, pdfBuffer, {
                caption: `📊 ${category.name} › ${label} (${results.length} records)`,
            }, {
                filename: `${category.slug}_${subId}_${format(new Date(), 'yyyyMMdd_HHmmss')}.pdf`,
                contentType: 'application/pdf',
            });
        } catch (error: any) {
            logger.error(`Error generating categories PDF: ${error.message}`);
            await bot.sendMessage(chatId, `❌ Error generating PDF: ${error.message}`);
        }
        return;
    }
}

// ─── Text handler (check-number flow) ───────────────────────────────────────────

export async function handleCategoriesMessage(bot: TelegramBot, msg: TelegramBot.Message) {
    const chatId = msg.chat.id;
    const session = getSession(chatId, 'categories') as CategoriesSession | undefined;
    if (!session || session.stage !== 'AWAIT_CHECK_NUMBER') return;

    const cleanNumber = (msg.text?.trim() || '').replace(/\D/g, '');
    if (!/^\d{10}$/.test(cleanNumber)) {
        await bot.sendMessage(chatId, '❌ Invalid number. Please enter a valid 10-digit mobile number:', {
            reply_markup: { inline_keyboard: [[cancelBtn]] },
        });
        return;
    }

    const matches = getMatchingCategories(cleanNumber);
    let responseText = `🔢 *Categories for:* \`${cleanNumber}\`\n`;
    responseText += `Root Numerology Sum: *${calculateDigitSum(cleanNumber)}*\n`;
    responseText += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (matches.length === 0) {
        responseText += `This number does not match any of the VIP categories.`;
    } else {
        matches.forEach(({ category, subcategories }, idx) => {
            responseText += `*${idx + 1}. ${category.name}*\n`;
            if (subcategories.length > 0) {
                responseText += `   └ _${subcategories.map(s => s.name).join(', ')}_\n`;
            }
            responseText += `\n`;
        });
    }
    responseText += `━━━━━━━━━━━━━━━━━━━━`;
    clearSession(chatId, 'categories');

    await bot.sendMessage(chatId, responseText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[backBtn]] },
    });
}
