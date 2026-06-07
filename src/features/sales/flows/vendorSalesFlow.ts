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

            if (stats.totalRecords === 0) {
                await bot.answerCallbackQuery(query.id, { text: "⚠️ No sales records found for this vendor.", show_alert: true });
                return;
            }

            const monthName = format(new Date(year, month - 1), 'MMMM');
            // Period bounds for the selected month (statement period).
            const periodStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
            const periodEnd = new Date(year, month, 0, 23, 59, 59, 999);

            const recs: any[] = stats.records;
            const pays: any[] = (stats as any).payments;

            const before = (d: Date) => d < periodStart;
            const after = (d: Date) => d > periodEnd;
            const inPeriod = (d: Date) => d >= periodStart && d <= periodEnd;

            // Split sales & payments into Past / Period / Future buckets.
            const pastRecs = recs.filter(r => before(r.saleDate));
            const periodRecs = recs.filter(r => inPeriod(r.saleDate));
            const futureRecs = recs.filter(r => after(r.saleDate));
            const pastPays = pays.filter(p => before(p.paymentDate));
            const periodPays = pays.filter(p => inPeriod(p.paymentDate));
            const futurePays = pays.filter(p => after(p.paymentDate));

            const sumBill = (a: any[]) => a.reduce((s, r) => s + (r.salePrice || 0), 0);
            const sumPay = (a: any[]) => a.reduce((s, p) => s + (p.amount || 0), 0);

            const openingBilled = sumBill(pastRecs);
            const openingPaid = sumPay(pastPays);
            const openingPending = openingBilled - openingPaid;        // carried forward from before the period
            const periodBilled = sumBill(periodRecs);
            const periodPaid = sumPay(periodPays);
            const periodPending = periodBilled - periodPaid;
            const closingPending = openingPending + periodPending;     // pending as of end of period
            const futureBilled = sumBill(futureRecs);
            const futurePaid = sumPay(futurePays);

            const inr = (n: number) => `INR ${n.toLocaleString()}`;

            const summary: { label: string; value: string | number }[] = [
                { label: "Period", value: `${monthName} ${year}` },
                { label: "Opening Balance (Pending b/f)", value: inr(openingPending) },
                { label: "Period - Total Billed", value: inr(periodBilled) },
                { label: "Period - Total Paid", value: inr(periodPaid) },
                { label: "Period - Pending", value: inr(periodPending) },
                { label: `Closing Balance (Pending as of ${formatToDDMMYYYY(periodEnd)})`, value: inr(closingPending) },
            ];
            if (futureBilled > 0 || futurePaid > 0) {
                summary.push({ label: "After Period - Billed", value: inr(futureBilled) });
                summary.push({ label: "After Period - Paid", value: inr(futurePaid) });
            }
            summary.push(
                { label: "Grand Total - Billed (All Time)", value: inr(stats.totalBilled) },
                { label: "Grand Total - Paid (All Time)", value: inr(stats.totalPaid) },
                { label: "Grand Total - Pending (All Time)", value: inr(stats.amountRemaining) },
                { label: "Records in Period", value: periodRecs.length },
            );

            const saleHeaders = ["Sr.No", "Mobile", "Sum", "Price", "Date", "Reason"];
            const saleWidths = [40, 80, 40, 70, 70, 170];
            const payHeaders = ["Date", "Amount", "Notes"];
            const payWidths = [120, 120, 230];

            const saleRows = (arr: any[]) => arr
                .slice()
                .sort((a, b) => b.saleDate.getTime() - a.saleDate.getTime())
                .map((r, i) => [i + 1, r.mobile, r.sum, inr(r.salePrice), formatToDDMMYYYY(r.saleDate), r.saleReason || '-']);
            const payRows = (arr: any[]) => arr
                .slice()
                .sort((a, b) => b.paymentDate.getTime() - a.paymentDate.getTime())
                .map(p => [formatToDDMMYYYY(p.paymentDate), inr(p.amount), p.notes || '-']);

            const periodSaleRows = saleRows(periodRecs);
            const sections: any[] = [{
                title: `Sales - ${monthName} ${year}`,
                headers: saleHeaders,
                columnWidths: saleWidths,
                rows: periodSaleRows.length ? periodSaleRows : [['-', 'No sales in this period', '', '', '', '']],
            }];
            if (periodPays.length) sections.push({ title: `Payments - ${monthName} ${year}`, headers: payHeaders, columnWidths: payWidths, rows: payRows(periodPays) });
            if (pastRecs.length) sections.push({ title: `Past Sales (before ${monthName} ${year})`, headers: saleHeaders, columnWidths: saleWidths, rows: saleRows(pastRecs) });
            if (pastPays.length) sections.push({ title: `Past Payments (before period)`, headers: payHeaders, columnWidths: payWidths, rows: payRows(pastPays) });
            if (futureRecs.length) sections.push({ title: `Future Sales (after ${monthName} ${year})`, headers: saleHeaders, columnWidths: saleWidths, rows: saleRows(futureRecs) });
            if (futurePays.length) sections.push({ title: `Future Payments (after period)`, headers: payHeaders, columnWidths: payWidths, rows: payRows(futurePays) });

            const pdfData = {
                title: "Vendor Account Statement",
                subtitle: `Vendor: ${vendorName} | Period: ${monthName} ${year}`,
                summary,
                sections,
            };

            const buffer = await generatePdfBuffer(pdfData);
            const fileName = `Sales_Statement_${vendorName}_${monthName}_${year}.pdf`;

            await bot.sendDocument(chatId, buffer, {
                caption: `📊 *${monthName} ${year}* Account Statement for *${vendorName}*`,
                parse_mode: 'Markdown'
            }, { filename: fileName, contentType: 'application/pdf' });

            await bot.answerCallbackQuery(query.id);

        } catch (error: any) {
            logger.error(`Error generating monthly PDF for ${vendorName}: ${error.message}`);
            await bot.sendMessage(chatId, `❌ Error generating PDF: ${error.message}`);
        }
    });
}
