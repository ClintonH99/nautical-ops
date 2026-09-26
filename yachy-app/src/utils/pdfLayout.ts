/** Shared print geometry. Sea Miles and Hours of Rest use landscape. */
export type PdfOrientation = 'portrait' | 'landscape';

export const PDF_LAYOUT = {
  portrait: { width: 595.28, height: 841.89 },
  landscape: { width: 841.89, height: 595.28 },
  margins: { top: 90, right: 36, bottom: 32, left: 36 },
  brandSize: 12,
  titleSize: 12,
  logoSize: 26,
  pageNumberSize: 8,
} as const;

export function pdfPrintOptions(orientation: PdfOrientation = 'portrait', headerInContent = false) {
  return {
    ...PDF_LAYOUT[orientation],
    margins: { ...PDF_LAYOUT.margins, top: headerInContent ? 24 : PDF_LAYOUT.margins.top },
  };
}

/** Let the print engine measure real content, rather than guessing row counts.
 * iOS reserves margins using UIPrintPageRenderer; Android uses CSS @page.
 * Using BOTH on iOS causes inset/scaling differences, so there is one owner.
 */
export function preparePdfHtml(
  html: string,
  title: string,
  orientation: PdfOrientation = 'portrait',
  nativeMargins = false,
  headerInContent = false
): string {
  const size = PDF_LAYOUT[orientation];
  const { top, right, bottom, left } = pdfPrintOptions(orientation, headerInContent).margins;
  const styles = `<style id="nautical-pdf-standard">
    @page { size: ${size.width}pt ${size.height}pt; margin: ${nativeMargins ? '0' : `${top}pt ${right}pt ${bottom}pt ${left}pt`}; }
    html, body { width: auto !important; height: auto !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; background: white; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { font-family: Arial, sans-serif; overflow-wrap: anywhere; }
    .page, .card, .board, .section, .station, .receipt-card {
      width: auto !important; height: auto !important; min-height: 0 !important;
      overflow: visible !important; break-inside: auto !important; page-break-inside: auto !important;
      break-before: auto !important; page-break-before: auto !important;
      break-after: auto !important; page-break-after: auto !important;
    }
    .page { padding: 0 !important; margin: 0 0 12pt !important; }
    .page:last-child { margin-bottom: 0 !important; }
    table { width: 100%; max-width: 100%; table-layout: fixed; }
    thead { display: table-header-group; }
    tfoot { display: table-row-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th, td { overflow-wrap: anywhere; word-wrap: break-word; }
    h2, h3, .card-header, .meta { break-after: avoid; page-break-after: avoid; }
    p, li { orphans: 2; widows: 2; }
    img { max-width: 100%; }
  </style>`;
  // Builders own their content; the shared PDF stamp owns the document title.
  // Keep user-entered board names as content headings, never silently discard them.
  const normalizedTitle = title.toUpperCase();
  const withoutTitle = html.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_, heading: string) =>
    heading.trim().replace(/&amp;/gi, '&').toUpperCase() === normalizedTitle
      ? ''
      : `<h2>${heading}</h2>`
  );
  return withoutTitle.replace(/<\/head>/i, `${styles}</head>`);
}
