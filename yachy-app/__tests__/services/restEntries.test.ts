jest.mock('../../src/services/supabase', () => ({ supabase: {} }));

import { buildHourMarks, checkCompliance, getPastMonths } from '../../src/services/restEntries';

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
});
