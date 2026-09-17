# Shipyard Records

## Lifecycle

- `Active Jobs` contains every Shipyard Job that is not completed.
- Any active vessel user may mark an active job complete.
- Completion records the user's name, user ID and timestamp.
- A completed job leaves the active list and calendar, then remains permanently in `Shipyard Records` unless an authorised user explicitly deletes it.
- Captain/MOV and HOD users may use `Unmark Complete` to return a record to Active Jobs. This clears its completion details and folder assignment.

## Completed-record permissions

- Every active vessel user can view and search records from every department.
- Only Captain/MOV can edit the information in a completed record.
- Captain/MOV and HOD users can permanently delete completed records.
- Crew and Management users cannot edit, delete or unmark completed records.

## Folders

- Folders belong to the vessel, not to a department.
- Every active vessel user can create, rename and delete folders.
- Every newly completed record starts in `Unfiled`.
- Creating or selecting a folder never moves records automatically.
- Every active vessel user can explicitly move a record into any folder for that vessel.
- Deleting a folder never deletes its records. Its records become `Unfiled`.
- A completed record can belong to at most one folder.

## Rollout compatibility

- The database temporarily retains the old folder `department` field as nullable and deprecated so already-released app versions continue to work.
- Folder names, placement and navigation are vessel-wide even when an older client supplies that legacy value.
- A later forward migration may physically remove the field only after old binaries are outside the supported release window.

## Tasks

- Captain/MOV and HOD users can unmark a completed one-off task and return it to its active category.
- Recurring tasks are rescheduled in place when marked complete, so they do not appear in Completed Tasks and are not duplicated by this feature.
