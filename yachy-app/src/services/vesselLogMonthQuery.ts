import { supabase } from './supabase';
import { logMonthBounds } from '../utils/vesselLogHistory';

type LogTable = 'general_waste_logs' | 'fuel_logs' | 'pump_out_logs';
const PAGE_SIZE = 500;

/** Read-only archive: no copies, resets or changes to the saved entries. */
export async function getVesselLogMonthRows(table: LogTable, vesselId: string, month: string) {
  const { start, end } = logMonthBounds(month);
  const rows: any[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase
      .from(table)
      .select('*')
      .eq('vessel_id', vesselId)
      .gte('created_at', start)
      .lt('created_at', end);
    if (table === 'fuel_logs') query = query.is('voided_at', null);
    const { data, error } = await query
      .order('log_date', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}
