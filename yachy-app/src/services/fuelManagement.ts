/**
 * Shared fuel-management data service.
 *
 * All fuel mutations for the current app flow through the transactional RPCs
 * below. fuelLogsService remains a read adapter plus a temporary pre-activation
 * compatibility surface for already-released clients during the staged rollout.
 */

import * as Crypto from 'expo-crypto';

import { supabase } from './supabase';
import { acquireFuelRequest, completeFuelRequest, getFuelRequestStorageKey } from './fuelRequestId';
import type { CreateFuelLogData, UpdateFuelLogData } from './fuelLogs';
import type {
  FuelLog,
  FuelLogAllocationSnapshot,
  FuelLogTankAllocation,
  FuelLogTankEntry,
  FuelLogTankEntryInput,
  FuelSetup,
  FuelSetupTankInput,
  FuelInventoryActivationInput,
  FuelInventoryActivationStatus,
  FuelInventoryOpeningAmendmentInput,
  FuelInventoryEntryInput,
  FuelInventoryEntryAmendmentInput,
  FuelInventoryEntryVoidInput,
  FuelInventoryEntryKind,
  FuelInventoryHistory,
  FuelInventoryLegacyAudit,
  FuelInventoryLegacyAuditHistory,
  FuelInventoryLegacyAuditSourceType,
  FuelInventoryLedgerLine,
  FuelInventoryOperation,
  FuelInventoryOperationStatus,
  FuelInventorySnapshot,
  FuelInventoryVerificationKind,
  FuelTank,
  FuelTankBalance,
  FuelTankInput,
  FuelTransfer,
  FuelTransferInput,
  FuelVolumeUnit,
  VesselFuelSettings,
} from '../types';
import { fromLitres } from '../utils/fuelUnits';

export interface SaveFuelSetupInput {
  vesselId: string;
  volumeUnit: FuelVolumeUnit;
  tanks: FuelSetupTankInput[];
  expectedRevision: number;
  idempotencyKey?: string;
}

export interface CreateFuelLogWithTankEntriesInput {
  log: CreateFuelLogData;
  entries: FuelLogTankEntryInput[];
  /** New vessel tanks created atomically with this receipt. Manager-only. */
  newTanks?: Array<
    FuelTankInput & {
      id: string;
      /** Explicit quantity already present before this delivery, in litres. */
      openingLitres: number;
    }
  >;
  /** Required when `newTanks` is non-empty to reject stale setup editors. */
  expectedSetupRevision?: number;
  effectiveAt?: string;
  utcOffsetMinutes?: number;
  idempotencyKey?: string;
}

export interface UpdateFuelLogWithTankEntriesInput {
  vesselId: string;
  log: UpdateFuelLogData;
  entries: FuelLogTankEntryInput[];
  effectiveAt?: string;
  utcOffsetMinutes?: number;
  idempotencyKey?: string;
  amendmentReason?: string;
  expectedRevision?: number;
}

export interface FuelInventoryHistoryOptions {
  limit?: number;
  tankId?: string | null;
  beforeRecordedSequence?: number | null;
}

export interface FuelInventoryLegacyAuditOptions {
  limit?: number;
  sourceType?: FuelInventoryLegacyAuditSourceType | null;
  sourceId?: string | null;
  before?: { recordedAt: string; id: string } | null;
}

export interface VoidFuelTransferOptions {
  expectedRevision: number;
  reason: string;
  idempotencyKey?: string;
}

export type VoidFuelLogOptions = VoidFuelTransferOptions;

type DatabaseRow = Record<string, unknown>;

interface FuelSetupRpcResult {
  settings: DatabaseRow | null;
  tanks: DatabaseRow[];
}

const INVENTORY_STATUS_VALUES = new Set<FuelInventoryActivationStatus>([
  'NOT_ACTIVATED',
  'NEEDS_INITIALIZATION',
  'ACTIVE',
]);
const INVENTORY_KIND_VALUES = new Set<FuelInventoryEntryKind>([
  'OPENING',
  'REFUEL',
  'TRANSFER',
  'CONSUMPTION',
  'SOUNDING',
  'ADJUSTMENT',
]);
const INVENTORY_VERIFICATION_VALUES = new Set<FuelInventoryVerificationKind>([
  'OPENING',
  'SOUNDING',
]);
const FUEL_TRANSFER_READ_SELECT =
  '*, source_tank:fuel_tanks!fuel_transfers_source_tank_id_fkey(name), destination_tank:fuel_tanks!fuel_transfers_destination_tank_id_fkey(name)';

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

/**
 * Canonical fuel quantities are persisted as NUMERIC(14,3). Conversion from
 * US gallons produces a repeating decimal, so normalize once at the service
 * boundary instead of relying on an implicit database cast or platform float.
 */
function canonicalLitres(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Fuel quantity must be a valid number.');
  return roundDecimal(value, 3);
}

function roundDecimal(value: number, places: number): number {
  const factor = 10 ** places;
  const correction = Math.sign(value) * Number.EPSILON * Math.max(1, Math.abs(value));
  return Math.round((value + correction) * factor) / factor;
}

function decimal3(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a valid number.`);
  return roundDecimal(value, 3);
}

function decimal4(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a valid number.`);
  return roundDecimal(value, 4);
}

function asRow(value: unknown): DatabaseRow {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as DatabaseRow) : {};
}

function rowValue(row: DatabaseRow, ...keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined) return row[key];
  }
  return undefined;
}

function requireUuid(value: string | undefined): string {
  const id = value?.trim() || Crypto.randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Idempotency key must be a valid UUID.');
  }
  return id;
}

/**
 * Share one complete network/acknowledgement lifecycle for concurrent callers
 * that resolve to the same durable request. The durable storage key includes
 * actor, operation scope and payload fingerprint, so distinct logical writes
 * remain independent.
 */
const inFlightFuelWrites = new Map<string, Promise<unknown>>();

async function idempotentFuelWrite<T>(
  scope: string,
  payload: unknown,
  preferredId: string | undefined,
  write: (requestId: string) => Promise<T>
): Promise<T> {
  const { data: authData, error: authError } = await supabase.auth.getSession();
  if (authError) throw authError;
  const actorId = authData.session?.user.id;
  if (!actorId) throw new Error('An authenticated user is required for fuel inventory changes.');
  const requestScope = `${actorId}:${scope}`;
  const normalizedPreferredId = preferredId === undefined ? undefined : requireUuid(preferredId);
  const storageKey = await getFuelRequestStorageKey(requestScope, payload);
  const existing = inFlightFuelWrites.get(storageKey) as Promise<T> | undefined;
  if (existing) return existing;

  const operation = (async () => {
    const request = await acquireFuelRequest(requestScope, payload, normalizedPreferredId);
    const result = await write(request.id);
    await completeFuelRequest(request);
    return result;
  })();
  inFlightFuelWrites.set(storageKey, operation);

  try {
    return await operation;
  } finally {
    if (inFlightFuelWrites.get(storageKey) === operation) {
      inFlightFuelWrites.delete(storageKey);
    }
  }
}

function normalizeUtcOffsetMinutes(value: number): number {
  if (!Number.isInteger(value) || value < -14 * 60 || value > 14 * 60) {
    throw new Error('The recorded event time is invalid.');
  }
  return value;
}

function offsetFromIso(value: string): number | null {
  if (/z$/i.test(value)) return 0;
  const match = value.match(/([+-])(\d{2}):(\d{2})$/);
  if (!match) return null;
  const offset = Number(match[2]) * 60 + Number(match[3]);
  return (match[1] === '-' ? -1 : 1) * offset;
}

function localDateTime(dateValue: string, timeValue: string): Date {
  const dateMatch = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = timeValue.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!dateMatch || !timeMatch) throw new Error('A valid date and time are required.');

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? 0);
  const result = new Date(year, month - 1, day, hour, minute, second, 0);
  if (
    result.getFullYear() !== year ||
    result.getMonth() !== month - 1 ||
    result.getDate() !== day ||
    result.getHours() !== hour ||
    result.getMinutes() !== minute ||
    result.getSeconds() !== second
  ) {
    throw new Error('A valid date and time are required.');
  }
  return result;
}

function offsetDateTime(dateValue: string, timeValue: string, offsetMinutes: number): Date {
  const dateMatch = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = timeValue.match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
  if (!dateMatch || !timeMatch) throw new Error('A valid date and time are required.');

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? 0);
  const millisecond = Number((timeMatch[4] ?? '').padEnd(3, '0') || 0);
  const localUtcValue = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const localCheck = new Date(localUtcValue);
  if (
    localCheck.getUTCFullYear() !== year ||
    localCheck.getUTCMonth() !== month - 1 ||
    localCheck.getUTCDate() !== day ||
    localCheck.getUTCHours() !== hour ||
    localCheck.getUTCMinutes() !== minute ||
    localCheck.getUTCSeconds() !== second
  ) {
    throw new Error('A valid date and time are required.');
  }
  return new Date(localUtcValue - offsetMinutes * 60_000);
}

function naiveIsoParts(value: string): { date: string; time: string } | null {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)$/);
  return match ? { date: match[1], time: match[2] } : null;
}

function effectiveContext(input: {
  effectiveAt?: string;
  utcOffsetMinutes?: number;
  date?: string;
  time?: string;
}): { effectiveAt: string; utcOffsetMinutes: number } {
  let effectiveDate: Date;
  let inferredOffset: number;
  if (input.effectiveAt) {
    const explicitOffset =
      input.utcOffsetMinutes === undefined
        ? undefined
        : normalizeUtcOffsetMinutes(input.utcOffsetMinutes);
    const naiveParts = naiveIsoParts(input.effectiveAt);
    effectiveDate =
      naiveParts && explicitOffset !== undefined
        ? offsetDateTime(naiveParts.date, naiveParts.time, explicitOffset)
        : new Date(input.effectiveAt);
    if (!Number.isFinite(effectiveDate.getTime())) throw new Error('Effective time is invalid.');
    inferredOffset =
      explicitOffset ?? offsetFromIso(input.effectiveAt) ?? -effectiveDate.getTimezoneOffset();
  } else if (input.date && input.time) {
    if (input.utcOffsetMinutes !== undefined) {
      inferredOffset = normalizeUtcOffsetMinutes(input.utcOffsetMinutes);
      effectiveDate = offsetDateTime(input.date, input.time, inferredOffset);
    } else {
      effectiveDate = localDateTime(input.date, input.time);
      inferredOffset = -effectiveDate.getTimezoneOffset();
    }
  } else {
    effectiveDate = new Date();
    inferredOffset = -effectiveDate.getTimezoneOffset();
  }

  return {
    effectiveAt: effectiveDate.toISOString(),
    utcOffsetMinutes: normalizeUtcOffsetMinutes(input.utcOffsetMinutes ?? inferredOffset),
  };
}

function normalizeCurrencyCode(value: string | undefined): string {
  const code = (value ?? 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error('Currency code must be a three-letter ISO-style code.');
  }
  return code;
}

function assertTankInput(input: FuelTankInput): void {
  if (!input.name.trim()) throw new Error('Fuel tank name is required.');
  if (!Number.isFinite(input.capacityLitres) || canonicalLitres(input.capacityLitres) <= 0) {
    throw new Error('Fuel tank capacity must be greater than zero litres.');
  }
}

function assertEntries(entries: FuelLogTankEntryInput[]): void {
  if (!entries.length) throw new Error('At least one tank allocation is required.');
  const tankIds = new Set<string>();
  for (const entry of entries) {
    if (!entry.fuelTankId) throw new Error('Each allocation must select a fuel tank.');
    if (!Number.isFinite(entry.amountLitres) || canonicalLitres(entry.amountLitres) <= 0) {
      throw new Error('Each allocation amount must be greater than zero litres.');
    }
    if (tankIds.has(entry.fuelTankId)) {
      throw new Error('A tank can only appear once in a fuel log.');
    }
    tankIds.add(entry.fuelTankId);
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function mapFuelLog(row: DatabaseRow): FuelLog {
  const pricePerVolumeUnit = asNumber(row.price_per_gallon);
  const volumeUnit = (row.volume_unit as FuelVolumeUnit | null | undefined) ?? null;
  return {
    id: asString(row.id),
    vesselId: asString(row.vessel_id),
    locationOfRefueling: asString(row.location_of_refueling),
    logDate: asString(row.log_date),
    logTime: asString(row.log_time),
    amountOfFuel: asNumber(row.amount_of_fuel),
    pricePerGallon: pricePerVolumeUnit,
    pricePerVolumeUnit,
    priceVolumeUnit:
      (row.price_volume_unit as FuelVolumeUnit | null | undefined) ?? volumeUnit ?? 'US_GALLONS',
    totalPrice: asNumber(row.total_price),
    volumeUnit,
    currencyCode: asString(row.currency_code) || 'USD',
    comment: asString(row.comment),
    createdBy: asString(row.created_by) || null,
    createdByName: asString(row.created_by_name),
    createdAt: asString(row.created_at),
    effectiveAt: asString(row.effective_at) || null,
    utcOffsetMinutes: asNullableNumber(row.utc_offset_minutes),
    inventoryRevision: asNullableNumber(row.inventory_revision) ?? undefined,
    currentInventoryOperationId: asString(row.current_inventory_operation_id) || null,
    voidedAt: asString(row.voided_at) || null,
  };
}

function mapSettings(row: DatabaseRow): VesselFuelSettings {
  return {
    vesselId: asString(row.vessel_id),
    volumeUnit: row.volume_unit as FuelVolumeUnit,
    setupRevision: asNumber(row.setup_revision),
    createdBy: asString(row.created_by) || null,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

function mapTank(row: DatabaseRow): FuelTank {
  return {
    id: asString(row.id),
    vesselId: asString(row.vessel_id),
    name: asString(row.name),
    location: asString(row.location),
    description: asString(row.description),
    capacityLitres: asNumber(row.capacity_litres),
    createdBy: asString(row.created_by) || null,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    archivedAt: asString(row.archived_at) || null,
  };
}

function mapLogTankEntry(row: DatabaseRow): FuelLogTankEntry {
  return {
    id: asString(row.id),
    vesselId: asString(row.vessel_id),
    fuelLogId: asString(row.fuel_log_id),
    fuelTankId: asString(row.fuel_tank_id),
    amountLitres: asNumber(row.amount_litres),
    createdAt: asString(row.created_at),
  };
}

function relatedTankName(value: unknown): string {
  const related = Array.isArray(value) ? value[0] : value;
  if (!related || typeof related !== 'object') return '';
  return asString((related as DatabaseRow).name);
}

function mapLogTankAllocation(row: DatabaseRow): FuelLogTankAllocation {
  return {
    fuelLogId: asString(row.fuel_log_id),
    fuelTankId: asString(row.fuel_tank_id),
    tankName: asString(row.tank_name) || relatedTankName(row.fuel_tank) || 'Unknown tank',
    amountLitres: asNumber(row.amount_litres),
  };
}

function mapTransfer(row: DatabaseRow): FuelTransfer {
  return {
    id: asString(row.id),
    vesselId: asString(row.vessel_id),
    sourceTankId: asString(row.source_tank_id),
    destinationTankId: asString(row.destination_tank_id),
    sourceTankName: asString(row.source_tank_name) || relatedTankName(row.source_tank) || undefined,
    destinationTankName:
      asString(row.destination_tank_name) || relatedTankName(row.destination_tank) || undefined,
    amountLitres: asNumber(row.amount_litres),
    transferDate: asString(row.transfer_date),
    transferTime: asString(row.transfer_time),
    location: asString(row.location),
    notes: asString(row.notes),
    ledgerOperationId:
      asString(row.current_inventory_operation_id) ||
      asString(row.operation_id) ||
      asString(row.ledger_operation_id) ||
      null,
    effectiveAt: asString(row.effective_at) || null,
    utcOffsetMinutes: asNullableNumber(row.utc_offset_minutes),
    createdBy: asString(row.created_by) || null,
    createdByName: asString(row.created_by_name),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    voidedAt: asString(row.voided_at) || null,
    inventoryRevision: asNullableNumber(row.inventory_revision) ?? undefined,
    currentInventoryOperationId: asString(row.current_inventory_operation_id) || null,
  };
}

function inventoryKind(value: unknown): FuelInventoryEntryKind {
  const kind = asString(value).toUpperCase() as FuelInventoryEntryKind;
  if (!INVENTORY_KIND_VALUES.has(kind)) {
    throw new Error('Fuel inventory history contains an unsupported operation type.');
  }
  return kind;
}

function mapInventoryTankSnapshot(row: DatabaseRow) {
  const tank = mapTank(asRow(row.tank && typeof row.tank === 'object' ? row.tank : row));
  const balanceLitres = asNullableNumber(
    rowValue(row, 'balance_litres', 'balanceLitres', 'recorded_volume_litres')
  );
  const remainingCapacityLitres = asNullableNumber(
    rowValue(row, 'remaining_capacity_litres', 'remainingCapacityLitres')
  );
  const verificationValue = asString(
    rowValue(row, 'last_verified_type', 'lastVerificationKind')
  ).toUpperCase() as FuelInventoryVerificationKind;
  const lastVerificationKind = INVENTORY_VERIFICATION_VALUES.has(verificationValue)
    ? verificationValue
    : null;
  const lastVerifiedAt = asString(rowValue(row, 'last_verified_at', 'lastVerifiedAt')) || null;

  return {
    tank,
    initialized: asBoolean(rowValue(row, 'initialized', 'is_initialized')),
    balanceLitres,
    remainingCapacityLitres,
    lastVerifiedAt,
    lastVerificationKind,
    lastVerifiedUtcOffsetMinutes: asNullableNumber(
      rowValue(row, 'last_verified_utc_offset_minutes', 'lastVerifiedUtcOffsetMinutes')
    ),
    lastActivityAt: asString(rowValue(row, 'last_activity_at', 'lastActivityAt')) || null,
  };
}

function mapInventorySnapshot(value: unknown): FuelInventorySnapshot {
  const row = asRow(value);
  const settings = asRow(row.settings);
  const statusRow = asRow(row.status);
  const tanks = (Array.isArray(row.tanks) ? row.tanks : []).map((tank) =>
    mapInventoryTankSnapshot(asRow(tank))
  );
  const activated = asBoolean(rowValue(statusRow, 'activated', 'is_activated'));
  const fullyInitialized = asBoolean(rowValue(statusRow, 'fully_initialized', 'fullyInitialized'));
  const derivedStatus: FuelInventoryActivationStatus = !activated
    ? 'NOT_ACTIVATED'
    : fullyInitialized
      ? 'ACTIVE'
      : 'NEEDS_INITIALIZATION';
  const suppliedStatus = asString(
    row.inventory_status
  ).toUpperCase() as FuelInventoryActivationStatus;
  const status = INVENTORY_STATUS_VALUES.has(suppliedStatus) ? suppliedStatus : derivedStatus;

  return {
    vesselId: asString(rowValue(row, 'vessel_id', 'vesselId')),
    status,
    activatedAt:
      asString(rowValue(settings, 'inventory_activated_at', 'inventoryActivatedAt')) || null,
    asOf: asString(rowValue(row, 'as_of', 'asOf')),
    displayUnit:
      (rowValue(settings, 'volume_unit', 'volumeUnit') as FuelVolumeUnit | undefined) ?? 'LITRES',
    totalBalanceLitres: asNullableNumber(
      rowValue(row, 'total_balance_litres', 'totalBalanceLitres')
    ),
    totalCapacityLitres: asNumber(rowValue(row, 'total_capacity_litres', 'totalCapacityLitres')),
    allTanksInitialized: fullyInitialized,
    uninitializedTankIds: tanks.filter((tank) => !tank.initialized).map((tank) => tank.tank.id),
    tanks,
  };
}

function mapInventoryPosting(value: unknown): FuelInventoryLedgerLine {
  const row = asRow(value);
  const postingMode = asString(rowValue(row, 'posting_mode', 'postingMode')).toUpperCase();
  if (postingMode !== 'DELTA' && postingMode !== 'ABSOLUTE') {
    throw new Error('Fuel inventory history contains an unsupported posting mode.');
  }
  return {
    tankId: asString(rowValue(row, 'fuel_tank_id', 'tankId')),
    tankName: asString(rowValue(row, 'tank_name', 'tankName')) || 'Unknown tank',
    postingMode,
    amountLitres: asNumber(rowValue(row, 'amount_litres', 'amountLitres')),
  };
}

function mapInventoryOperation(value: unknown): FuelInventoryOperation {
  const row = asRow(value);
  const voided = asBoolean(row.voided);
  const voidKind = asString(rowValue(row, 'void_kind', 'voidKind'));
  const status: FuelInventoryOperationStatus = !voided
    ? 'POSTED'
    : ['REPLACED', 'AMENDMENT'].includes(voidKind.toUpperCase())
      ? 'REPLACED'
      : 'VOIDED';

  return {
    id: asString(row.id),
    logicalOperationId: asString(rowValue(row, 'logical_operation_id', 'logicalOperationId')),
    revisionNo: asNumber(rowValue(row, 'revision_no', 'revisionNo')),
    vesselId: asString(rowValue(row, 'vessel_id', 'vesselId')),
    kind: inventoryKind(rowValue(row, 'operation_type', 'kind')),
    status,
    effectiveAt: asString(rowValue(row, 'effective_at', 'effectiveAt')),
    utcOffsetMinutes: asNullableNumber(rowValue(row, 'utc_offset_minutes', 'utcOffsetMinutes')),
    effectiveOrder: asNumber(rowValue(row, 'effective_order', 'effectiveOrder')),
    recordedSequence: asNumber(rowValue(row, 'recorded_sequence', 'recordedSequence')),
    metadata: asRow(row.metadata),
    sourceFuelLogId: asString(rowValue(row, 'source_fuel_log_id', 'sourceFuelLogId')) || null,
    sourceTransferId:
      asString(rowValue(row, 'source_fuel_transfer_id', 'sourceTransferId')) || null,
    supersedesOperationId:
      asString(rowValue(row, 'supersedes_operation_id', 'supersedesOperationId')) || null,
    createdBy: asString(rowValue(row, 'created_by', 'createdBy')) || null,
    createdByName: asString(rowValue(row, 'created_by_name', 'createdByName')),
    recordedAt: asString(rowValue(row, 'recorded_at', 'recordedAt')),
    voided,
    voidKind: voidKind || null,
    voidReason: asString(rowValue(row, 'void_reason', 'voidReason')) || null,
    voidedBy: asString(rowValue(row, 'void_created_by', 'voidedBy')) || null,
    voidedByName: asString(rowValue(row, 'void_created_by_name', 'voidedByName')),
    voidedAt: asString(rowValue(row, 'void_recorded_at', 'voidedAt')) || null,
    postings: (Array.isArray(row.postings) ? row.postings : []).map(mapInventoryPosting),
  };
}

function mapInventoryHistory(value: unknown): FuelInventoryHistory {
  const row = asRow(value);
  return {
    operations: (Array.isArray(row.operations) ? row.operations : []).map(mapInventoryOperation),
    nextBeforeSequence: asNullableNumber(
      rowValue(row, 'next_before_sequence', 'nextBeforeSequence')
    ),
  };
}

function mapLegacyAudit(value: unknown): FuelInventoryLegacyAudit {
  const row = asRow(value);
  const sourceType = asString(rowValue(row, 'source_type', 'sourceType')).toUpperCase();
  if (sourceType !== 'FUEL_LOG' && sourceType !== 'FUEL_TRANSFER') {
    throw new Error('Legacy fuel audit contains an unsupported source type.');
  }
  const action = asString(row.action).toUpperCase();
  if (action !== 'AMENDMENT' && action !== 'VOID') {
    throw new Error('Legacy fuel audit contains an unsupported action.');
  }
  return {
    id: asString(row.id),
    vesselId: asString(rowValue(row, 'vessel_id', 'vesselId')),
    sourceType,
    sourceId: asString(rowValue(row, 'source_id', 'sourceId')),
    action,
    revisionBefore: asNullableNumber(rowValue(row, 'revision_before', 'revisionBefore')),
    revisionAfter: asNullableNumber(rowValue(row, 'revision_after', 'revisionAfter')),
    beforeSnapshot: asRow(rowValue(row, 'before_snapshot', 'beforeSnapshot')),
    afterSnapshot: asRow(rowValue(row, 'after_snapshot', 'afterSnapshot')),
    reason: asString(row.reason),
    clientRequestId: asString(rowValue(row, 'client_request_id', 'clientRequestId')),
    createdBy: asString(rowValue(row, 'created_by', 'createdBy')) || null,
    createdByName: asString(rowValue(row, 'created_by_name', 'createdByName')),
    recordedAt: asString(rowValue(row, 'recorded_at', 'recordedAt')),
  };
}

function mapLegacyAuditHistory(value: unknown): FuelInventoryLegacyAuditHistory {
  const row = asRow(value);
  const cursor = asRow(rowValue(row, 'next_cursor', 'nextCursor'));
  const recordedAt = asString(rowValue(cursor, 'recorded_at', 'recordedAt'));
  const id = asString(cursor.id);
  return {
    audits: (Array.isArray(row.audits) ? row.audits : []).map(mapLegacyAudit),
    nextCursor: recordedAt && id ? { recordedAt, id } : null,
  };
}

function setupFromRows(settingsRow: DatabaseRow | null, tankRows: DatabaseRow[]): FuelSetup {
  const tanks = tankRows.map(mapTank);
  return {
    settings: settingsRow ? mapSettings(settingsRow) : null,
    tanks,
    totalCapacityLitres: tanks.reduce((total, tank) => total + tank.capacityLitres, 0),
  };
}

function toTankRow(input: FuelTankInput): Record<string, unknown> {
  assertTankInput(input);
  return {
    name: input.name.trim(),
    location: input.location?.trim() ?? '',
    description: input.description?.trim() ?? '',
    capacity_litres: canonicalLitres(input.capacityLitres),
  };
}

function toLogEntries(
  entries: FuelLogTankEntryInput[],
  allowEmptyLegacyUpdate = false
): Array<Record<string, unknown>> {
  if (allowEmptyLegacyUpdate && entries.length === 0) return [];
  assertEntries(entries);
  return entries.map((entry) => ({
    fuel_tank_id: entry.fuelTankId,
    amount_litres: canonicalLitres(entry.amountLitres),
  }));
}

function activationOpenings(input: FuelInventoryActivationInput) {
  if (!input.entries.length) throw new Error('At least one opening tank quantity is required.');
  const tankIds = new Set<string>();
  return input.entries.map((entry) => {
    if (!entry.tankId) throw new Error('Each opening quantity must select a fuel tank.');
    const amountLitres = canonicalLitres(entry.amountLitres);
    if (!Number.isFinite(entry.amountLitres) || amountLitres < 0) {
      throw new Error('Opening quantities must be zero or greater.');
    }
    if (tankIds.has(entry.tankId)) {
      throw new Error('A tank can only appear once when inventory is activated.');
    }
    tankIds.add(entry.tankId);
    return { fuel_tank_id: entry.tankId, amount_litres: amountLitres };
  });
}

function inventoryEntryAmount(input: FuelInventoryEntryInput): number {
  if (!Number.isFinite(input.amountLitres)) throw new Error('Fuel amount must be a valid number.');
  const amountLitres = canonicalLitres(input.amountLitres);
  if (input.kind === 'SOUNDING') {
    if (amountLitres < 0) throw new Error('A sounding cannot be negative.');
    return amountLitres;
  }
  if (input.kind === 'CONSUMPTION') {
    if (amountLitres <= 0) throw new Error('Consumption must be greater than zero.');
    return amountLitres;
  }

  if (!input.reason?.trim()) throw new Error('An adjustment reason is required.');
  if (input.adjustmentDirection) {
    if (amountLitres <= 0) {
      throw new Error('An adjustment amount must be greater than zero.');
    }
    return input.adjustmentDirection === 'REMOVE' ? -amountLitres : amountLitres;
  }
  if (amountLitres === 0) throw new Error('An adjustment cannot be zero.');
  return amountLitres;
}

function transferPayload(input: FuelTransferInput): Record<string, unknown> {
  if (input.sourceTankId === input.destinationTankId) {
    throw new Error('Source and destination tanks must be different.');
  }
  const amountLitres = canonicalLitres(input.amountLitres);
  if (!Number.isFinite(input.amountLitres) || amountLitres <= 0) {
    throw new Error('Transfer amount must be greater than zero litres.');
  }
  const effective = effectiveContext({
    effectiveAt: input.effectiveAt,
    utcOffsetMinutes: input.utcOffsetMinutes,
    date: input.transferDate,
    time: input.transferTime,
  });
  return {
    vessel_id: input.vesselId,
    source_tank_id: input.sourceTankId,
    destination_tank_id: input.destinationTankId,
    amount_litres: amountLitres,
    effective_at: effective.effectiveAt,
    utc_offset_minutes: effective.utcOffsetMinutes,
    transfer_date: input.transferDate,
    transfer_time: input.transferTime,
    location: input.location?.trim() || '',
    notes: input.notes?.trim() || '',
  };
}

function rpcResultRow(value: unknown, nestedKey: string): DatabaseRow {
  const row = asRow(value);
  const nested = row[nestedKey];
  return nested && typeof nested === 'object' && !Array.isArray(nested) ? asRow(nested) : row;
}

class FuelManagementService {
  async getSettings(vesselId: string): Promise<VesselFuelSettings | null> {
    const { data, error } = await supabase
      .from('vessel_fuel_settings')
      .select('*')
      .eq('vessel_id', vesselId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapSettings(data) : null;
  }

  async getTanks(vesselId: string): Promise<FuelTank[]> {
    const { data, error } = await supabase
      .from('fuel_tanks')
      .select('*')
      .eq('vessel_id', vesselId)
      .is('archived_at', null)
      .order('name', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapTank);
  }

  async getSetup(vesselId: string): Promise<FuelSetup> {
    const { data, error } = await supabase.rpc('get_vessel_fuel_setup', {
      p_vessel_id: vesselId,
    });
    if (error) throw error;
    const result = data as FuelSetupRpcResult;
    return setupFromRows(result.settings, result.tanks ?? []);
  }

  async getInventorySnapshot(vesselId: string, asOf?: string): Promise<FuelInventorySnapshot> {
    const args: Record<string, unknown> = { p_vessel_id: vesselId };
    if (asOf) {
      const parsed = new Date(asOf);
      if (!Number.isFinite(parsed.getTime())) throw new Error('Inventory as-of time is invalid.');
      args.p_as_of = parsed.toISOString();
    }
    const { data, error } = await supabase.rpc('get_fuel_inventory_snapshot', args);
    if (error) throw error;
    return mapInventorySnapshot(data);
  }

  async getInventoryHistory(
    vesselId: string,
    options: FuelInventoryHistoryOptions = {}
  ): Promise<FuelInventoryHistory> {
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 250) {
      throw new Error('Fuel inventory history limit must be between 1 and 250.');
    }
    if (
      options.beforeRecordedSequence !== undefined &&
      options.beforeRecordedSequence !== null &&
      (!Number.isInteger(options.beforeRecordedSequence) || options.beforeRecordedSequence < 1)
    ) {
      throw new Error('Fuel inventory history cursor is invalid.');
    }

    const { data, error } = await supabase.rpc('get_fuel_inventory_history', {
      p_vessel_id: vesselId,
      p_tank_id: options.tankId ?? null,
      p_limit: limit,
      p_before_recorded_sequence: options.beforeRecordedSequence ?? null,
    });
    if (error) throw error;
    return mapInventoryHistory(data);
  }

  async getLegacyInventoryAudits(
    vesselId: string,
    options: FuelInventoryLegacyAuditOptions = {}
  ): Promise<FuelInventoryLegacyAuditHistory> {
    const limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Legacy fuel audit page limit must be between 1 and 100.');
    }
    if (options.sourceId && !options.sourceType) {
      throw new Error('Legacy fuel audit source ID requires a source type.');
    }
    const before = options.before ?? null;
    if (before) {
      const parsed = new Date(before.recordedAt);
      if (!before.id || !Number.isFinite(parsed.getTime())) {
        throw new Error('Legacy fuel audit cursor is invalid.');
      }
    }

    const { data, error } = await supabase.rpc('get_fuel_inventory_legacy_audits', {
      p_vessel_id: vesselId,
      p_source_type: options.sourceType ?? null,
      p_source_id: options.sourceId ?? null,
      p_limit: limit,
      p_before_recorded_at: before?.recordedAt ?? null,
      p_before_id: before?.id ?? null,
    });
    if (error) throw error;
    return mapLegacyAuditHistory(data);
  }

  async getInventoryOperation(operationId: string): Promise<FuelInventoryOperation | null> {
    const { data, error } = await supabase.rpc('get_fuel_inventory_operation', {
      p_operation_id: operationId,
    });
    if (error) throw error;
    return data ? mapInventoryOperation(data) : null;
  }

  async activateInventory(input: FuelInventoryActivationInput): Promise<FuelInventorySnapshot> {
    const effective = effectiveContext({
      effectiveAt: input.occurredAt,
      utcOffsetMinutes: input.utcOffsetMinutes,
    });
    const payload = {
      p_vessel_id: input.vesselId,
      p_effective_at: effective.effectiveAt,
      p_utc_offset_minutes: effective.utcOffsetMinutes,
      p_openings: activationOpenings(input),
      p_notes: input.notes?.trim() || '',
    };
    return idempotentFuelWrite(
      `activate:${input.vesselId}`,
      payload,
      input.idempotencyKey,
      async (requestId) => {
        const { data, error } = await supabase.rpc('activate_vessel_fuel_inventory', {
          ...payload,
          p_client_request_id: requestId,
        });
        if (error) throw error;
        return mapInventorySnapshot(data);
      }
    );
  }

  async amendOpeningInventory(
    input: FuelInventoryOpeningAmendmentInput
  ): Promise<FuelInventoryOperation> {
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new Error('Fuel opening revision must be a positive integer.');
    }
    if (!input.amendmentReason.trim()) throw new Error('The edit request is invalid.');
    const effective = effectiveContext({
      effectiveAt: input.occurredAt,
      utcOffsetMinutes: input.utcOffsetMinutes,
    });
    const payload = {
      p_operation_id: input.operationId,
      p_expected_revision: input.expectedRevision,
      p_effective_at: effective.effectiveAt,
      p_utc_offset_minutes: effective.utcOffsetMinutes,
      p_openings: input.entries.map((entry) => ({
        fuel_tank_id: entry.tankId,
        amount_litres: canonicalLitres(entry.amountLitres),
      })),
      p_notes: input.notes?.trim() || '',
      p_amendment_reason: input.amendmentReason.trim(),
    };
    return idempotentFuelWrite(
      `opening:amend:${input.operationId}`,
      payload,
      input.idempotencyKey,
      async (requestId) => {
        const { data, error } = await supabase.rpc('amend_fuel_inventory_opening', {
          ...payload,
          p_client_request_id: requestId,
        });
        if (error) throw error;
        return mapInventoryOperation(data);
      }
    );
  }

  async recordInventoryEntry(input: FuelInventoryEntryInput): Promise<FuelInventoryOperation> {
    const effective = effectiveContext({
      effectiveAt: input.occurredAt,
      utcOffsetMinutes: input.utcOffsetMinutes,
    });
    const payload = {
      p_vessel_id: input.vesselId,
      p_entry_type: input.kind,
      p_effective_at: effective.effectiveAt,
      p_utc_offset_minutes: effective.utcOffsetMinutes,
      p_fuel_tank_id: input.fuelTankId,
      p_amount_litres: inventoryEntryAmount(input),
      p_location: input.location?.trim() || '',
      p_reason: input.reason?.trim() || '',
      p_notes: input.notes?.trim() || '',
    };
    return idempotentFuelWrite(
      `entry:${input.vesselId}:${input.kind}:${input.fuelTankId}`,
      payload,
      input.idempotencyKey,
      async (requestId) => {
        const { data, error } = await supabase.rpc('record_fuel_inventory_entry', {
          ...payload,
          p_client_request_id: requestId,
        });
        if (error) throw error;
        return mapInventoryOperation(data);
      }
    );
  }

  async amendInventoryEntry(
    input: FuelInventoryEntryAmendmentInput
  ): Promise<FuelInventoryOperation> {
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new Error('Fuel inventory revision must be a positive integer.');
    }
    if (!input.amendmentReason.trim()) throw new Error('The edit request is invalid.');
    const effective = effectiveContext({
      effectiveAt: input.occurredAt,
      utcOffsetMinutes: input.utcOffsetMinutes,
    });
    const payload = {
      p_operation_id: input.operationId,
      p_expected_revision: input.expectedRevision,
      p_effective_at: effective.effectiveAt,
      p_utc_offset_minutes: effective.utcOffsetMinutes,
      p_amount_litres: inventoryEntryAmount(input),
      p_location: input.location?.trim() || '',
      p_entry_reason: input.reason?.trim() || '',
      p_notes: input.notes?.trim() || '',
      p_amendment_reason: input.amendmentReason.trim(),
    };
    return idempotentFuelWrite(
      `entry:amend:${input.operationId}`,
      payload,
      input.idempotencyKey,
      async (requestId) => {
        const { data, error } = await supabase.rpc('amend_fuel_inventory_entry', {
          ...payload,
          p_client_request_id: requestId,
        });
        if (error) throw error;
        return mapInventoryOperation(data);
      }
    );
  }

  async voidInventoryEntry(input: FuelInventoryEntryVoidInput): Promise<FuelInventoryOperation> {
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new Error('Fuel inventory revision must be a positive integer.');
    }
    if (!input.reason.trim()) throw new Error('The delete request is invalid.');
    const payload = {
      p_operation_id: input.operationId,
      p_expected_revision: input.expectedRevision,
      p_reason: input.reason.trim(),
    };
    return idempotentFuelWrite(
      `entry:void:${input.operationId}`,
      payload,
      input.idempotencyKey,
      async (requestId) => {
        const { data, error } = await supabase.rpc('void_fuel_inventory_entry', {
          ...payload,
          p_client_request_id: requestId,
        });
        if (error) throw error;
        return mapInventoryOperation(data);
      }
    );
  }

  async saveSetup(input: SaveFuelSetupInput): Promise<FuelSetup> {
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new Error('Fuel setup revision is invalid. Refresh the setup and try again.');
    }
    const normalizedNames = new Set<string>();
    const seenIds = new Set<string>();
    const tanks = input.tanks.map((tank) => {
      assertTankInput(tank);
      if (tank.id) {
        if (seenIds.has(tank.id)) throw new Error('Fuel setup contains duplicate tank IDs.');
        seenIds.add(tank.id);
      }
      const normalizedName = tank.name.trim().toLocaleLowerCase();
      if (normalizedNames.has(normalizedName)) {
        throw new Error('Fuel setup contains duplicate tank names.');
      }
      normalizedNames.add(normalizedName);
      return { id: tank.id ?? null, ...toTankRow(tank) };
    });

    const payload = {
      p_vessel_id: input.vesselId,
      p_volume_unit: input.volumeUnit,
      p_tanks: tanks,
      p_expected_revision: input.expectedRevision,
    };
    return idempotentFuelWrite(
      `setup:save:${input.vesselId}`,
      payload,
      input.idempotencyKey,
      async (requestId) => {
        const { data, error } = await supabase.rpc('save_vessel_fuel_setup', {
          ...payload,
          p_client_request_id: requestId,
        });
        if (error) throw error;
        const result = data as FuelSetupRpcResult;
        return setupFromRows(result.settings, result.tanks ?? []);
      }
    );
  }

  /** Read one retained tank row, including archived tanks needed by audit corrections. */
  async getTankById(id: string, vesselId: string): Promise<FuelTank | null> {
    const { data, error } = await supabase
      .from('fuel_tanks')
      .select('*')
      .eq('id', id)
      .eq('vessel_id', vesselId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapTank(data) : null;
  }

  async getLogTankEntries(fuelLogId: string): Promise<FuelLogTankEntry[]> {
    const { data, error } = await supabase
      .from('fuel_log_tank_entries')
      .select('*')
      .eq('fuel_log_id', fuelLogId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapLogTankEntry);
  }

  /**
   * Fetches the vessel display unit and immutable receipt allocation names.
   * Activated receipts use the current ledger revision's tank-name snapshots;
   * pre-ledger report rows use their retained allocation catalogue names.
   */
  async getFuelLogAllocationSnapshot(
    vesselId: string,
    fuelLogIds: readonly string[]
  ): Promise<FuelLogAllocationSnapshot> {
    const uniqueLogIds = [...new Set(fuelLogIds.filter(Boolean))];
    const batches: string[][] = [];
    for (let index = 0; index < uniqueLogIds.length; index += 100) {
      batches.push(uniqueLogIds.slice(index, index + 100));
    }
    const [settings, ...batchResponses] = await Promise.all([
      this.getSettings(vesselId),
      ...batches.map((ids) =>
        supabase.rpc('get_fuel_log_allocation_snapshot', {
          p_vessel_id: vesselId,
          p_fuel_log_ids: ids,
        })
      ),
    ]);

    const allocationsByLogId: FuelLogAllocationSnapshot['allocationsByLogId'] = {};
    for (const response of batchResponses) {
      if (response.error) throw response.error;
      const responseRow = asRow(response.data);
      for (const row of Array.isArray(responseRow.allocations) ? responseRow.allocations : []) {
        const allocation = mapLogTankAllocation(asRow(row));
        if (!allocation.fuelLogId) continue;
        (allocationsByLogId[allocation.fuelLogId] ??= []).push(allocation);
      }
    }

    return {
      displayUnit: settings?.volumeUnit ?? 'LITRES',
      allocationsByLogId,
    };
  }

  async createFuelLogWithTankEntries(input: CreateFuelLogWithTankEntriesInput): Promise<FuelLog> {
    if (!input.log.volumeUnit) {
      throw new Error('Tank-aware fuel logs require a volume unit.');
    }
    const priceVolumeUnit = input.log.priceVolumeUnit ?? input.log.volumeUnit;
    const entries = toLogEntries(input.entries);
    const deliveredLitres = entries.reduce(
      (total, entry) => total + Number(entry.amount_litres),
      0
    );
    const receiptAmount = decimal3(
      fromLitres(deliveredLitres, input.log.volumeUnit),
      'Fuel receipt amount'
    );
    const unitPrice = decimal4(input.log.pricePerGallon, 'Fuel receipt unit price');
    if (unitPrice <= 0) {
      throw new Error('Fuel receipt unit price must be greater than zero.');
    }
    const totalPrice = roundDecimal(fromLitres(deliveredLitres, priceVolumeUnit) * unitPrice, 2);
    const newTanks = (input.newTanks ?? []).map((tank) => {
      if (!tank.id) throw new Error('Each new fuel tank requires an ID.');
      assertTankInput(tank);
      const openingLitres = canonicalLitres(tank.openingLitres);
      if (openingLitres < 0 || openingLitres > tank.capacityLitres) {
        throw new Error('A new tank opening level must be between zero and its capacity.');
      }
      return {
        id: tank.id,
        ...toTankRow(tank),
        opening_litres: openingLitres,
      };
    });
    if (newTanks.length > 0) {
      if (
        input.expectedSetupRevision === undefined ||
        !Number.isInteger(input.expectedSetupRevision) ||
        input.expectedSetupRevision < 0
      ) {
        throw new Error('Adding tanks requires the current fuel setup revision.');
      }
      if (new Set(newTanks.map((tank) => tank.id)).size !== newTanks.length) {
        throw new Error('Each new fuel tank must be unique.');
      }
    }
    const effective = effectiveContext({
      effectiveAt: input.effectiveAt,
      utcOffsetMinutes: input.utcOffsetMinutes,
      date: input.log.logDate,
      time: input.log.logTime,
    });
    const payload = {
      p_log: {
        vessel_id: input.log.vesselId,
        location_of_refueling: input.log.locationOfRefueling.trim() || null,
        log_date: input.log.logDate,
        log_time: input.log.logTime,
        amount_of_fuel: receiptAmount,
        price_per_gallon: unitPrice,
        total_price: totalPrice,
        volume_unit: input.log.volumeUnit,
        price_volume_unit: priceVolumeUnit,
        currency_code: normalizeCurrencyCode(input.log.currencyCode),
        comment: input.log.comment?.trim() || '',
        effective_at: effective.effectiveAt,
        utc_offset_minutes: effective.utcOffsetMinutes,
      },
      p_entries: entries,
      p_new_tanks: newTanks,
      p_expected_setup_revision: newTanks.length > 0 ? input.expectedSetupRevision : null,
    };
    return idempotentFuelWrite(
      `receipt:create:${input.log.vesselId}`,
      payload,
      input.idempotencyKey,
      async (requestId) => {
        const { data, error } = await supabase.rpc('create_fuel_receipt_with_tanks', {
          ...payload,
          p_log: { ...payload.p_log, client_request_id: requestId },
        });
        if (error) throw error;
        return mapFuelLog(data);
      }
    );
  }

  async updateFuelLogWithTankEntries(
    id: string,
    input: UpdateFuelLogWithTankEntriesInput
  ): Promise<void> {
    const hasEffectiveAt = input.effectiveAt !== undefined;
    const hasUtcOffset = input.utcOffsetMinutes !== undefined;
    const hasLocalDate = input.log.logDate !== undefined;
    const hasLocalTime = input.log.logTime !== undefined;
    const hasAnyEventContext = hasEffectiveAt || hasUtcOffset || hasLocalDate || hasLocalTime;
    if (hasLocalDate !== hasLocalTime) {
      throw new Error('Fuel receipt amendments must supply ship date and time together.');
    }
    if (
      hasAnyEventContext &&
      (!hasUtcOffset || (!hasEffectiveAt && !(hasLocalDate && hasLocalTime)))
    ) {
      throw new Error('Fuel receipt amendments must include a valid recorded event time.');
    }
    const patch: Record<string, unknown> = {};
    if (input.log.locationOfRefueling !== undefined)
      patch.location_of_refueling = input.log.locationOfRefueling.trim() || null;
    if (input.log.logDate !== undefined) patch.log_date = input.log.logDate;
    if (input.log.logTime !== undefined) patch.log_time = input.log.logTime;
    if (input.log.amountOfFuel !== undefined) {
      patch.amount_of_fuel = decimal3(input.log.amountOfFuel, 'Fuel receipt amount');
    }
    if (input.log.pricePerGallon !== undefined) patch.price_per_gallon = input.log.pricePerGallon;
    if (input.log.totalPrice !== undefined) patch.total_price = input.log.totalPrice;
    if (input.log.volumeUnit !== undefined) patch.volume_unit = input.log.volumeUnit;
    if (input.log.priceVolumeUnit !== undefined)
      patch.price_volume_unit = input.log.priceVolumeUnit;
    if (input.log.currencyCode !== undefined)
      patch.currency_code = normalizeCurrencyCode(input.log.currencyCode);
    if (input.log.comment !== undefined) patch.comment = input.log.comment.trim();
    if (hasAnyEventContext) {
      const effective = effectiveContext({
        effectiveAt: input.effectiveAt,
        utcOffsetMinutes: input.utcOffsetMinutes,
        date: input.log.logDate,
        time: input.log.logTime,
      });
      patch.effective_at = effective.effectiveAt;
      patch.utc_offset_minutes = effective.utcOffsetMinutes;
    }
    if (input.amendmentReason !== undefined) {
      patch.amendment_reason = input.amendmentReason.trim();
    }
    if (input.expectedRevision !== undefined) {
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
        throw new Error('Fuel log revision must be a non-negative integer.');
      }
      patch.expected_revision = input.expectedRevision;
    }

    const payload = {
      p_fuel_log_id: id,
      p_vessel_id: input.vesselId,
      p_log_patch: patch,
      // The server permits [] only when preserving a genuinely unallocated
      // pre-ledger receipt. Ledger-aware records still require allocations.
      p_entries: toLogEntries(input.entries, true),
    };
    await idempotentFuelWrite(
      `receipt:amend:${id}`,
      payload,
      input.idempotencyKey,
      async (requestId) => {
        const { error } = await supabase.rpc('update_fuel_log_with_tank_entries', {
          ...payload,
          p_log_patch: { ...patch, client_request_id: requestId },
        });
        if (error) throw error;
      }
    );
  }

  async voidFuelLog(id: string, options: VoidFuelLogOptions): Promise<void> {
    const expectedRevision = options.expectedRevision;
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error('Fuel log revision is invalid.');
    }
    const reason = options.reason.trim();
    if (!reason) throw new Error('The delete request is invalid.');
    const payload = {
      p_fuel_log_id: id,
      p_expected_revision: expectedRevision,
      p_reason: reason,
    };
    await idempotentFuelWrite(
      `receipt:void:${id}`,
      payload,
      options.idempotencyKey,
      async (requestId) => {
        const { error } = await supabase.rpc('void_fuel_log', {
          ...payload,
          p_client_request_id: requestId,
        });
        if (error) throw error;
      }
    );
  }

  async getTransfersByVessel(vesselId: string): Promise<FuelTransfer[]> {
    const { data, error } = await supabase.rpc('get_fuel_transfers_with_snapshots', {
      p_vessel_id: vesselId,
    });
    if (error) throw error;
    const result = asRow(data);
    return (Array.isArray(result.transfers) ? result.transfers : []).map((row) =>
      mapTransfer(asRow(row))
    );
  }

  async getTransferById(id: string): Promise<FuelTransfer | null> {
    const { data, error } = await supabase
      .from('fuel_transfers')
      .select(FUEL_TRANSFER_READ_SELECT)
      .eq('id', id)
      .is('voided_at', null)
      .maybeSingle();
    if (error) throw error;
    return data ? mapTransfer(data) : null;
  }

  async createTransfer(input: FuelTransferInput): Promise<FuelTransfer> {
    const payload = { p_transfer: transferPayload(input) };
    return idempotentFuelWrite(
      `transfer:create:${input.vesselId}`,
      payload,
      input.idempotencyKey,
      async (requestId) => {
        const { data, error } = await supabase.rpc('record_fuel_transfer', {
          ...payload,
          p_client_request_id: requestId,
        });
        if (error) throw error;
        return mapTransfer(rpcResultRow(data, 'transfer'));
      }
    );
  }

  async updateTransfer(id: string, input: FuelTransferInput): Promise<void> {
    const expectedRevision = input.expectedRevision;
    if (
      expectedRevision === undefined ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 0
    ) {
      throw new Error('Fuel transfer revision is invalid.');
    }
    if (input.effectiveAt === undefined || input.utcOffsetMinutes === undefined) {
      throw new Error('Fuel transfer amendments require a valid recorded event time.');
    }
    const reason = input.amendmentReason?.trim() || '';
    if (!reason) throw new Error('The edit request is invalid.');
    const payload = {
      p_fuel_transfer_id: id,
      p_expected_revision: expectedRevision,
      p_transfer: transferPayload(input),
      p_reason: reason,
    };
    await idempotentFuelWrite(
      `transfer:amend:${id}`,
      payload,
      input.idempotencyKey,
      async (requestId) => {
        const { error } = await supabase.rpc('amend_fuel_transfer', {
          ...payload,
          p_client_request_id: requestId,
        });
        if (error) throw error;
      }
    );
  }

  async deleteTransfer(id: string, options: VoidFuelTransferOptions): Promise<void> {
    const expectedRevision = options.expectedRevision;
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error('Fuel transfer revision is invalid.');
    }
    const reason = options.reason.trim();
    if (!reason) throw new Error('The delete request is invalid.');
    const payload = {
      p_fuel_transfer_id: id,
      p_expected_revision: expectedRevision,
      p_reason: reason,
    };
    await idempotentFuelWrite(
      `transfer:void:${id}`,
      payload,
      options.idempotencyKey,
      async (requestId) => {
        const { error } = await supabase.rpc('void_fuel_transfer', {
          ...payload,
          p_client_request_id: requestId,
        });
        if (error) throw error;
      }
    );
  }

  async getTankBalances(vesselId: string): Promise<FuelTankBalance[]> {
    const snapshot = await this.getInventorySnapshot(vesselId);
    return snapshot.tanks.map((tankSnapshot) => {
      // Existing transfer screens require numeric fields. New inventory screens
      // must use getInventorySnapshot so an unknown balance remains null.
      const recordedVolumeLitres = tankSnapshot.balanceLitres ?? 0;
      return {
        tank: tankSnapshot.tank,
        recordedVolumeLitres,
        remainingCapacityLitres:
          tankSnapshot.remainingCapacityLitres ?? tankSnapshot.tank.capacityLitres,
        isInitialized: tankSnapshot.initialized,
        lastVerifiedAt: tankSnapshot.lastVerifiedAt,
        lastVerificationKind: tankSnapshot.lastVerificationKind,
      };
    });
  }
}

export const fuelManagementService = new FuelManagementService();

export default fuelManagementService;
