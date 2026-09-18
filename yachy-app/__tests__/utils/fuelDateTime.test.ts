/** @jest-environment node */

import {
  formatUtcOffset,
  fuelEventDateTime,
  fuelEventFields,
  fuelUtcOffsetOptions,
} from '../../src/utils/fuelDateTime';

describe('fuel ship date and time', () => {
  it('creates the same instant independently of the device timezone', () => {
    const time = new Date(2026, 0, 1, 8, 30);
    expect(fuelEventDateTime('2026-09-18', time, 600).toISOString()).toBe(
      '2026-09-17T22:30:00.000Z'
    );
    expect(fuelEventDateTime('2026-09-18', time, -210).toISOString()).toBe(
      '2026-09-18T12:00:00.000Z'
    );
  });

  it('round trips captured ship-local fields', () => {
    const fields = fuelEventFields('2026-09-17T22:30:00.000Z', 600);
    expect(fields.date).toBe('2026-09-18');
    expect(fields.time.getHours()).toBe(8);
    expect(fields.time.getMinutes()).toBe(30);
    expect(fields.utcOffsetMinutes).toBe(600);
  });

  it('includes fractional offsets and a current non-standard offset', () => {
    const options = fuelUtcOffsetOptions(17);
    expect(options.some((option) => option.value === 345)).toBe(true);
    expect(options.some((option) => option.value === -150)).toBe(true);
    expect(options.some((option) => option.value === 825)).toBe(true);
    expect(options.some((option) => option.value === 17)).toBe(true);
    expect(formatUtcOffset(-210)).toBe('UTC-03:30');
  });
});
