import { PDF_LAYOUT } from './pdfLayout';

/** Stamp the actual rendered pages, so headers and numbering cannot add pages. */
export async function brandPdf(
  source: string | Uint8Array,
  title: string,
  logo: string | Uint8Array,
  headerInContent = false
): Promise<string> {
  // Load the PDF engine only during an export, not while navigating the app.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib') as typeof import('pdf-lib');
  const document = await PDFDocument.load(source);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const image = await document.embedPng(logo);
  const pages = document.getPages();
  const navy = rgb(0.055, 0.13, 0.27);
  const grey = rgb(0.65, 0.67, 0.71);
  const { brandSize, titleSize, logoSize, pageNumberSize, margins } = PDF_LAYOUT;
  const wordmark = 'NAUTICAL OPS';
  const heading = title.toUpperCase();
  const wordmarkWidth = bold.widthOfTextAtSize(wordmark, brandSize);

  pages.forEach((page, index) => {
    const { width, height } = page.getSize();
    if (!headerInContent) {
      // Each header element has its own centre on the page's vertical axis.
      // Keep the stack within the existing 90pt header reservation.
      page.drawImage(image, {
        x: (width - logoSize) / 2,
        y: height - 40,
        width: logoSize,
        height: logoSize,
      });
      page.drawText(wordmark, {
        x: (width - wordmarkWidth) / 2,
        y: height - 56,
        size: brandSize,
        font: bold,
        color: navy,
      });
      const size = Math.min(
        titleSize,
        (titleSize * (width - margins.left - margins.right)) /
          bold.widthOfTextAtSize(heading, titleSize)
      );
      page.drawText(heading, {
        x: (width - bold.widthOfTextAtSize(heading, size)) / 2,
        y: height - 74,
        size,
        font: bold,
        color: navy,
      });
    }
    if (pages.length > 1) {
      const label = `Page ${index + 1} of ${pages.length}`;
      page.drawText(label, {
        x: width - margins.right - regular.widthOfTextAtSize(label, pageNumberSize),
        y: 17,
        size: pageNumberSize,
        font: regular,
        color: grey,
      });
    }
  });
  document.setTitle(title);
  document.setCreator('Nautical Ops');
  return document.saveAsBase64();
}
