import type { RecordValue } from './outbox';
const rows = (v: unknown): RecordValue[] => (Array.isArray(v) ? (v as RecordValue[]) : []);
/** Replays only confirmed ledger postings. Receipts do not change inventory. */
export function fuelSnapshot(context: RecordValue, asOf = new Date().toISOString()): RecordValue {
  const instant = Date.parse(asOf);
  if (!Number.isFinite(instant)) throw new Error('Inventory as-of time is invalid.');
  const operations = rows(context.operations)
    .filter((o) => !o.voided && Date.parse(String(o.effective_at)) <= instant)
    .sort(
      (a, b) =>
        Date.parse(String(a.effective_at)) - Date.parse(String(b.effective_at)) ||
        Number(a.effective_order) - Number(b.effective_order) ||
        Number(a.recorded_sequence) - Number(b.recorded_sequence)
    );
  const tanks = rows(context.tanks)
    .filter(
      (t) =>
        Math.floor(Date.parse(String(t.created_at)) / 60000) * 60000 <= instant &&
        (!t.archived_at || Date.parse(String(t.archived_at)) > instant)
    )
    .map((t): RecordValue => {
      let balance: number | null = null,
        last: RecordValue | null = null,
        verified: RecordValue | null = null;
      for (const op of operations)
        for (const p of rows(op.postings).filter((p) => p.fuel_tank_id === t.id)) {
          if (p.posting_mode === 'ABSOLUTE') {
            balance = Number(p.amount_litres);
            verified = op;
          } else if (balance !== null)
            balance = Math.round((balance + Number(p.amount_litres)) * 1000) / 1000;
          last = op;
        }
      return {
        ...t,
        initialized: balance !== null,
        balance_litres: balance,
        remaining_capacity_litres:
          balance === null ? null : Math.round((Number(t.capacity_litres) - balance) * 1000) / 1000,
        last_verified_at: verified?.effective_at ?? null,
        last_verified_type: verified?.operation_type ?? null,
        last_verified_utc_offset_minutes: verified?.utc_offset_minutes ?? null,
        last_activity_at: last?.effective_at ?? null,
      };
    })
    .sort(
      (a, b) =>
        String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase()) ||
        String(a.id).localeCompare(String(b.id))
    );
  const setup = context.setup as RecordValue,
    settings = (setup.settings ?? {}) as RecordValue;
  const activated =
    !!settings.inventory_activated_at &&
    Date.parse(String(settings.inventory_activated_at)) <= instant;
  const complete = tanks.length > 0 && tanks.every((t) => t.initialized);
  return {
    vessel_id: context.vessel_id,
    as_of: asOf,
    settings: {
      volume_unit: settings.volume_unit ?? 'LITRES',
      inventory_activated_at: activated ? settings.inventory_activated_at : null,
    },
    status: { activated, fully_initialized: activated && complete },
    tanks,
    total_capacity_litres: tanks.reduce((s, t) => s + Number(t.capacity_litres), 0),
    total_balance_litres: complete
      ? Math.round(tanks.reduce((s, t) => s + Number(t.balance_litres), 0) * 1000) / 1000
      : null,
    offlineDownloadedAt: context.downloaded_at,
  };
}
