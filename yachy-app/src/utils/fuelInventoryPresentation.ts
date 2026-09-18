import type { FuelInventoryOperation, FuelInventoryTankSnapshot } from '../types';

const OPERATION_LABELS: Record<FuelInventoryOperation['kind'], string> = {
  OPENING: 'Opening level',
  REFUEL: 'Fuel received',
  TRANSFER: 'Tank transfer',
  SOUNDING: 'Tank sounding',
  CONSUMPTION: 'Fuel consumed',
  ADJUSTMENT: 'Manual adjustment',
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function offsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  return `UTC${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

/** Render an instant in its captured ship-local offset without using device timezone. */
export function formatFuelEventDateTime(
  value: string | null | undefined,
  utcOffsetMinutes: number | null | undefined
): string {
  if (!value) return '';
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return '';
  const offset = utcOffsetMinutes ?? 0;
  const shifted = new Date(instant.getTime() + offset * 60_000);
  const rendered = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
    shifted.getUTCDate()
  )} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
  return `${rendered} ${utcOffsetMinutes == null ? 'UTC' : offsetLabel(offset)}`;
}

export function fuelOperationKindLabel(kind: FuelInventoryOperation['kind']): string {
  return OPERATION_LABELS[kind];
}

/**
 * Describe the latest absolute inventory record without implying that an
 * opening correction means the tank has never previously been sounded.
 */
export function fuelTankVerificationLabel(
  tank: Pick<
    FuelInventoryTankSnapshot,
    'initialized' | 'lastVerifiedAt' | 'lastVerificationKind' | 'lastVerifiedUtcOffsetMinutes'
  >
): string {
  if (!tank.initialized) return 'Opening level not set';

  const occurredAt = formatFuelEventDateTime(
    tank.lastVerifiedAt,
    tank.lastVerifiedUtcOffsetMinutes
  );
  if (tank.lastVerificationKind === 'SOUNDING') {
    return occurredAt
      ? `Last verified by sounding ${occurredAt}`
      : 'Latest level is a tank sounding';
  }
  if (tank.lastVerificationKind === 'OPENING') {
    return occurredAt
      ? `Latest absolute level is the opening record from ${occurredAt}`
      : 'Latest absolute level is the opening record';
  }
  return 'Latest verification unavailable';
}

/**
 * Describes the audit state without conflating a superseded revision with a
 * user-voided mistake. An AMENDMENT void is the retained previous revision.
 */
export function fuelOperationAuditLabel(record: FuelInventoryOperation): string {
  const label = fuelOperationKindLabel(record.kind);
  const amended = record.status === 'REPLACED' || record.voidKind?.toUpperCase() === 'AMENDMENT';
  if (amended) return `Amended ${label.toLowerCase()}`;
  if (record.status === 'VOIDED' || record.voided) return `Voided ${label.toLowerCase()}`;
  return label;
}

/**
 * One operation-level amount for history. Receipts/openings sum allocations;
 * transfers count only the inbound leg; adjustments retain their sign.
 */
export function fuelOperationAmountLitres(record: FuelInventoryOperation): number | null {
  const amounts = record.postings.map((posting) => posting.amountLitres);
  if (amounts.length === 0) return null;

  switch (record.kind) {
    case 'OPENING':
    case 'REFUEL':
      return amounts.filter((amount) => amount > 0).reduce((total, amount) => total + amount, 0);
    case 'TRANSFER':
      return amounts.filter((amount) => amount > 0).reduce((total, amount) => total + amount, 0);
    case 'SOUNDING':
      return amounts.reduce((total, amount) => total + amount, 0);
    case 'CONSUMPTION':
      return Math.abs(
        amounts.filter((amount) => amount < 0).reduce((total, amount) => total + amount, 0)
      );
    case 'ADJUSTMENT':
      return amounts.reduce((total, amount) => total + amount, 0);
    default:
      return null;
  }
}

/**
 * Multi-tank receipt/opening attribution for audit history. Returning each
 * immutable posting prevents an operation total from being mislabeled as if
 * it all belonged to the first tank.
 */
export function fuelOperationPostingBreakdown(
  record: FuelInventoryOperation
): Array<{ tankId: string; tankName: string; amountLitres: number }> {
  if ((record.kind !== 'OPENING' && record.kind !== 'REFUEL') || record.postings.length < 2) {
    return [];
  }
  return record.postings.map((posting) => ({
    tankId: posting.tankId,
    tankName: posting.tankName,
    amountLitres: posting.amountLitres,
  }));
}
