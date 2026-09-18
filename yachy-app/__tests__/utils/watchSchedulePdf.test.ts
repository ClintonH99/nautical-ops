import type { PublishedWatchTimetable } from '../../src/services/watchKeeping';
import {
  buildWatchSchedulePdfHtml,
  WATCH_SCHEDULE_ROWS_PER_PAGE,
} from '../../src/utils/watchSchedulePdf';

function scheduleWithSlots(slotCount: number): PublishedWatchTimetable {
  return {
    id: 'schedule-1',
    vesselId: 'vessel-1',
    watchTitle: '<script>alert("schedule")</script> & Delivery',
    startTime: '06:00 <start>',
    startLocation: 'Port <Alpha>',
    destination: 'Cove & Marina',
    forDate: '2026-09-09',
    createdAt: '2026-09-01T00:00:00.000Z',
    slots: Array.from({ length: slotCount }, (_, index) => ({
      crewId: `crew-${index}`,
      crewName: index === 0 ? '<img src=x onerror=alert(1)>' : `Crew ${index + 1}`,
      crewPosition: index === 0 ? 'Captain & OOW' : 'Deckhand',
      startTimeStr: `${String((index * 2) % 24).padStart(2, '0')}:00`,
      endTimeStr: `${String((index * 2 + 2) % 24).padStart(2, '0')}:00`,
      durationHours: 2,
      startDate: '2026-09-09',
      endDate: '2026-09-09',
    })),
  };
}

describe('Watch Schedule PDF HTML', () => {
  it('builds deterministic pages with repeated headers and safe user content', () => {
    const html = buildWatchSchedulePdfHtml([scheduleWithSlots(WATCH_SCHEDULE_ROWS_PER_PAGE + 1)]);

    expect(html.match(/<section class="page">/g)).toHaveLength(2);
    expect(html.match(/<h1>Watch Schedule<\/h1>/g)).toHaveLength(2);
    expect(html.match(/<th class="col-position">Position<\/th>/g)).toHaveLength(2);
    expect(html).toContain('Page 1 of 2');
    expect(html).toContain('Page 2 of 2');
    expect(html).toContain('table { width: 100%');
    expect(html).toContain('tbody tr { break-inside: avoid; page-break-inside: avoid; }');

    expect(html).toContain(
      '&lt;script&gt;alert(&quot;schedule&quot;)&lt;/script&gt; &amp; Delivery'
    );
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Captain &amp; OOW');
    expect(html).toContain('Port &lt;Alpha&gt;');
    expect(html).toContain('Cove &amp; Marina');
    expect(html).toContain('06:00 &lt;start&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
  });

  it('keeps long 33-row schedules within three conservative page chunks', () => {
    const schedule = scheduleWithSlots(33);
    schedule.watchTitle =
      'Extended delivery watch between Port Moresby and a deliberately long destination';
    schedule.startLocation = `${schedule.watchTitle} - departure berth`;
    schedule.destination = `${schedule.watchTitle} - arrival berth`;
    schedule.slots = schedule.slots.map((slot, index) => ({
      ...slot,
      crewName: `Crew member ${index + 1} with a deliberately long operational display name`,
      crewPosition: 'Officer of the Watch and Safety Coordinator',
    }));

    const html = buildWatchSchedulePdfHtml([schedule]);

    expect(html.match(/<section class="page">/g)).toHaveLength(3);
    expect(html.match(/<h1>Watch Schedule<\/h1>/g)).toHaveLength(3);
    expect(html).toContain('Page 3 of 3');
  });
});
