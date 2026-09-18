import {
  LITRES_PER_US_GALLON,
  convertFuelVolume,
  fromLitres,
  storedFuelVolumeUnit,
  toLitres,
} from '../../src/utils/fuelUnits';

describe('fuel volume conversion', () => {
  it('uses US liquid gallons as the canonical conversion', () => {
    expect(toLitres(1, 'US_GALLONS')).toBe(LITRES_PER_US_GALLON);
    expect(fromLitres(LITRES_PER_US_GALLON, 'US_GALLONS')).toBeCloseTo(1, 12);
  });

  it('round-trips values between litres and US gallons without changing same-unit values', () => {
    expect(convertFuelVolume(500, 'LITRES', 'LITRES')).toBe(500);
    expect(convertFuelVolume(500, 'LITRES', 'US_GALLONS')).toBeCloseTo(132.086, 3);
    expect(convertFuelVolume(132.086, 'US_GALLONS', 'LITRES')).toBeCloseTo(500, 2);
  });

  it('retains the legacy Fuel Log gallon semantics when no unit metadata exists', () => {
    expect(storedFuelVolumeUnit(null)).toBe('US_GALLONS');
    expect(storedFuelVolumeUnit(undefined)).toBe('US_GALLONS');
    expect(storedFuelVolumeUnit('LITRES')).toBe('LITRES');
  });
});
