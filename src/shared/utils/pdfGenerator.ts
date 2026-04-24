import PDFDocument from 'pdfkit';
import { format } from 'date-fns';

export type PdfSection = {
    title: string;
    headers: string[];
    rows: (string | number)[][];
    columnWidths?: number[];
};

export type PdfReportData = {
    title: string;
    subtitle?: string;
    summary: { label: string; value: string | number }[];
    headers?: string[]; // Deprecated, use sections
    rows?: (string | number)[][]; // Deprecated, use sections
    sections?: PdfSection[];
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

            // Prepare sections
            const sections: PdfSection[] = data.sections || [];
            if (data.headers && data.rows) {
                sections.unshift({
                    title: "Records",
                    headers: data.headers,
                    rows: data.rows
                });
            }

            // Render Sections
            sections.forEach((section, sIdx) => {
                if (doc.y > 650) doc.addPage();

                if (section.title) {
                    doc.fontSize(14).fillColor('#2c3e50').text(section.title.toUpperCase()).moveDown(0.5);
                }

                const tableTop = doc.y;
                const headers = section.headers;
                const columnWidths = section.columnWidths || headers.map(() => 470 / headers.length);
                
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
                section.rows.forEach((row, rowIndex) => {
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
                        // Redraw headers on new page? (Optional improvement, keeping it simple for now)
                    }
                });

                doc.moveDown(2);
            });

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}
