import type { FuelSelectOption } from '../components/FuelSelectField';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Common civil/maritime UTC offsets, including currently used fractional zones. */
const COMMON_UTC_OFFSETS = [
  -720, -660, -600, -570, -540, -480, -420, -360, -300, -240, -210, -180, -150, -120, -60, 0, 60,
  120, 180, 210, 240, 270, 300, 330, 345, 360, 390, 420, 480, 525, 540, 570, 600, 630, 660, 720,
  765, 780, 825, 840,
];

export function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  return `UTC${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

export function fuelUtcOffsetOptions(currentOffset?: number): FuelSelectOption<number>[] {
  const offsets = new Set(COMMON_UTC_OFFSETS);
  if (currentOffset !== undefined) offsets.add(currentOffset);
  return [...offsets]
    .sort((left, right) => left - right)
    .map((value) => ({ value, label: formatUtcOffset(value) }));
}

/** Convert explicit ship-local date/time fields to an unambiguous UTC instant. */
export function fuelEventDateTime(
  dateValue: string,
  timeValue: Date,
  utcOffsetMinutes: number
): Date {
  const year = Number(dateValue.slice(0, 4));
  const month = Number(dateValue.slice(5, 7));
  const day = Number(dateValue.slice(8, 10));
  const localUtc = Date.UTC(
    year,
    month - 1,
    day,
    timeValue.getHours(),
    timeValue.getMinutes(),
    0,
    0
  );
  const check = new Date(localUtc);
  if (
    !Number.isInteger(utcOffsetMinutes) ||
    utcOffsetMinutes < -840 ||
    utcOffsetMinutes > 840 ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return new Date(Number.NaN);
  }
  return new Date(localUtc - utcOffsetMinutes * 60_000);
}

/** Recover editable ship-local fields from a stored instant and captured offset. */
export function fuelEventFields(
  value: string,
  utcOffsetMinutes: number | null | undefined
): { date: string; time: Date; utcOffsetMinutes: number } {
  const instant = new Date(value);
  const offset = utcOffsetMinutes ?? 0;
  const shifted = new Date(instant.getTime() + offset * 60_000);
  const time = new Date();
  time.setHours(shifted.getUTCHours(), shifted.getUTCMinutes(), 0, 0);
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
      shifted.getUTCDate()
    )}`,
    time,
    utcOffsetMinutes: offset,
  };
}
