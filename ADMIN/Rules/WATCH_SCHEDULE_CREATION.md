# Watch Schedule creation

- On a shared vessel, only HOD and CAPTAIN_MOV can create watch schedules.
- CREW onboard a shared vessel must not see Create Watch Schedule and cannot use the creation form or publish endpoint.
- CREW not onboard a shared vessel can create schedules in their private Crew Account workspace (`vessels.is_solo = true`). A vessel ID alone does not establish onboard membership.
- Use `useWatchScheduleCreationAccess` for the hub and create form. Unknown personal-workspace status does not grant creation access.
- INSERT RLS enforces current vessel access and the personal workspace exception. Existing edit/delete and Watch Keeping Rules permissions are unchanged.
