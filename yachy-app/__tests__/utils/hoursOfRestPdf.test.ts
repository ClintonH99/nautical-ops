jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('expo-print', () => ({}));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-asset', () => ({ Asset: { fromModule: jest.fn() } }));

import { PdfMonthData } from '../../src/services/restEntries';
import { buildHoursOfRestPdfHtml } from '../../src/utils/hoursOfRestPdf';

function baseData(): PdfMonthData {
  return {
    seafarerName: 'Test Crew',
    rank: 'Deckhand',
    vesselName: 'Test Vessel',
    vesselImoNumber: '1234567',
    monthLabel: 'September 2026',
    days: [],
  };
}

describe('Hours of Rest PDF', () => {
  it('keeps the compact metadata and inline logo header in the repeating table head', () => {
    const html = buildHoursOfRestPdfHtml(baseData(), '', 'sample-logo');
    const header = html.split('<thead>')[1].split('</thead>')[0];
    expect(header).toContain('NAUTICAL OPS');
    expect(header).toContain('HOURS OF WORK AND REST');
    expect(header).toContain('data:image/png;base64,sample-logo');
    for (const label of ['Seafarer', 'Rank', 'Month', 'IMO', 'Vessel'])
      expect(header).toContain(label);
    expect(html).not.toContain('<table class="info">');
  });
  it('keeps all 31 days and every daily value in one compact landscape table', () => {
    const html = buildHoursOfRestPdfHtml({
      ...baseData(),
      days: Array.from({ length: 31 }, (_, i) => ({
        date: `2026-10-${String(i + 1).padStart(2, '0')}`,
        hasRecord: true,
        hourMarks: new Array(24).fill(false),
        restHoursToday: '16:00',
        restIn24h: '16:00',
        restIn7d: '112:00',
        comment: 'Routine watch',
      })),
    });
    expect(html).toContain('size:A4 landscape');
    expect(html.match(/<table class="grid"/g)).toHaveLength(1);
    expect(html).not.toContain('grid summary');
    const rows = html.match(/<tr><td class="datecell">[\s\S]*?<\/tr>/g)!;
    expect(rows).toHaveLength(31);
    for (const row of rows) {
      expect(row.match(/<td\b/g)).toHaveLength(29);
      expect(row).toContain('Routine watch');
      expect(row).toContain('112:00');
    }
    expect(html).toContain('Signature of Master');
    expect(html).toContain('Signature of Seafarer');
  });

  it('renders a missing record as unknown rather than zero hours of rest', () => {
    const html = buildHoursOfRestPdfHtml({
      ...baseData(),
      days: [
        {
          date: '2026-09-18',
          hasRecord: false,
          hourMarks: new Array(24).fill(false),
          restHoursToday: '',
          restIn24h: '',
          restIn7d: '',
          comment: '',
        },
      ],
    });

    expect(html).toContain('<tr class="missing-record">');
    expect(html).toContain('No rest record');
    expect(html).toContain('<td class="hourcell unknown">&mdash;</td>');
    expect(html).toContain('&mdash; = no rest record / unknown');
    expect(html).not.toContain('00:00');
  });

  it('escapes recorded row comments before adding them to HTML', () => {
    const html = buildHoursOfRestPdfHtml({
      ...baseData(),
      days: [
        {
          date: '2026-09-18',
          hasRecord: true,
          hourMarks: new Array(24).fill(false),
          restHoursToday: '12:00',
          restIn24h: '12:00',
          restIn7d: '84:00',
          comment: '<script>alert("unsafe")</script> & notes',
        },
      ],
    });

    expect(html).toContain('&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt; &amp; notes');
    expect(html).not.toContain('<script>alert("unsafe")</script>');
  });
});
