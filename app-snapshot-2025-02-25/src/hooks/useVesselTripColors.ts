/**
 * Hook to load vessel trip colors (custom or defaults) for calendar and list screens
 */

import { useState, useCallback } from 'react';
import tripColorsService, { VesselTripColors } from '../services/tripColors';

export function useVesselTripColors(vesselId: string | null) {
  const [colors, setColors] = useState<VesselTripColors | null>(null);

  const load = useCallback(async () => {
    if (!vesselId) {
      setColors(null);
      return;
    }
    try {
      const c = await tripColorsService.getColors(vesselId);
      setColors(c);
    } catch (e) {
      setColors(null);
    }
  }, [vesselId]);

  return { colors, load };
}

/** Map VesselTripColors to trip type key (for calendar marking) */
export function getTripTypeColorMap(colors: VesselTripColors): Record<string, string> {
  return {
    GUEST: colors.guest,
    BOSS: colors.boss,
    DELIVERY: colors.delivery,
    YARD_PERIOD: colors.yardPeriod,
  };
}
