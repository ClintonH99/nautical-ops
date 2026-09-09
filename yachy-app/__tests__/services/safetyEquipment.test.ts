jest.mock('../../src/services/supabase', () => ({ supabase: {} }));

import {
  getSafetyEquipmentCategoryOrder,
  SafetyEquipmentData,
} from '../../src/services/safetyEquipment';

describe('getSafetyEquipmentCategoryOrder', () => {
  it('restores the explicitly saved order without repopulating removed defaults', () => {
    const data: SafetyEquipmentData = {
      categoryOrder: ['custom_harnesses', 'lifeRafts'],
      customLabels: { custom_harnesses: 'Safety harnesses' },
      lifeRafts: ['Bridge deck'],
      custom_harnesses: ['Bosun locker'],
    };

    expect(getSafetyEquipmentCategoryOrder(data, ['fireExtinguishers', 'lifeRafts'])).toEqual([
      'custom_harnesses',
      'lifeRafts',
    ]);
  });

  it('keeps an explicitly saved empty list empty', () => {
    expect(
      getSafetyEquipmentCategoryOrder({ categoryOrder: [] }, ['fireExtinguishers', 'lifeRafts'])
    ).toEqual([]);
  });

  it('uses only saved category keys for legacy records', () => {
    const data: SafetyEquipmentData = {
      lifeRafts: ['Bridge deck'],
      custom_harnesses: ['Bosun locker'],
      customLabels: { custom_harnesses: 'Safety harnesses' },
    };

    expect(getSafetyEquipmentCategoryOrder(data, ['fireExtinguishers', 'lifeRafts'])).toEqual([
      'lifeRafts',
      'custom_harnesses',
    ]);
  });
});
