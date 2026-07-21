/**
 * Role-based access helpers (MOV = Master of Vessel, stored as Captain position in profile).
 */

import { User } from '../types';

export function isMasterOfVessel(user: User | null | undefined): boolean {
  return user?.role === 'CAPTAIN_MOV';
}

/** Department color settings: MOV (captain/master) and HOD only */
export function canAccessDepartmentColorSettings(user: User | null | undefined): boolean {
  return user?.role === 'HOD' || isMasterOfVessel(user);
}

/** Vessel Plans, Vessel Settings, Crew Management — MOV only */
export function canAccessVesselManagement(user: User | null | undefined): boolean {
  return isMasterOfVessel(user);
}
