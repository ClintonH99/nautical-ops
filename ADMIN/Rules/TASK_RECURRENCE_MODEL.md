# Task Recurrence Model

## Rule

1. **Daily tasks are one-off:** Daily tasks do not recur. Their Done by date is optional and is selected with the calendar.

2. **Weekly tasks must recur:** A Weekly task requires a repeat interval of either 7 days or 14 days. Its first due date is calculated from the date the task is created.

3. **Monthly tasks must recur:** A Monthly task requires a repeat interval of either 14 days or 30 days. Its first due date is calculated from the date the task is created.

4. **Completion starts the next cycle:** Marking a Weekly or Monthly task complete keeps it active and calculates its next due date from the date it was marked complete. A recurring task must not move to Completed Tasks.

5. **Changing frequency restarts the cycle:** Changing the repeat interval recalculates the next due date from the date of the change.

6. **Existing active tasks:** Preserve existing deadlines. Normalize active Daily tasks to non-recurring, Weekly tasks to 7 or 14 days, and Monthly tasks to 14 or 30 days. If an active recurring task has no deadline, calculate it from its original creation date.

7. **Imports follow the same model:** Spreadsheet imports must enforce these category-specific intervals and calculate recurring due dates from the import date.

## Scope

Applies to task creation and editing, task completion, calendar and overdue displays, spreadsheet imports, and the `vessel_tasks` database table.
