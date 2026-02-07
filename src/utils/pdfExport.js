import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

/**
 * Export an edited PDF with OCR text modifications.
 * 
 * @param {string} originalPdfUrl - URL of the original PDF file
 * @param {Object} ocrData - OCR data with page and text block information
 * @param {Object} editedBlocks - Map of block IDs to edited text
 * @param {string} fileName - Output filename
 */
export async function exportEditedPdf(originalPdfUrl, ocrData, editedBlocks, fileName) {
    try {
        // Fetch the original PDF
        const existingPdfBytes = await fetch(originalPdfUrl).then(res => res.arrayBuffer());

        // Load the PDF
        const pdfDoc = await PDFDocument.load(existingPdfBytes);

        // Embed a font for text replacement
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        // Get all pages
        const pages = pdfDoc.getPages();

        // Process each page's edits
        if (ocrData && ocrData.pages) {
            for (const pageOcrData of ocrData.pages) {
                const pageIndex = pageOcrData.page_number - 1;
                if (pageIndex >= 0 && pageIndex < pages.length) {
                    const page = pages[pageIndex];
                    const { width: pageWidth, height: pageHeight } = page.getSize();

                    // Scale factor from OCR dimensions to PDF dimensions
                    const scaleX = pageWidth / (pageOcrData.width * 72 / 150);
                    const scaleY = pageHeight / (pageOcrData.height * 72 / 150);

                    for (const block of pageOcrData.text_blocks) {
                        // Check if this block was edited
                        if (editedBlocks[block.id] && editedBlocks[block.id] !== block.text) {
                            const editedText = editedBlocks[block.id];

                            // Calculate position (PDF coordinates are from bottom-left)
                            const x = block.rect.x * 72 / 150 * scaleX;
                            const y = pageHeight - (block.rect.y + block.rect.height) * 72 / 150 * scaleY;
                            const fontSize = Math.max(8, block.rect.height * 72 / 150 * scaleY * 0.7);

                            // Draw a white rectangle to cover original text
                            page.drawRectangle({
                                x: x - 2,
                                y: y - 2,
                                width: block.rect.width * 72 / 150 * scaleX + 4,
                                height: block.rect.height * 72 / 150 * scaleY + 4,
                                color: rgb(1, 1, 1),
                            });

                            // Draw the new text
                            page.drawText(editedText, {
                                x: x,
                                y: y,
                                size: fontSize,
                                font: font,
                                color: rgb(0, 0, 0),
                            });
                        }
                    }
                }
            }
        }

        // Save the modified PDF
        const pdfBytes = await pdfDoc.save();

        // Create download
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = fileName.replace('.pdf', '_edited.pdf');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        return true;
    } catch (error) {
        console.error('Error exporting PDF:', error);
        throw error;
    }
}

/**
 * Download the original PDF without modifications.
 * 
 * @param {string} pdfUrl - URL of the PDF to download
 * @param {string} fileName - Output filename
 */
export async function downloadOriginalPdf(pdfUrl, fileName) {
    try {
        const response = await fetch(pdfUrl);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        return true;
    } catch (error) {
        console.error('Error downloading PDF:', error);
        throw error;
    }
}
