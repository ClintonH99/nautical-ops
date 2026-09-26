/** Shared logs use UTC creation months, so crew in different time zones see the same archive. */
export function logMonth(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function isLogMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function logMonthBounds(month: string): { start: string; end: string } {
  if (!isLogMonth(month)) throw new Error('Invalid log month');
  const [year, number] = month.split('-').map(Number);
  return {
    start: `${month}-01T00:00:00.000Z`,
    end: new Date(Date.UTC(year, number, 1)).toISOString(),
  };
}

export function logMonthLabel(month: string, includeYear = true): string {
  return new Date(logMonthBounds(month).start).toLocaleDateString('en-GB', {
    month: 'long',
    ...(includeYear ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  });
}

/** Previous months only, beginning with vessel creation, never the joining crew member's date. */
export function vesselHistoryMonths(createdAt: string, currentMonth: string): string[] {
  const created = new Date(createdAt);
  if (!Number.isFinite(created.getTime()) || !isLogMonth(currentMonth)) return [];
  const first = logMonth(created);
  const months: string[] = [];
  let cursor = first;
  while (cursor < currentMonth) {
    months.push(cursor);
    cursor = logMonth(new Date(logMonthBounds(cursor).end));
  }
  return months.reverse();
}

export function createdInLogMonth(createdAt: string, month: string): boolean {
  const date = new Date(createdAt);
  return Number.isFinite(date.getTime()) && logMonth(date) === month;
}

export const VESSEL_LOG_KINDS = {
  waste: { title: 'General Waste Log', route: 'GeneralWasteLog' },
  fuel: { title: 'Fuel Receipts', route: 'FuelLog' },
  discharge: { title: 'Discharge Log', route: 'PumpOutLog' },
} as const;
export type VesselLogKind = keyof typeof VESSEL_LOG_KINDS;
