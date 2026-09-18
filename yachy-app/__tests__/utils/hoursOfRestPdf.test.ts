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
