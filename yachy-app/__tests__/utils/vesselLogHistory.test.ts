import {
  createdInLogMonth,
  isLogMonth,
  logMonth,
  logMonthBounds,
  logMonthLabel,
  vesselHistoryMonths,
} from '../../src/utils/vesselLogHistory';

describe('shared vessel log history', () => {
  it('starts at vessel creation, including empty months, newest first', () => {
    expect(vesselHistoryMonths('2025-11-20T12:00:00Z', '2026-03')).toEqual([
      '2026-02',
      '2026-01',
      '2025-12',
      '2025-11',
    ]);
  });
  it('has no history before creation, for the current month, or in the future', () => {
    expect(vesselHistoryMonths('2026-09-25T12:00:00Z', '2026-09')).toEqual([]);
    expect(vesselHistoryMonths('2026-10-25T12:00:00Z', '2026-09')).toEqual([]);
    expect(vesselHistoryMonths('invalid', '2026-09')).toEqual([]);
  });
  it('uses identical creation-month boundaries for all crew time zones', () => {
    expect(logMonth(new Date('2026-10-01T02:00:00+10:00'))).toBe('2026-09');
    expect(createdInLogMonth('2026-09-30T23:59:59.999Z', '2026-09')).toBe(true);
    expect(createdInLogMonth('2026-10-01T00:00:00Z', '2026-09')).toBe(false);
    expect(createdInLogMonth('bad', '2026-09')).toBe(false);
  });
  it('handles year rollover and leap years with exclusive upper bounds', () => {
    expect(logMonthBounds('2026-12')).toEqual({
      start: '2026-12-01T00:00:00.000Z',
      end: '2027-01-01T00:00:00.000Z',
    });
    expect(logMonthBounds('2028-02').end).toBe('2028-03-01T00:00:00.000Z');
    expect(logMonthLabel('2026-09')).toBe('September 2026');
    expect(logMonthLabel('2026-09', false)).toBe('September');
    expect(isLogMonth('2026-13')).toBe(false);
    expect(() => logMonthBounds('2026-00')).toThrow('Invalid log month');
  });
});
