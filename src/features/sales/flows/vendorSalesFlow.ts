import TelegramBot from 'node-telegram-bot-api';
import { getSalesVendors, getVendorSalesStats } from '../salesService';
import { CommandRouter } from '../../../core/router/commandRouter';
import { logger } from '../../../core/logger/logger';
import { formatToDDMMYYYY } from '../../../shared/utils/dateUtils';
import { generatePdfBuffer } from '../../../shared/utils/pdfGenerator';
import { format } from 'date-fns';

export async function startVendorSalesFlow(bot: TelegramBot, chatId: number) {
    try {
        const vendors = await getSalesVendors();

        if (vendors.length === 0) {
            await bot.sendMessage(chatId, "📋 No sales vendors found.");
            return;
        }

        const keyboard = vendors.map(v => ([{
            text: v.name,
            callback_data: `sales_vendor_stat:${v.name}`
        }]));

        await bot.sendMessage(chatId, "📈 *Sales by Vendor*\n\nPlease select a vendor to view their sales statistics:", {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        });
    } catch (error: any) {
        logger.error(`Error in startVendorSalesFlow: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}

export function registerVendorSalesFlow(router: CommandRouter) {
    const bot = router.bot;

    router.registerCallback(/^sales_vendor_stat:(.+)$/, async (query: TelegramBot.CallbackQuery) => {
        const data = query.data || '';
        const match = /^sales_vendor_stat:(.+)$/.exec(data);
        if (!match) return;

        const chatId = query.message!.chat.id;
        const vendorName = match[1];

        try {
            await bot.sendChatAction(chatId, 'typing');
            const stats = await getVendorSalesStats(vendorName);

            let text = `📊 *Vendor Sales Report: ${vendorName}*\n`;
            text += `━━━━━━━━━━━━━━━━━━━━\n\n`;
            text += `💰 *Total Billed:* ₹${stats.totalBilled.toLocaleString()}\n`;
            text += `📉 *Total Purchase:* ₹${stats.totalPurchaseAmount.toLocaleString()}\n`;
            
            const profitLabel = stats.profitLoss >= 0 ? "📈 *Profit:*" : "📉 *Loss:*";
            text += `${profitLabel} ₹${Math.abs(stats.profitLoss).toLocaleString()}\n\n`;
            
            text += `✅ *Total Paid:* ₹${stats.totalPaid.toLocaleString()}\n`;
            
            const remainingLabel = stats.amountRemaining > 0 ? "⚠️ *Amount Remaining:*" : "✅ *Amount Remaining:*";
            text += `${remainingLabel} ₹${stats.amountRemaining.toLocaleString()}\n\n`;
            
            text += `📝 *Total Records:* ${stats.totalRecords}\n`;
            text += `━━━━━━━━━━━━━━━━━━━━\n\n`;
            text += `📋 *Sale Records (Details):*\n`;

            if (stats.records && stats.records.length > 0) {
                stats.records.forEach((r: any, idx: number) => {
                    const dateStr = formatToDDMMYYYY(r.saleDate);
                    const reason = r.saleReason ? ` | Reason: ${r.saleReason}` : '';
                    text += `${idx + 1}. \`${r.mobile}\` | Sum: ${r.sum} | ₹${r.salePrice.toLocaleString()} | ${dateStr}${reason}\n`;
                });
            } else {
                text += "_No records found._";
            }
            
            text += `\n━━━━━━━━━━━━━━━━━━━━`;

            await bot.sendMessage(chatId, text, { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📥 Download Full PDF', callback_data: `sales_vendor_pdf:${vendorName}` }],
                        [{ text: '📅 Monthly PDF Report', callback_data: `sales_vendor_pdf_year:${vendorName}` }]
                    ]
                }
            });
        } catch (error: any) {
            logger.error(`Error fetching vendor stats for ${vendorName}: ${error.message}`);
            await bot.sendMessage(chatId, `❌ Error fetching statistics: ${error.message}`);
        }
    });

    router.registerCallback(/^sales_vendor_pdf:(.+)$/, async (query: TelegramBot.CallbackQuery) => {
        const vendorName = (query.data || '').split(':').pop()!;
        const chatId = query.message!.chat.id;

        try {
            await bot.sendChatAction(chatId, 'upload_document');
            const stats = await getVendorSalesStats(vendorName);

            const pdfData = {
                title: "Vendor Sales Report",
                subtitle: `Vendor: ${vendorName}`,
                summary: [
                    { label: "Total Billed", value: `INR ${stats.totalBilled.toLocaleString()}` },
                    { label: "Total Paid", value: `INR ${stats.totalPaid.toLocaleString()}` },
                    { label: "Amount Remaining", value: `INR ${stats.amountRemaining.toLocaleString()}` },
                    { label: "Total Records", value: stats.totalRecords }
                ],
                sections: [
                    {
                        title: "Sale Records",
                        headers: ["Sr.No", "Mobile", "Sum", "Price", "Date", "Reason"],
                        columnWidths: [40, 80, 40, 70, 70, 170],
                        rows: stats.records.map((r, i) => [
                            i + 1,
                            r.mobile,
                            r.sum,
                            `INR ${r.salePrice.toLocaleString()}`,
                            formatToDDMMYYYY(r.saleDate),
                            r.saleReason || '-'
                        ])
                    },
                    {
                        title: "Payment History",
                        headers: ["Date", "Amount"],
                        columnWidths: [200, 270],
                        rows: (stats as any).payments.map((p: any) => [
                            formatToDDMMYYYY(p.paymentDate),
                            `INR ${p.amount.toLocaleString()}`
                        ])
                    }
                ]
            };

            const buffer = await generatePdfBuffer(pdfData);
            const fileName = `Sales_Report_${vendorName}_${formatToDDMMYYYY(new Date())}.pdf`;

            await bot.sendDocument(chatId, buffer, {
                caption: `📄 Sales Report for *${vendorName}*`,
                parse_mode: 'Markdown'
            }, { filename: fileName, contentType: 'application/pdf' });

        } catch (error: any) {
            logger.error(`Error generating PDF for ${vendorName}: ${error.message}`);
            await bot.sendMessage(chatId, `❌ Error generating PDF: ${error.message}`);
        }
    });

    router.registerCallback(/^sales_vendor_pdf_year:(.+)$/, async (query: TelegramBot.CallbackQuery) => {
        const vendorName = (query.data || '').split(':').pop()!;
        const chatId = query.message!.chat.id;

        const currentYear = new Date().getFullYear();
        const years = [currentYear, currentYear - 1, currentYear - 2];
        
        const keyboard = years.map(year => ([{
            text: `Year ${year}`,
            callback_data: `sales_vendor_pdf_month:${vendorName}:${year}`
        }]));

        await bot.editMessageReplyMarkup({
            inline_keyboard: [
                ...keyboard,
                [{ text: '⬅️ Back', callback_data: `sales_vendor_stat:${vendorName}` }]
            ]
        }, { chat_id: chatId, message_id: query.message!.message_id });
    });

    router.registerCallback(/^sales_vendor_pdf_month:(.+):(\d{4})$/, async (query: TelegramBot.CallbackQuery) => {
        const parts = (query.data || '').split(':');
        const vendorName = parts[1];
        const year = parts[2];
        const chatId = query.message!.chat.id;

        const months = [
            ['Jan', 'Feb', 'Mar'], ['Apr', 'May', 'Jun'],
            ['Jul', 'Aug', 'Sep'], ['Oct', 'Nov', 'Dec']
        ];

        const keyboard = months.map((row, rowIdx) => row.map((m, colIdx) => ({
            text: m,
            callback_data: `sales_vendor_pdf_gen:${vendorName}:${year}:${rowIdx * 3 + colIdx + 1}`
        })));

        await bot.editMessageReplyMarkup({
            inline_keyboard: [
                ...keyboard,
                [{ text: '⬅️ Back', callback_data: `sales_vendor_pdf_year:${vendorName}` }]
            ]
        }, { chat_id: chatId, message_id: query.message!.message_id });
    });

    router.registerCallback(/^sales_vendor_pdf_gen:(.+):(\d{4}):(\d+)$/, async (query: TelegramBot.CallbackQuery) => {
        const parts = (query.data || '').split(':');
        const vendorName = parts[1];
        const year = parseInt(parts[2]);
        const month = parseInt(parts[3]);
        const chatId = query.message!.chat.id;

        try {
            await bot.sendChatAction(chatId, 'upload_document');
            const stats = await getVendorSalesStats(vendorName);

            // Filter records by month and year
            const filteredRecords = stats.records.filter((r: any) => {
                const date = r.saleDate;
                return date.getFullYear() === year && (date.getMonth() + 1) === month;
            });

            if (filteredRecords.length === 0) {
                await bot.answerCallbackQuery(query.id, { text: "⚠️ No sales records found for this period.", show_alert: true });
                return;
            }

            const monthName = format(new Date(year, month - 1), 'MMMM');
            
            // Calculate filtered summary
            const filteredTotalBilled = filteredRecords.reduce((sum: number, r: any) => sum + r.salePrice, 0);
            const filteredTotalPurchase = filteredRecords.reduce((sum: number, r: any) => sum + (r.originalNumberData?.purchasePrice || 0), 0);
            const filteredProfitLoss = filteredTotalBilled - filteredTotalPurchase;
            
            const filteredPayments = (stats as any).payments.filter((p: any) => {
                const date = p.paymentDate;
                return date.getFullYear() === year && (date.getMonth() + 1) === month;
            });
            const filteredTotalPaid = filteredPayments.reduce((sum: number, p: any) => sum + p.amount, 0);

            const pdfData = {
                title: "Monthly Sales Report",
                subtitle: `Vendor: ${vendorName} | Period: ${monthName} ${year}`,
                summary: [
                    { label: "Total Billed (Period)", value: `INR ${filteredTotalBilled.toLocaleString()}` },
                    { label: "Total Paid (Period)", value: `INR ${filteredTotalPaid.toLocaleString()}` },
                    { label: "Total Records", value: filteredRecords.length }
                ],
                sections: [
                    {
                        title: `Sales for ${monthName} ${year}`,
                        headers: ["Sr.No", "Mobile", "Sum", "Price", "Date", "Reason"],
                        columnWidths: [40, 80, 40, 70, 70, 170],
                        rows: filteredRecords.map((r: any, i: number) => [
                            i + 1,
                            r.mobile,
                            r.sum,
                            `INR ${r.salePrice.toLocaleString()}`,
                            formatToDDMMYYYY(r.saleDate),
                            r.saleReason || '-'
                        ])
                    },
                    {
                        title: `Payments for ${monthName} ${year}`,
                        headers: ["Date", "Amount"],
                        columnWidths: [200, 270],
                        rows: filteredPayments.map((p: any) => [
                            formatToDDMMYYYY(p.paymentDate),
                            `INR ${p.amount.toLocaleString()}`
                        ])
                    }
                ]
            };

            const buffer = await generatePdfBuffer(pdfData);
            const fileName = `Sales_Report_${vendorName}_${monthName}_${year}.pdf`;

            await bot.sendDocument(chatId, buffer, {
                caption: `📊 *${monthName} ${year}* Sales Report for *${vendorName}*`,
                parse_mode: 'Markdown'
            }, { filename: fileName, contentType: 'application/pdf' });

            await bot.answerCallbackQuery(query.id);

        } catch (error: any) {
            logger.error(`Error generating monthly PDF for ${vendorName}: ${error.message}`);
            await bot.sendMessage(chatId, `❌ Error generating PDF: ${error.message}`);
        }
    });
}
