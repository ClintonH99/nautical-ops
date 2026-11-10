import type { RecordValue } from './outbox';
export function flattenFuel(v: RecordValue): RecordValue {
  const fields = v.fields as RecordValue;
  return {
    ...(v.server as RecordValue),
    ...fields,
    id: v.id,
    vessel_id: v.vessel_id,
    source_id: v.source_id,
    entries: v.entries,
    offlineLocalVersion: v.offlineLocalVersion ?? 0,
    offlinePending: v.offlinePending ?? false,
  };
}
export function entryProjection(v: RecordValue): RecordValue {
  const f = v.fields as RecordValue,
    s = v.server as RecordValue;
  return {
    ...s,
    id: v.id,
    vessel_id: v.vessel_id,
    operation_type: f.operation_type,
    effective_at: f.effective_at,
    utc_offset_minutes: f.utc_offset_minutes,
    revision_no: s.revision_no ?? 1,
    logical_operation_id: s.logical_operation_id ?? v.id,
    recorded_sequence: s.recorded_sequence ?? 0,
    effective_order: s.effective_order ?? 0,
    metadata: {
      ...(s.metadata as RecordValue),
      location: f.location,
      reason: f.reason,
      notes: f.notes,
    },
    postings: [
      {
        fuel_tank_id: f.fuel_tank_id,
        posting_mode: f.operation_type === 'SOUNDING' ? 'ABSOLUTE' : 'DELTA',
        amount_litres:
          f.operation_type === 'CONSUMPTION' ? -Number(f.amount_litres) : f.amount_litres,
      },
    ],
    offlineLocalVersion: v.offlineLocalVersion ?? 0,
    offlinePending: v.offlinePending ?? false,
  };
}
