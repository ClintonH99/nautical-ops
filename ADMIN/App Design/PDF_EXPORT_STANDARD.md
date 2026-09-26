# PDF export standard

Approved September 2026. Applies to every existing PDF export, including exports
from create/edit screens. Does not change selected records, permissions, saved data,
calculations or approval/signature requirements.

- A4 portrait for all documents except **Personal Sea Service Record** and **Hours of Work and Rest**, which are A4 landscape.
- On every page, place the navy vessel logo beside **NAUTICAL OPS** on one line, with the document title directly below. Centre the combined logo/wordmark row and the title on the same page axis. Do not stack the logo on a separate line.
- Hours of Rest retains its compact in-content header: the same logo/wordmark row and title, with Seafarer/Rank/Month on the left and IMO/Vessel on the right at the same height. This header repeats with the table on overflow pages; the shared PDF layer still owns page numbers.
- Compact approved header: 12pt bold brand, 26pt logo, 12pt bold title. Use the navy vessel mark without a square tile, border or gold recolouring.
- Reserve 72pt above content, 36pt left/right and 32pt below content. The 26pt logo and wordmark have a 7pt gap; the title sits below the row.
- Hours of Rest reserves 24pt above its in-content header instead of a second 72pt header space.
- Use the actual rendered PDF page count. A single-page export has no page number.
- Multi-page exports have **Page X of Y** in 8pt light grey at bottom right on every page.
- Content determines pagination. No fixed page-height containers, arbitrary row-count chunks, forced new pages for each selected record or trailing page breaks.
- Repeat table column headings when tables overflow. Keep normal rows intact where possible, but allow very long content to flow; never hide overflow or truncate saved text to fit.
- Wide layouts must wrap within their selected page width. Hours of Rest uses the original compact single landscape table: date, all 24 hourly marks, rest totals, comments and office totals in the same row. A normal full month with signatures fits one page; long content may naturally overflow, without clipping or removing information.
- New/edited Hours of Rest comments have a live counter and a 20-character cap (spaces included). The ~171px comment width at 8px Arial fits 20 wide fallback glyphs with a rendering allowance. Replace input line breaks/tabs with spaces. Unchanged historical comments remain intact; do not truncate them in exports. Legacy long text or unusually long metadata may still overflow rather than lose information.
- Fuel Receipts exports use compact outlined cards: Location / Date / Time, then a light-grey row for Fuel received / Price per unit / Total purchase, followed by Comment. Keep labels and values aligned, retain each receipt's stored quantity unit, price unit, currency and ship-local date/time. No tank allocations, logged-by footer, vessel metadata, combined totals, receipt count or coloured side border. This applies only to the PDF; in-app receipts and saved allocation data remain unchanged.

Implementation: `pdfLayout.ts` owns geometry and flow rules; `standardPdf.ts` is the
only native `expo-print` entry point; `pdfBranding.ts` stamps branding and page
numbers after pagination. Exporters retain their existing content and sharing flows.

Validation: short and long fixtures for every exporter, actual rendered page counts,
header/footer text on every page, portrait/landscape checks and visual PDF review.
