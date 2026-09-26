# PDF export standard

Approved September 2026. Applies to every existing PDF export, including exports
from create/edit screens. Does not change selected records, permissions, saved data,
calculations or approval/signature requirements.

- A4 portrait for all documents except **Personal Sea Service Record** and **Hours of Work and Rest**, which are A4 landscape.
- On every page, stack the navy vessel logo above **NAUTICAL OPS**, then the document title beneath it. Centre each element independently on the same vertical page axis, not as a side-by-side logo/wordmark group.
- Hours of Rest uses its approved compact exception: logo beside **NAUTICAL OPS** on one centred line, title below, Seafarer/Rank/Month on the left and IMO/Vessel on the right at the same height. This header repeats with the table on overflow pages; the shared PDF layer still owns page numbers.
- Compact approved header: 12pt bold brand, 26pt logo, 12pt bold title. Use the navy vessel mark without a square tile, border or gold recolouring.
- Reserve 90pt above content, 36pt left/right and 32pt below content.
- Hours of Rest reserves 24pt above its in-content header instead of a second 90pt header space.
- Use the actual rendered PDF page count. A single-page export has no page number.
- Multi-page exports have **Page X of Y** in 8pt light grey at bottom right on every page.
- Content determines pagination. No fixed page-height containers, arbitrary row-count chunks, forced new pages for each selected record or trailing page breaks.
- Repeat table column headings when tables overflow. Keep normal rows intact where possible, but allow very long content to flow; never hide overflow or truncate saved text to fit.
- Wide layouts must wrap within their selected page width. Hours of Rest uses the original compact single landscape table: date, all 24 hourly marks, rest totals, comments and office totals in the same row. A normal full month with signatures fits one page; long content may naturally overflow, without clipping or removing information.
- New/edited Hours of Rest comments have a live counter and a 20-character cap (spaces included). The ~171px comment width at 8px Arial fits 20 wide fallback glyphs with a rendering allowance. Replace input line breaks/tabs with spaces. Unchanged historical comments remain intact; do not truncate them in exports. Legacy long text or unusually long metadata may still overflow rather than lose information.

Implementation: `pdfLayout.ts` owns geometry and flow rules; `standardPdf.ts` is the
only native `expo-print` entry point; `pdfBranding.ts` stamps branding and page
numbers after pagination. Exporters retain their existing content and sharing flows.

Validation: short and long fixtures for every exporter, actual rendered page counts,
header/footer text on every page, portrait/landscape checks and visual PDF review.
