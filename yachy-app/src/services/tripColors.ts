/**
 * Trip Colors Service
 * Vessel-specific colors for trip types (Guest, Boss, Delivery, Yard Period). HOD can edit.
 */

import { supabase } from './supabase';
import { COLORS } from '../constants/theme';

export interface VesselTripColors {
  guest: string;
  boss: string;
  delivery: string;
  yardPeriod: string;
  multiple: string; // fixed, not editable
}

const DEFAULT_COLORS: VesselTripColors = {
  guest: COLORS.guestTripColor,
  boss: COLORS.bossTripColor,
  delivery: COLORS.deliveryTripColor,
  yardPeriod: COLORS.yardPeriodColor,
  multiple: COLORS.dutyColor,
};

function rowToColors(row: any): VesselTripColors {
  return {
    guest: row?.guest_trip_color ?? DEFAULT_COLORS.guest,
    boss: row?.boss_trip_color ?? DEFAULT_COLORS.boss,
    delivery: row?.delivery_trip_color ?? DEFAULT_COLORS.delivery,
    yardPeriod: row?.yard_period_color ?? DEFAULT_COLORS.yardPeriod,
    multiple: DEFAULT_COLORS.multiple,
  };
}

class TripColorsService {
  /**
   * Get trip colors for a vessel (custom or defaults)
   */
  async getColors(vesselId: string): Promise<VesselTripColors> {
    try {
      const { data, error } = await supabase
        .from('vessel_trip_colors')
        .select('*')
        .eq('vessel_id', vesselId)
        .maybeSingle();

      if (error) throw error;
      return rowToColors(data);
    } catch (error: any) {
      // Table may not exist yet (PGRST205) — use defaults without surfacing error
      if (error?.code === 'PGRST205') {
        return { ...DEFAULT_COLORS };
      }
      console.error('Get trip colors error:', error);
      return { ...DEFAULT_COLORS };
    }
  }

  /**
   * Update one or more trip type colors (HOD only in UI)
   */
  async setColors(
    vesselId: string,
    updates: Partial<Pick<VesselTripColors, 'guest' | 'boss' | 'delivery' | 'yardPeriod'>>
  ): Promise<VesselTripColors> {
    try {
      const payload: any = {
        vessel_id: vesselId,
        updated_at: new Date().toISOString(),
      };
      if (updates.guest !== undefined) payload.guest_trip_color = updates.guest;
      if (updates.boss !== undefined) payload.boss_trip_color = updates.boss;
      if (updates.delivery !== undefined) payload.delivery_trip_color = updates.delivery;
      if (updates.yardPeriod !== undefined) payload.yard_period_color = updates.yardPeriod;

      const { data, error } = await supabase
        .from('vessel_trip_colors')
        .upsert(payload, { onConflict: 'vessel_id' })
        .select()
        .single();

      if (error) throw error;
      return rowToColors(data);
    } catch (error) {
      console.error('Set trip colors error:', error);
      throw error;
    }
  }
}

export default new TripColorsService();
export { DEFAULT_COLORS };
