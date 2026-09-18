import {
  clampDateOnly,
  daysInMonth,
  doesMonthOverlapBounds,
  getMonthDayGrid,
  getPickerYearRow,
  getPickerYears,
  isDateWithinBounds,
  isLeapYear,
  localToday,
  parseDateOnly,
} from '../../src/utils/dateOnlyPicker';

describe('date-only picker helpers', () => {
  it('handles leap years and month lengths', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('accepts only real YYYY-MM-DD values', () => {
    expect(parseDateOnly('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
    expect(parseDateOnly('2025-02-29')).toBeNull();
    expect(parseDateOnly('2026-13-01')).toBeNull();
    expect(parseDateOnly('2026-1-1')).toBeNull();
  });

  it('clamps values to inclusive bounds without UTC conversion', () => {
    expect(clampDateOnly('2026-01-01', '2026-03-15', '2026-08-20')).toBe('2026-03-15');
    expect(clampDateOnly('2026-12-01', '2026-03-15', '2026-08-20')).toBe('2026-08-20');
    expect(clampDateOnly('2026-06-18', '2026-03-15', '2026-08-20')).toBe('2026-06-18');
    expect(isDateWithinBounds('2026-03-15', '2026-03-15', '2026-08-20')).toBe(true);
    expect(isDateWithinBounds('2026-08-21', '2026-03-15', '2026-08-20')).toBe(false);
  });

  it('uses local current-date parts and creates a Monday-first grid', () => {
    expect(localToday(new Date(2026, 8, 18, 23, 59))).toBe('2026-09-18');
    const grid = getMonthDayGrid(2026, 9);
    expect(grid.slice(0, 2)).toEqual([null, 1]);
    expect(grid).toHaveLength(31);
  });

  it('honours bounded year lists', () => {
    expect(getPickerYears(2030, '2029-06-01', '2031-12-31')).toEqual([2029, 2030, 2031]);
  });

  it('locates the selected year row so the picker can open at that year', () => {
    const years = getPickerYears(2026);
    expect(years[50]).toBe(2026);
    expect(getPickerYearRow(years, 2026)).toBe(16);
    expect(getPickerYearRow(years, 2026, 1)).toBe(50);
    expect(getPickerYearRow(years, 1900)).toBe(0);
  });

  it('keeps a month enabled whenever its date range overlaps the bounds', () => {
    expect(doesMonthOverlapBounds(2026, 9, '2026-09-10', '2026-09-20')).toBe(true);
    expect(doesMonthOverlapBounds(2026, 8, '2026-09-10', '2026-09-20')).toBe(false);
    expect(doesMonthOverlapBounds(2026, 10, '2026-09-10', '2026-09-20')).toBe(false);
    expect(doesMonthOverlapBounds(2026, 9, '2026-09-30')).toBe(true);
    expect(doesMonthOverlapBounds(2026, 9, undefined, '2026-09-01')).toBe(true);
  });
});
