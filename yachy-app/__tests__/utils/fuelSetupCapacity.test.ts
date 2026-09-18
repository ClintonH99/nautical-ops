/** @jest-environment node */

import {
  commitFuelCapacityDraft,
  commitFuelCapacityDisplay,
  displayFuelCapacityInUnit,
  fuelCapacityDraftFromLitres,
} from '../../src/utils/fuelSetupCapacity';
import { LITRES_PER_US_GALLON } from '../../src/utils/fuelUnits';

describe('fuel setup canonical capacity drafts', () => {
  it('keeps exact litres through presentation-only unit changes', () => {
    const litres = fuelCapacityDraftFromLitres(5000, 'LITRES');
    const gallons = displayFuelCapacityInUnit(litres, 'US_GALLONS');
    const backToLitres = displayFuelCapacityInUnit(gallons, 'LITRES');

    expect(gallons.capacity).toBe('1320.86');
    expect(gallons.capacityLitres).toBe(5000);
    expect(backToLitres).toEqual({
      capacity: '5000',
      capacityLitres: 5000,
      capacityDirty: false,
    });
    expect(commitFuelCapacityDraft(gallons, 'US_GALLONS')?.capacityLitres).toBe(5000);
  });

  it('updates canonical litres only when the capacity field is committed', () => {
    const edited = commitFuelCapacityDisplay('1320.86', 'US_GALLONS');

    expect(edited?.capacityLitres).toBeCloseTo(1320.86 * LITRES_PER_US_GALLON, 9);
  });
});
