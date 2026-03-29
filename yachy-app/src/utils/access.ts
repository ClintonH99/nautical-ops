/**
 * Role-based access helpers (MOV = Master of Vessel, stored as Captain position in profile).
 */

import { User } from '../types';

export function isMasterOfVessel(user: User | null | undefined): boolean {
  return !!user?.position?.toLowerCase().includes('captain');
}

/** Department color settings: MOV (captain) and HOD only */
export function canAccessDepartmentColorSettings(user: User | null | undefined): boolean {
  return user?.role === 'HOD' || isMasterOfVessel(user);
}
