jest.mock('../../src/services/supabase', () => ({ supabase: {} }));

import {
  buildHourMarks,
  buildPdfDayRow,
  checkCompliance,
  checkRollingCompliance,
  getPastMonths,
} from '../../src/services/restEntries';

describe('Hours of Rest history months', () => {
  it('shows no history during the month the account was created', () => {
    expect(getPastMonths('2026-09-09T12:00:00.000Z', new Date(2026, 8, 30))).toEqual([]);
  });

  it('moves the account creation month into history on the first day of the next month', () => {
    expect(getPastMonths('2026-09-09T12:00:00.000Z', new Date(2026, 9, 1))).toEqual([
      { year: 2026, month: 9, label: 'September 2026' },
    ]);
  });

  it('never includes months before the account was created', () => {
    expect(getPastMonths('2026-09-09T12:00:00.000Z', new Date(2026, 10, 1))).toEqual([
      { year: 2026, month: 10, label: 'October 2026' },
      { year: 2026, month: 9, label: 'September 2026' },
    ]);
  });
});

describe('truthful non-compliant records', () => {
  it('returns an explicit non-compliant result when a crew member has no rest history', () => {
    expect(checkRollingCompliance('2026-09-18', [])).toEqual({
      minRestIn24h: 0,
      minRestIn7Days: 0,
      maxGapBetweenRestHours: 0,
      compliant: false,
      violations: ['No rest periods recorded'],
    });
  });

  it('reports less than ten hours as non-compliant without throwing an error', () => {
    expect(checkCompliance([{ start: '00:00', end: '06:00' }])).toEqual({
      compliant: false,
      totalRestHours: 6,
      violations: ['Only 6h rest today, below the 10h minimum'],
    });
  });

  it('marks an imported watch as work even when no manual work period was entered', () => {
    const marks = buildHourMarks(null, null, null, null, [
      {
        timetableId: 'watch-1',
        watchTitle: 'Delivery Watch',
        date: '2026-04-03',
        startTime: '02:00',
        endTime: '06:00',
      },
    ]);

    expect(marks.slice(0, 8)).toEqual([false, false, true, true, true, true, false, false]);
  });

  it('keeps a missing PDF day explicitly unknown while preserving known watch work', () => {
    const row = buildPdfDayRow(
      '2026-09-18',
      undefined,
      [
        {
          timetableId: 'watch-1',
          watchTitle: 'Night Watch',
          date: '2026-09-18',
          startTime: '02:00',
          endTime: '04:00',
        },
      ],
      []
    );

    expect(row).toMatchObject({
      date: '2026-09-18',
      hasRecord: false,
      restHoursToday: '',
      restIn24h: '',
      restIn7d: '',
      comment: '',
    });
    expect(row.hourMarks.slice(0, 6)).toEqual([false, false, true, true, false, false]);
  });

  it('retains zero values only when a real rest record exists', () => {
    const row = buildPdfDayRow(
      '2026-09-18',
      {
        rest_periods: [],
        work_start: null,
        work_end: null,
        lunch_start: null,
        lunch_end: null,
        comment: 'Entered, but no rest recorded',
      },
      [],
      [{ date: '2026-09-18', rest_periods: [] }]
    );

    expect(row).toMatchObject({
      hasRecord: true,
      restHoursToday: '00:00',
      restIn24h: '00:00',
      comment: 'Entered, but no rest recorded',
    });
  });
});
