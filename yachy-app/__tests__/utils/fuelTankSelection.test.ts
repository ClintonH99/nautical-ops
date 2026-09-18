/** @jest-environment node */

import type { FuelTank, FuelTankBalance } from '../../src/types';
import {
  getSelectableFuelTransferBalances,
  mergeFuelCorrectionTanks,
} from '../../src/utils/fuelTankSelection';

function tank(id: string, archivedAt: string | null = null): FuelTank {
  return {
    id,
    vesselId: 'vessel-1',
    name: `Tank ${id}`,
    location: '',
    description: '',
    capacityLitres: 1_000,
    archivedAt,
    createdBy: 'user-1',
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z',
  };
}

describe('fuel correction tank selection', () => {
  it('unions eligible active tanks with retained archived source tanks', () => {
    const activeOriginal = tank('active-original');
    const activeAlternative = tank('active-alternative');
    const archivedOriginal = tank('archived-original', '2026-09-18T01:00:00.000Z');

    expect(
      mergeFuelCorrectionTanks(
        [activeOriginal, activeAlternative],
        [activeOriginal, archivedOriginal, null]
      ).map((item) => item.id)
    ).toEqual(['active-original', 'active-alternative', 'archived-original']);
  });

  it('does not duplicate a retained tank that is still eligible', () => {
    const active = tank('active');

    expect(mergeFuelCorrectionTanks([active], [active, active])).toEqual([active]);
  });

  it('keeps all active setup tanks selectable for a pre-activation legacy transfer edit', () => {
    const originalSource = tank('original-source');
    const alternative = tank('alternative');
    const retainedArchivedDestination = tank('archived-destination', '2026-09-18T01:00:00.000Z');
    const balances: FuelTankBalance[] = [
      {
        tank: originalSource,
        recordedVolumeLitres: 0,
        remainingCapacityLitres: 1_000,
        isInitialized: false,
      },
      {
        tank: alternative,
        recordedVolumeLitres: 0,
        remainingCapacityLitres: 1_000,
        isInitialized: false,
      },
      {
        tank: retainedArchivedDestination,
        recordedVolumeLitres: 0,
        remainingCapacityLitres: 1_000,
        isInitialized: true,
      },
    ];

    expect(
      getSelectableFuelTransferBalances(balances, 'LEGACY_EDIT').map((item) => item.tank.id)
    ).toEqual(['original-source', 'alternative', 'archived-destination']);
  });

  it('keeps configured tanks selectable for a new report-only transfer', () => {
    const source = tank('source');
    const destination = tank('destination');
    const balances: FuelTankBalance[] = [source, destination].map((item) => ({
      tank: item,
      recordedVolumeLitres: 0,
      remainingCapacityLitres: item.capacityLitres,
      isInitialized: false,
    }));

    expect(
      getSelectableFuelTransferBalances(balances, 'REPORT_ONLY').map((item) => item.tank.id)
    ).toEqual(['source', 'destination']);
  });

  it('still excludes uninitialized tanks from new transfers and ledger corrections', () => {
    const initialized = tank('initialized');
    const unknown = tank('unknown');
    const balances: FuelTankBalance[] = [
      {
        tank: initialized,
        recordedVolumeLitres: 500,
        remainingCapacityLitres: 500,
        isInitialized: true,
      },
      {
        tank: unknown,
        recordedVolumeLitres: 0,
        remainingCapacityLitres: 1_000,
        isInitialized: false,
      },
    ];

    expect(getSelectableFuelTransferBalances(balances, 'LEDGER')).toEqual([balances[0]]);
  });
});
