/**
 * Local-date helpers for the shared Year → Month → Day picker.
 *
 * Date-only values deliberately stay as YYYY-MM-DD. Constructing a Date from
 * that string directly treats it as UTC in JavaScript, which can shift the
 * calendar day for vessels west of UTC.
 */

export interface DateOnlyParts {
  year: number;
  month: number; // 1-12
  day: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12 || !Number.isInteger(year) || !Number.isInteger(month)) return 0;
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function parseDateOnly(value: string | null | undefined): DateOnlyParts | null {
  if (!value) return null;
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return day >= 1 && day <= daysInMonth(year, month) ? { year, month, day } : null;
}

export function dateOnlyToString({ year, month, day }: DateOnlyParts): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function localToday(now: Date = new Date()): string {
  return dateOnlyToString({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  });
}

/** Clamp a valid ISO date to inclusive date-only bounds. */
export function clampDateOnly(value: string, minimumDate?: string, maximumDate?: string): string {
  const parsed = parseDateOnly(value);
  if (!parsed) throw new Error(`Invalid date-only value: ${value}`);
  const min = parseDateOnly(minimumDate);
  const max = parseDateOnly(maximumDate);
  const normalized = dateOnlyToString(parsed);
  if (min && normalized < dateOnlyToString(min)) return dateOnlyToString(min);
  if (max && normalized > dateOnlyToString(max)) return dateOnlyToString(max);
  return normalized;
}

export function getPickerYears(
  selectedYear: number,
  minimumDate?: string,
  maximumDate?: string,
  span = 50
): number[] {
  const min = parseDateOnly(minimumDate)?.year;
  const max = parseDateOnly(maximumDate)?.year;
  const start = min ?? selectedYear - span;
  const end = max ?? selectedYear + span;
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
}

/** Return the zero-based grid row containing the selected year. */
export function getPickerYearRow(
  years: readonly number[],
  selectedYear: number,
  columnCount = 3
): number {
  const selectedIndex = years.indexOf(selectedYear);
  if (selectedIndex < 0) return 0;
  return Math.floor(selectedIndex / Math.max(1, Math.floor(columnCount)));
}

/** Whether any day in a calendar month falls inside the inclusive bounds. */
export function doesMonthOverlapBounds(
  year: number,
  month: number,
  minimumDate?: string,
  maximumDate?: string
): boolean {
  const monthLength = daysInMonth(year, month);
  if (monthLength === 0) return false;

  const monthStart = dateOnlyToString({ year, month, day: 1 });
  const monthEnd = dateOnlyToString({ year, month, day: monthLength });
  const min = parseDateOnly(minimumDate);
  const max = parseDateOnly(maximumDate);
  const normalizedMin = min ? dateOnlyToString(min) : undefined;
  const normalizedMax = max ? dateOnlyToString(max) : undefined;

  return (
    (!normalizedMin || monthEnd >= normalizedMin) && (!normalizedMax || monthStart <= normalizedMax)
  );
}

/** Monday-first calendar grid containing leading empty cells. */
export function getMonthDayGrid(year: number, month: number): Array<number | null> {
  const firstWeekdayMondayFirst = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  return [
    ...Array.from({ length: firstWeekdayMondayFirst }, () => null),
    ...Array.from({ length: daysInMonth(year, month) }, (_, index) => index + 1),
  ];
}

export function isDateWithinBounds(
  value: string,
  minimumDate?: string,
  maximumDate?: string
): boolean {
  return (!minimumDate || value >= minimumDate) && (!maximumDate || value <= maximumDate);
}
