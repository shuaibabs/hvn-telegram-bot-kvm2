import TelegramBot from 'node-telegram-bot-api';
import { getSession, setSession, clearSession } from '../../../core/bot/sessionManager';
import { getCategoriesWithCounts, getNumbersInCategory } from '../categoriesService';
import { CATEGORIES, getCategories, CategoryKey } from '../../../shared/utils/vipNumberFilters';
import { generatePdfBuffer } from '../../../shared/utils/pdfGenerator';
import { calculateDigitSum } from '../../../shared/utils/utils';
import { logger } from '../../../core/logger/logger';
import { format } from 'date-fns';

type CategoriesSession = {
    stage: 'BROWSE' | 'AWAIT_CHECK_NUMBER' | 'CATEGORY_DETAIL';
    categoryPage?: number;
    selectedCategory?: CategoryKey;
    detailPage?: number;
};

const cancelBtn = { text: '❌ Cancel', callback_data: 'cat_cancel' };
const backBtn = { text: '⬅️ Back to Menu', callback_data: 'cat_start' };

export async function startBrowseCategoriesFlow(bot: TelegramBot, chatId: number, page: number = 0) {
    try {
        const categoriesWithCounts = await getCategoriesWithCounts();
        const PAGE_SIZE = 5;
        const totalPages = Math.ceil(categoriesWithCounts.length / PAGE_SIZE);
        const startIndex = page * PAGE_SIZE;
        const displayCats = categoriesWithCounts.slice(startIndex, startIndex + PAGE_SIZE);

        let text = `📋 *Browse VIP Categories*\n`;
        text += `_Page ${page + 1} of ${totalPages}_\n`;
        text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

        const rowButtons: TelegramBot.InlineKeyboardButton[] = [];

        displayCats.forEach((cat, idx) => {
            const listIdx = startIndex + idx + 1;
            text += `*${listIdx}. ${cat.label}*\n`;
            text += `├ ${cat.description}\n`;
            text += `└ In Stock: *${cat.count}* numbers\n\n`;

            rowButtons.push({
                text: `${listIdx}`,
                callback_data: `cat_select_${cat.key}`
            });
        });

        text += `━━━━━━━━━━━━━━━━━━━━\nSelect a number below to view matching inventory:`;

        const navigationRow: TelegramBot.InlineKeyboardButton[] = [];
        if (page > 0) {
            navigationRow.push({ text: '⬅️ Prev', callback_data: `cat_browse_page_${page - 1}` });
        }
        if (startIndex + PAGE_SIZE < categoriesWithCounts.length) {
            navigationRow.push({ text: 'Next ➡️', callback_data: `cat_browse_page_${page + 1}` });
        }

        const inline_keyboard: TelegramBot.InlineKeyboardButton[][] = [
            rowButtons,
            navigationRow,
            [backBtn]
        ];

        setSession(chatId, 'categories', {
            stage: 'BROWSE',
            categoryPage: page
        });

        await bot.sendMessage(chatId, text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard }
        });
    } catch (err: any) {
        logger.error(`Error browsing categories: ${err.message}`);
        await bot.sendMessage(chatId, `❌ Error loading categories: ${err.message}`);
    }
}

export async function startCheckNumberCategoryFlow(bot: TelegramBot, chatId: number) {
    setSession(chatId, 'categories', {
        stage: 'AWAIT_CHECK_NUMBER'
    });

    await bot.sendMessage(chatId, "🔍 *Check Number's Category*\n\nPlease send the 10-digit mobile number to analyze:", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[cancelBtn]]
        }
    });
}

export async function viewCategoryDetails(bot: TelegramBot, chatId: number, categoryKey: CategoryKey, page: number = 0) {
    try {
        const catDef = CATEGORIES.find(c => c.key === categoryKey);
        if (!catDef) {
            await bot.sendMessage(chatId, "❌ Invalid category selected.");
            return;
        }

        const numbers = await getNumbersInCategory(categoryKey);
        const PAGE_SIZE = 10;
        const totalPages = Math.ceil(numbers.length / PAGE_SIZE);
        const startIndex = page * PAGE_SIZE;
        const displayNumbers = numbers.slice(startIndex, startIndex + PAGE_SIZE);

        let text = `🏷️ *Category: ${catDef.label}*\n`;
        text += `📝 _${catDef.description}_\n`;
        text += `📈 Total in stock: *${numbers.length}*\n`;
        if (numbers.length > 0) {
            text += `_Page ${page + 1} of ${totalPages}_\n`;
        }
        text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

        if (numbers.length === 0) {
            text += `No numbers currently in inventory match this category.`;
        } else {
            displayNumbers.forEach((num, idx) => {
                const listIdx = startIndex + idx + 1;
                const digitSum = num.mobile.split('').reduce((acc, digit) => acc + parseInt(digit, 10), 0);
                text += `${listIdx}. \`${num.mobile}\`\n`;
                text += `   ├ Status: *${num.status}*\n`;
                text += `   ├ Sum: ${num.sum} (2-Digit: ${digitSum})\n`;
                text += `   └ Sale Price: ₹${num.salePrice}\n\n`;
            });
        }

        text += `━━━━━━━━━━━━━━━━━━━━`;

        const navigationRow: TelegramBot.InlineKeyboardButton[] = [];
        if (page > 0) {
            navigationRow.push({ text: '⬅️ Prev', callback_data: `cat_detail_page_${page - 1}` });
        }
        if (startIndex + PAGE_SIZE < numbers.length) {
            navigationRow.push({ text: 'Next ➡️', callback_data: `cat_detail_page_${page + 1}` });
        }

        const inline_keyboard: TelegramBot.InlineKeyboardButton[][] = [];
        if (navigationRow.length > 0) {
            inline_keyboard.push(navigationRow);
        }

        const actionRow: TelegramBot.InlineKeyboardButton[] = [];
        if (numbers.length > 0) {
            actionRow.push({ text: '📥 Download PDF', callback_data: 'cat_download_pdf' });
        }

        const session = getSession(chatId, 'categories') as CategoriesSession | undefined;
        const prevPage = session?.categoryPage ?? 0;
        actionRow.push({ text: '⬅️ Back to List', callback_data: `cat_browse_page_${prevPage}` });

        inline_keyboard.push(actionRow);
        inline_keyboard.push([backBtn]);

        setSession(chatId, 'categories', {
            stage: 'CATEGORY_DETAIL',
            categoryPage: prevPage,
            selectedCategory: categoryKey,
            detailPage: page
        });

        await bot.sendMessage(chatId, text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard }
        });

    } catch (err: any) {
        logger.error(`Error viewing category details: ${err.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
}

export async function handleCategoriesCallback(bot: TelegramBot, query: TelegramBot.CallbackQuery) {
    const chatId = query.message!.chat.id;
    const data = query.data || '';

    // Handle cancel
    if (data === 'cat_cancel') {
        clearSession(chatId, 'categories');
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(chatId, "❌ Action cancelled.");
        return;
    }

    // Handle browse pagination
    if (data.startsWith('cat_browse_page_')) {
        const page = parseInt(data.replace('cat_browse_page_', ''), 10);
        await bot.answerCallbackQuery(query.id);
        await bot.deleteMessage(chatId, query.message!.message_id).catch(() => {});
        await startBrowseCategoriesFlow(bot, chatId, page);
        return;
    }

    // Handle check number category
    if (data === 'cat_check_number') {
        await bot.answerCallbackQuery(query.id);
        await startCheckNumberCategoryFlow(bot, chatId);
        return;
    }

    // Handle category selection
    if (data.startsWith('cat_select_')) {
        const key = data.replace('cat_select_', '') as CategoryKey;
        await bot.answerCallbackQuery(query.id);
        await bot.deleteMessage(chatId, query.message!.message_id).catch(() => {});
        await viewCategoryDetails(bot, chatId, key, 0);
        return;
    }

    // Handle detail page pagination
    if (data.startsWith('cat_detail_page_')) {
        const page = parseInt(data.replace('cat_detail_page_', ''), 10);
        const session = getSession(chatId, 'categories') as CategoriesSession | undefined;
        if (session && session.selectedCategory) {
            await bot.answerCallbackQuery(query.id);
            await bot.deleteMessage(chatId, query.message!.message_id).catch(() => {});
            await viewCategoryDetails(bot, chatId, session.selectedCategory, page);
        }
        return;
    }

    // Handle PDF Download
    if (data === 'cat_download_pdf') {
        const session = getSession(chatId, 'categories') as CategoriesSession | undefined;
        if (!session || !session.selectedCategory) {
            await bot.answerCallbackQuery(query.id, { text: 'Session expired.' });
            return;
        }

        try {
            await bot.answerCallbackQuery(query.id, { text: 'Generating PDF...' });
            const catDef = CATEGORIES.find(c => c.key === session.selectedCategory);
            const results = await getNumbersInCategory(session.selectedCategory);

            if (!catDef || results.length === 0) {
                await bot.sendMessage(chatId, "❌ No results found to generate PDF.");
                return;
            }

            const pdfBuffer = await generatePdfBuffer({
                title: `VIP Numbers Category: ${catDef.label}`,
                subtitle: catDef.description,
                summary: [
                    { label: 'Total In Stock', value: results.length },
                    { label: 'Generated By', value: 'Telegram Bot' }
                ],
                headers: ['Mobile', 'Sum', '2-Digit Sum', 'Status', 'Sale Price'],
                rows: results.map(num => [
                    num.mobile,
                    num.sum,
                    calculateDigitSum(num.mobile),
                    num.status,
                    num.salePrice
                ])
            });

            await bot.sendDocument(chatId, pdfBuffer, {
                caption: `📊 Category Results PDF (${results.length} records)`
            }, {
                filename: `${session.selectedCategory}_inventory_${format(new Date(), 'yyyyMMdd_HHmmss')}.pdf`,
                contentType: 'application/pdf'
            });

        } catch (error: any) {
            logger.error(`Error generating categories PDF: ${error.message}`);
            await bot.sendMessage(chatId, `❌ Error generating PDF: ${error.message}`);
        }
        return;
    }
}

export async function handleCategoriesMessage(bot: TelegramBot, msg: TelegramBot.Message) {
    const chatId = msg.chat.id;
    const session = getSession(chatId, 'categories') as CategoriesSession | undefined;

    if (session && session.stage === 'AWAIT_CHECK_NUMBER') {
        const textInput = msg.text?.trim() || '';
        const cleanNumber = textInput.replace(/\D/g, '');

        if (!/^\d{10}$/.test(cleanNumber)) {
            await bot.sendMessage(chatId, "❌ Invalid number. Please enter a valid 10-digit mobile number:", {
                reply_markup: {
                    inline_keyboard: [[cancelBtn]]
                }
            });
            return;
        }

        const matchedKeys = getCategories(cleanNumber);
        let responseText = `🔢 *Categories for:* \`${cleanNumber}\`\n`;
        responseText += `Root Numerology Sum: *${calculateDigitSum(cleanNumber)}*\n`;
        responseText += `━━━━━━━━━━━━━━━━━━━━\n\n`;

        if (matchedKeys.length === 0) {
            responseText += `This number does not match any of the standard VIP categories.`;
        } else {
            matchedKeys.forEach((key, idx) => {
                const catDef = CATEGORIES.find(c => c.key === key);
                if (catDef) {
                    responseText += `*${idx + 1}. ${catDef.label}*\n`;
                    responseText += `└ _${catDef.description}_\n\n`;
                }
            });
        }

        responseText += `━━━━━━━━━━━━━━━━━━━━`;
        clearSession(chatId, 'categories');

        await bot.sendMessage(chatId, responseText, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[backBtn]]
            }
        });
    }
}
