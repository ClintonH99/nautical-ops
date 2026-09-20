import type { CrewLeave } from '../types';

export type CrewLeaveStatus = 'CURRENT' | 'UPCOMING' | 'COMPLETED';
export type CrewLeaveStatusFilter = 'ACTIVE' | CrewLeaveStatus | 'ALL';

export function getCrewLeaveStatus(
  leave: Pick<CrewLeave, 'startDate' | 'endDate'>,
  today: string
): CrewLeaveStatus {
  if (leave.endDate < today) return 'COMPLETED';
  if (leave.startDate > today) return 'UPCOMING';
  return 'CURRENT';
}

export function getCrewLeaveStatusLabel(status: CrewLeaveStatus): string {
  if (status === 'CURRENT') return 'Currently on leave';
  if (status === 'UPCOMING') return 'Upcoming';
  return 'Completed';
}

export function sortCrewLeave(leave: readonly CrewLeave[], today: string): CrewLeave[] {
  const statusRank: Record<CrewLeaveStatus, number> = {
    CURRENT: 0,
    UPCOMING: 1,
    COMPLETED: 2,
  };

  return [...leave].sort((left, right) => {
    const leftStatus = getCrewLeaveStatus(left, today);
    const rightStatus = getCrewLeaveStatus(right, today);
    const rankDifference = statusRank[leftStatus] - statusRank[rightStatus];
    if (rankDifference !== 0) return rankDifference;

    if (leftStatus === 'CURRENT') {
      const endDifference = left.endDate.localeCompare(right.endDate);
      if (endDifference !== 0) return endDifference;
    } else if (leftStatus === 'UPCOMING') {
      const startDifference = left.startDate.localeCompare(right.startDate);
      if (startDifference !== 0) return startDifference;
    } else {
      const endDifference = right.endDate.localeCompare(left.endDate);
      if (endDifference !== 0) return endDifference;
    }

    const nameDifference = left.crewMemberName.localeCompare(right.crewMemberName);
    return nameDifference !== 0 ? nameDifference : left.id.localeCompare(right.id);
  });
}

export function getCrewLeaveMonthRange(year: number, month: number) {
  const safeMonth = Math.min(12, Math.max(1, Math.trunc(month)));
  const monthText = String(safeMonth).padStart(2, '0');
  const finalDay = new Date(year, safeMonth, 0).getDate();
  return {
    startDate: `${year}-${monthText}-01`,
    endDate: `${year}-${monthText}-${String(finalDay).padStart(2, '0')}`,
  };
}
