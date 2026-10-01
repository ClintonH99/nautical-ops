import { notificationDestination } from '../../src/utils/notificationDestination';
it('ignores notifications from a vessel the user has left',()=>{
  expect(notificationDestination({vesselId:'old',screen:'MaintenanceLog'},'new')).toBeNull();
});
it('does not accept an arbitrary push route',()=>{
  expect(notificationDestination({screen:'DeleteAccount'},'v')).toBeNull();
});
it('preserves legacy checklist and crew leave links',()=>{
  expect(notificationDestination({crewLeaveId:'l'})).toEqual({screen:'CrewLeave'});
  expect(notificationDestination({checklistId:'c'})).toEqual({screen:'ViewPreDepartureChecklist',params:{checklistId:'c'}});
});
it('opens the selected published watch schedule',()=>{
  expect(notificationDestination({screen:'WatchSchedule',timetableId:'w'})).toEqual({screen:'WatchSchedule',params:{timetableId:'w'}});
});
it('opens the correct task category and validates it',()=>{
  expect(notificationDestination({screen:'TasksList',category:'WEEKLY'})?.params).toEqual({category:'WEEKLY'});
  expect(notificationDestination({screen:'TasksList',category:'invalid'})?.params).toEqual({category:'DAILY'});
});
