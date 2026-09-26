/**
 * Role-based access helpers (MOV = Master of Vessel, stored as Captain position in profile).
 */

import { User } from '../types';

export function isMasterOfVessel(user: User | null | undefined): boolean {
  return user?.role === 'CAPTAIN_MOV';
}

/** Presentation only; the create_captain_vessel RPC independently enforces this. */
export function canCreateNewVessel(user: User | null | undefined): boolean {
  return (
    !!user && (user.vesselCreationUnlocked === true || (isMasterOfVessel(user) && !user.vesselId))
  );
}

/** Drop old-vessel screens after departure; complete creation in subscription setup. */
export function vesselTransitionRoute(
  previous: User | null,
  next: User | null
): 'MainTabs' | 'VesselSettings' | null {
  if (!previous || !next || previous.id !== next.id || previous.vesselId === next.vesselId)
    return null;
  if (next.vesselCreationUnlocked) return 'MainTabs';
  if (
    next.role === 'CAPTAIN_MOV' &&
    next.vesselId &&
    (!previous.vesselId || previous.vesselCreationUnlocked)
  )
    return 'VesselSettings';
  return null;
}

/** Department color settings: MOV (captain/master) and HOD only */
export function canAccessDepartmentColorSettings(user: User | null | undefined): boolean {
  return user?.role === 'HOD' || isMasterOfVessel(user);
}

/** Vessel Plans, Vessel Settings, Crew Management — MOV only */
export function canAccessVesselManagement(user: User | null | undefined): boolean {
  return isMasterOfVessel(user);
}
