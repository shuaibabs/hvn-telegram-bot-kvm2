import PDFDocument from 'pdfkit';
import { format } from 'date-fns';

export type PdfReportData = {
    title: string;
    subtitle?: string;
    summary: { label: string; value: string | number }[];
    headers: string[];
    rows: (string | number)[][];
};

export async function generatePdfBuffer(data: PdfReportData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50 });
            const chunks: any[] = [];

            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));

            // Add Header
            doc.fillColor('#2c3e50')
               .fontSize(20)
               .text(data.title.toUpperCase(), { align: 'left' });
            
            doc.fontSize(10)
               .fillColor('#7f8c8d')
               .text(`Generated on: ${format(new Date(), 'PPP p')}`, { align: 'left' })
               .moveDown(1);

            if (data.subtitle) {
                doc.fontSize(12)
                   .fillColor('#2c3e50')
                   .text(data.subtitle)
                   .moveDown(0.5);
            }

            // Summary Section
            doc.fontSize(11)
               .fillColor('#000000');
            
            data.summary.forEach(item => {
                doc.text(`${item.label}: ${item.value}`);
            });

            doc.moveDown(2);

            // Table
            const tableTop = doc.y;
            const columnWidths = [40, 100, 50, 120, 80, 80]; // Sr.No, Mobile, Sum, Sold To, Price, Date
            const headers = data.headers;

            // Draw Table Headers
            let currentX = 50;
            doc.fontSize(10).fillColor('#ffffff');
            
            // Header Background
            doc.rect(50, tableTop - 5, 470, 20).fill('#2980b9');
            
            headers.forEach((header, i) => {
                doc.fillColor('#ffffff')
                   .text(header, currentX, tableTop, { width: columnWidths[i], align: 'left' });
                currentX += columnWidths[i];
            });

            doc.moveDown(1.5);
            
            // Draw Table Rows
            doc.fillColor('#000000');
            data.rows.forEach((row, rowIndex) => {
                const y = doc.y;
                let x = 50;
                
                // Zebra stripes
                if (rowIndex % 2 === 1) {
                    doc.save()
                       .rect(50, y - 5, 470, 20)
                       .fill('#f5f5f5')
                       .restore();
                }

                row.forEach((cell, i) => {
                    doc.text(String(cell), x, y, { width: columnWidths[i], align: 'left' });
                    x += columnWidths[i];
                });
                doc.moveDown(0.8);
                
                // Add page if needed
                if (doc.y > 700) {
                    doc.addPage();
                }
            });

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}
