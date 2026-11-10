import type { OfflineAdapter, RecordValue } from './outbox';
export const fuelFeatures = ['fuelLogs', 'fuelTransfers', 'fuelEntries'] as const;
export type FuelFeature = (typeof fuelFeatures)[number];
export const fuelFields = {
  fuelLogs: [
    'location_of_refueling',
    'log_date',
    'log_time',
    'amount_of_fuel',
    'price_per_gallon',
    'total_price',
    'volume_unit',
    'price_volume_unit',
    'currency_code',
    'comment',
    'effective_at',
    'utc_offset_minutes',
  ],
  fuelTransfers: [
    'source_tank_id',
    'destination_tank_id',
    'amount_litres',
    'transfer_date',
    'transfer_time',
    'location',
    'notes',
    'effective_at',
    'utc_offset_minutes',
  ],
  fuelEntries: [
    'operation_type',
    'effective_at',
    'utc_offset_minutes',
    'fuel_tank_id',
    'amount_litres',
    'location',
    'reason',
    'notes',
  ],
} as const;
const object = (v: unknown): v is RecordValue => !!v && typeof v === 'object' && !Array.isArray(v);
export function fuelAdapter(feature: FuelFeature): OfflineAdapter {
  return {
    serverFields: ['source_id', 'server'],
    mergeField(key, before, next, online) {
      if (key !== 'fields' || !object(before) || !object(next) || !object(online)) return undefined;
      const result = { ...online };
      for (const k of Object.keys(next))
        if (JSON.stringify(before[k]) !== JSON.stringify(next[k])) {
          if (
            JSON.stringify(online[k]) !== JSON.stringify(before[k]) &&
            JSON.stringify(online[k]) !== JSON.stringify(next[k])
          )
            return { value: online, conflict: true };
          result[k] = next[k];
        }
      return { value: result, conflict: false };
    },
    authorizeRead: (scope, v) => v.vessel_id === scope.vesselId,
    authorize: (scope, kind, v, old, context) =>
      v.vessel_id === scope.vesselId &&
      (kind === 'create' ? v.source_id === null : !!old && old.value.source_id === v.source_id) &&
      (!(
        feature === 'fuelEntries' &&
        object(v.fields) &&
        v.fields.operation_type === 'ADJUSTMENT'
      ) ||
        context?.permit?.claims.permissions.fuelAdjustments?.includes('create') === true),
    validate(v) {
      if (
        Object.keys(v).some(
          (k) =>
            ![
              'id',
              'vessel_id',
              'source_id',
              'fields',
              'entries',
              'server',
              'amendment_reason',
            ].includes(k)
        ) ||
        typeof v.id !== 'string' ||
        typeof v.vessel_id !== 'string' ||
        !(v.source_id === null || typeof v.source_id === 'string') ||
        !object(v.fields) ||
        !object(v.server) ||
        typeof v.amendment_reason !== 'string' ||
        !Array.isArray(v.entries)
      )
        return false;
      const f = v.fields,
        allowed: readonly string[] = fuelFields[feature];
      if (
        allowed.some((k) => !(k in f)) ||
        Object.keys(f).some((k) => !allowed.includes(k)) ||
        !(
          f.effective_at === null ||
          (typeof f.effective_at === 'string' && Number.isFinite(Date.parse(f.effective_at)))
        ) ||
        !(
          f.utc_offset_minutes === null ||
          (Number.isInteger(f.utc_offset_minutes) && Math.abs(Number(f.utc_offset_minutes)) <= 840)
        )
      )
        return false;
      const numbers =
        feature === 'fuelLogs'
          ? ['amount_of_fuel', 'price_per_gallon', 'total_price']
          : ['amount_litres'];
      if (numbers.some((k) => typeof f[k] !== 'number' || !Number.isFinite(f[k]))) return false;
      if (feature === 'fuelLogs')
        return (
          ['LITRES', 'US_GALLONS', null].includes(f.volume_unit as string | null) &&
          ['LITRES', 'US_GALLONS', null].includes(f.price_volume_unit as string | null) &&
          /^[A-Z]{3}$/.test(String(f.currency_code)) &&
          Number(f.amount_of_fuel) > 0 &&
          Number(f.price_per_gallon) >= 0 &&
          Number(f.total_price) >= 0 &&
          v.entries.every(
            (e) =>
              object(e) &&
              Object.keys(e).every((k) => ['fuel_tank_id', 'amount_litres'].includes(k)) &&
              typeof e.fuel_tank_id === 'string' &&
              typeof e.amount_litres === 'number' &&
              Number.isFinite(e.amount_litres) &&
              e.amount_litres > 0
          )
        );
      if (v.entries.length) return false;
      if (feature === 'fuelTransfers')
        return (
          typeof f.source_tank_id === 'string' &&
          typeof f.destination_tank_id === 'string' &&
          f.source_tank_id !== f.destination_tank_id &&
          Number(f.amount_litres) > 0
        );
      return (
        ['SOUNDING', 'CONSUMPTION', 'ADJUSTMENT'].includes(String(f.operation_type)) &&
        typeof f.fuel_tank_id === 'string' &&
        (f.operation_type === 'SOUNDING'
          ? Number(f.amount_litres) >= 0
          : f.operation_type === 'CONSUMPTION'
            ? Number(f.amount_litres) > 0
            : Number(f.amount_litres) !== 0)
      );
    },
  };
}
