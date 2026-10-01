/** Allowlisted destinations only; push content never supplies arbitrary routes. */
export function notificationDestination(data: Record<string, unknown>, vesselId?: string | null): { screen: string; params?: Record<string, string> } | null {
  if (typeof data.vesselId === 'string' && data.vesselId !== vesselId) return null;
  if (typeof data.crewLeaveId === 'string') return { screen: 'CrewLeave' };
  if (typeof data.checklistId === 'string') {
    return { screen: 'ViewPreDepartureChecklist', params: { checklistId: data.checklistId } };
  }
  switch (data.screen) {
    case 'TasksList':
      return { screen: 'TasksList', params: { category: ['DAILY','WEEKLY','MONTHLY'].includes(String(data.category)) ? String(data.category) : 'DAILY' } };
    case 'MaintenanceLog': return { screen: 'MaintenanceLog' };
    case 'YardPeriodJobs': return { screen: 'YardPeriodJobs' };
    case 'WatchSchedule': return typeof data.timetableId === 'string'
      ? { screen: 'WatchSchedule', params: { timetableId: data.timetableId } } : { screen: 'WatchSchedule' };
    case 'UpcomingTrips': return { screen: 'UpcomingTrips' };
    default:
      // Existing trip pushes have kind/tripId; don't route arbitrary payloads.
      return typeof data.tripId === 'string' ? { screen: 'UpcomingTrips' } : null;
  }
}
