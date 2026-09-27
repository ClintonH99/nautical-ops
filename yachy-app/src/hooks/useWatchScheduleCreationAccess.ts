import { useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuthStore } from '../store';
import vesselService from '../services/vessel';
import { useScreenState } from './useScreenState';

/** Personal Crew workspaces have a vessel ID but are not an onboard membership. */
export function useWatchScheduleCreationAccess() {
  const { user } = useAuthStore();
  const vesselId = user?.vesselId;
  const isManager = user?.role === 'HOD' || user?.role === 'CAPTAIN_MOV';
  const isCrew = user?.role === 'CREW';
  const [isSolo, setIsSolo] = useScreenState<boolean | null>('watchScheduleSoloAccess', null);
  useFocusEffect(
    useCallback(() => {
      if (!vesselId || !isCrew) return;
      let active = true;
      void vesselService.getVessel(vesselId).then((vessel) => {
        if (active) setIsSolo(vessel?.isSolo === true);
      });
      return () => {
        active = false;
      };
    }, [vesselId, isCrew, setIsSolo])
  );
  return {
    canCreate: !!vesselId && (isManager || (isCrew && isSolo === true)),
    checking: !!vesselId && isCrew && isSolo === null,
  };
}
