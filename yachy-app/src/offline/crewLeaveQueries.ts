import type { CrewLeave } from '../types';
import type { CrewLeaveFilters, CrewLeavePage } from '../services/crewLeave';
import { sortCrewLeave } from '../utils/crewLeave.ts';
export function selectOfflineLeavePage(
  rows: CrewLeave[],
  filters: CrewLeaveFilters & { asOfDate: string },
  offset: number,
  size: number
): CrewLeavePage {
  const today = filters.asOfDate,
    status = filters.status ?? 'ACTIVE';
  const matching = rows.filter(
    (r) =>
      (!filters.leaveType || r.leaveType === filters.leaveType) &&
      (!filters.departments?.length ||
        r.crewMemberDepartments.some((d) => filters.departments!.includes(d))) &&
      (status === 'ACTIVE'
        ? r.endDate >= today
        : status === 'CURRENT'
          ? r.startDate <= today && r.endDate >= today
          : status === 'UPCOMING'
            ? r.startDate > today
            : status === 'COMPLETED'
              ? r.endDate < today
              : true)
  );
  matching.sort((a, b) => {
    const order =
      status === 'CURRENT'
        ? a.endDate.localeCompare(b.endDate)
        : status === 'COMPLETED'
          ? b.endDate.localeCompare(a.endDate)
          : status === 'ALL'
            ? b.startDate.localeCompare(a.startDate)
            : a.startDate.localeCompare(b.startDate);
    return order || b.id.localeCompare(a.id);
  });
  return {
    items: sortCrewLeave(matching.slice(offset, offset + size), today),
    hasMore: matching.length > offset + size,
  };
}
