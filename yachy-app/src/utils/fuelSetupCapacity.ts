import type { FuelVolumeUnit } from '../types';
import { fromLitres, toLitres } from './fuelUnits';

export interface FuelCapacityDraft {
  capacity: string;
  /** Exact canonical value retained independently from rounded display text. */
  capacityLitres: number | null;
  /** True only after the user directly edits the capacity field. */
  capacityDirty: boolean;
}

export function fuelCapacityDisplayValue(capacityLitres: number, unit: FuelVolumeUnit): string {
  return String(Number(fromLitres(capacityLitres, unit).toFixed(3)));
}

export function fuelCapacityDraftFromLitres(
  capacityLitres: number,
  unit: FuelVolumeUnit
): FuelCapacityDraft {
  return {
    capacity: fuelCapacityDisplayValue(capacityLitres, unit),
    capacityLitres,
    capacityDirty: false,
  };
}

export function commitFuelCapacityDisplay(
  capacity: string,
  unit: FuelVolumeUnit
): FuelCapacityDraft | null {
  const parsed = Number.parseFloat(capacity.trim().replace(/,/g, '.'));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return {
    capacity: String(parsed),
    capacityLitres: toLitres(parsed, unit),
    capacityDirty: false,
  };
}

export function commitFuelCapacityDraft<T extends FuelCapacityDraft>(
  draft: T,
  unit: FuelVolumeUnit
): T | null {
  if (!draft.capacityDirty && draft.capacityLitres != null) return draft;
  const committed = commitFuelCapacityDisplay(draft.capacity, unit);
  return committed ? ({ ...draft, ...committed } as T) : null;
}

export function displayFuelCapacityInUnit<T extends FuelCapacityDraft>(
  draft: T,
  nextUnit: FuelVolumeUnit
): T {
  if (draft.capacityLitres == null) return draft;
  return {
    ...draft,
    capacity: fuelCapacityDisplayValue(draft.capacityLitres, nextUnit),
  };
}
