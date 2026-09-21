/** @jest-environment node */

import type { FuelInventoryOperation, FuelInventoryTankSnapshot } from '../../src/types';
import {
  formatFuelEventDateTime,
  fuelOperationAuditLabel,
  fuelOperationAmountLitres,
  fuelOperationPostingBreakdown,
  fuelTankVerificationLabel,
} from '../../src/utils/fuelInventoryPresentation';

function operation(
  kind: FuelInventoryOperation['kind'],
  amounts: number[]
): FuelInventoryOperation {
  return {
    id: 'operation-1',
    logicalOperationId: 'logical-1',
    revisionNo: 1,
    vesselId: 'vessel-1',
    kind,
    status: 'POSTED',
    effectiveAt: '2026-09-18T00:00:00.000Z',
    utcOffsetMinutes: 600,
    effectiveOrder: 1,
    recordedSequence: 1,
    metadata: {},
    sourceFuelLogId: null,
    sourceTransferId: null,
    supersedesOperationId: null,
    createdBy: 'user-1',
    createdByName: 'Captain',
    recordedAt: '2026-09-18T00:00:01.000Z',
    voided: false,
    voidKind: null,
    voidReason: null,
    voidedBy: null,
    voidedByName: '',
    voidedAt: null,
    postings: amounts.map((amount, index) => ({
      tankId: `tank-${index + 1}`,
      tankName: `Tank ${index + 1}`,
      postingMode: kind === 'OPENING' || kind === 'SOUNDING' ? 'ABSOLUTE' : 'DELTA',
      amountLitres: amount,
    })),
  };
}

describe('fuel inventory presentation', () => {
  it('renders captured ship time independently of the device timezone', () => {
    expect(formatFuelEventDateTime('2026-09-18T00:00:00.000Z', 600)).toBe(
      '2026-09-18 10:00'
    );
    expect(formatFuelEventDateTime('2026-09-18T00:00:00.000Z', -210)).toBe(
      '2026-09-17 20:30'
    );
    expect(formatFuelEventDateTime('2026-09-18T00:00:00.000Z', null)).toBe('2026-09-18 00:00');
  });

  it('sums every receipt allocation instead of displaying only the largest tank', () => {
    const receipt = operation('REFUEL', [100, 250, 50]);
    expect(fuelOperationAmountLitres(receipt)).toBe(400);
    expect(fuelOperationPostingBreakdown(receipt)).toEqual([
      { tankId: 'tank-1', tankName: 'Tank 1', amountLitres: 100 },
      { tankId: 'tank-2', tankName: 'Tank 2', amountLitres: 250 },
      { tankId: 'tank-3', tankName: 'Tank 3', amountLitres: 50 },
    ]);
  });

  it('counts a transfer once and retains an adjustment sign', () => {
    expect(fuelOperationAmountLitres(operation('TRANSFER', [-80, 80]))).toBe(80);
    expect(fuelOperationAmountLitres(operation('ADJUSTMENT', [-12.5]))).toBe(-12.5);
  });

  it('distinguishes amended revisions from records voided as errors', () => {
    const amended = operation('REFUEL', [250]);
    amended.status = 'REPLACED';
    amended.voided = true;
    amended.voidKind = 'AMENDMENT';

    const voided = operation('CONSUMPTION', [-30]);
    voided.status = 'VOIDED';
    voided.voided = true;
    voided.voidKind = 'ERROR';

    expect(fuelOperationAuditLabel(amended)).toBe('Amended fuel received');
    expect(fuelOperationAuditLabel(voided)).toBe('Voided fuel consumed');
    expect(fuelOperationAuditLabel(operation('SOUNDING', [800]))).toBe('Tank sounding');
  });

  it('describes a later opening correction without claiming the tank was never sounded', () => {
    const verification = {
      initialized: true,
      lastVerifiedAt: '2026-09-18T00:00:00.000Z',
      lastVerificationKind: 'OPENING',
      lastVerifiedUtcOffsetMinutes: 600,
    } satisfies Pick<
      FuelInventoryTankSnapshot,
      'initialized' | 'lastVerifiedAt' | 'lastVerificationKind' | 'lastVerifiedUtcOffsetMinutes'
    >;

    const label = fuelTankVerificationLabel(verification);
    expect(label).toBe('2026-09-18 10:00');
    expect(label).not.toContain('Not yet verified by sounding');
  });

  it('retains the sounding-specific label when sounding is the latest absolute record', () => {
    expect(
      fuelTankVerificationLabel({
        initialized: true,
        lastVerifiedAt: '2026-09-18T00:00:00.000Z',
        lastVerificationKind: 'SOUNDING',
        lastVerifiedUtcOffsetMinutes: 600,
      })
    ).toBe('2026-09-18 10:00');
  });
});
