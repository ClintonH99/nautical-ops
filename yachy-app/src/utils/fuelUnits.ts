import type { FuelVolumeUnit } from '../types';

/** Exact SI conversion used for US liquid gallons. */
export const LITRES_PER_US_GALLON = 3.785411784;

/** The original Fuel Log labelled and persisted its volume and price as gallons. */
export const LEGACY_FUEL_VOLUME_UNIT: FuelVolumeUnit = 'US_GALLONS';

export function storedFuelVolumeUnit(unit: FuelVolumeUnit | null | undefined): FuelVolumeUnit {
  return unit ?? LEGACY_FUEL_VOLUME_UNIT;
}

export function toLitres(value: number, unit: FuelVolumeUnit): number {
  return unit === 'LITRES' ? value : value * LITRES_PER_US_GALLON;
}

export function fromLitres(litres: number, unit: FuelVolumeUnit): number {
  return unit === 'LITRES' ? litres : litres / LITRES_PER_US_GALLON;
}

export function convertFuelVolume(
  value: number,
  fromUnit: FuelVolumeUnit,
  toUnit: FuelVolumeUnit
): number {
  return fromUnit === toUnit ? value : fromLitres(toLitres(value, fromUnit), toUnit);
}
