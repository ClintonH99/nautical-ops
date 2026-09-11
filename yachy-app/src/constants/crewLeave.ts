import type { CrewLeaveType } from '../types';

export const CREW_LEAVE_TYPES: CrewLeaveType[] = ['ANNUAL', 'SICK', 'ROTATION', 'OTHER'];

export const CREW_LEAVE_LABELS: Record<CrewLeaveType, string> = {
  ANNUAL: 'Annual Leave',
  SICK: 'Sick Leave',
  ROTATION: 'Rotation Leave',
  OTHER: 'Other',
};

export const CREW_LEAVE_SHORT_LABELS: Record<CrewLeaveType, string> = {
  ANNUAL: 'Annual',
  SICK: 'Sick',
  ROTATION: 'Rotation',
  OTHER: 'Other',
};

export const CREW_LEAVE_COLORS: Record<CrewLeaveType, string> = {
  ANNUAL: '#38BDF8',
  SICK: '#FB7185',
  ROTATION: '#2DD4BF',
  OTHER: '#A78BFA',
};
