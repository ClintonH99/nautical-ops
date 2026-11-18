# Calendars

## Rule

All calendars in the app (current and newly added) **must** use:

- **Day mode:** Black text for day numbers, day headers (Mon, Tue, etc.), month name, and arrows
- **Dark mode:** White text for all calendar elements

## Implementation

- Use `themeColors.isDark` from `useThemeColors()` (which reads from `BACKGROUND_THEMES`)
- When `themeColors.isDark` is **true**: use `COLORS.white` for text colors (`dayTextColor`, `textDisabledColor`, `textSectionTitleColor`, `monthTextColor`, `arrowColor`, `todayTextColor`)
- When `themeColors.isDark` is **false**: use `COLORS.black` or `themeColors.textPrimary` for text colors

## Month Navigation

The approved September 2026 design replaces arrow-only month navigation with separate Month and Year dropdowns, on embedded calendars and date-field popovers except Home and Hours of Rest. Keep both controls fully visible and do not clip their menus.

The Home screen and Hours of Rest are explicit user-approved exceptions: retain their original month/year heading with previous/next arrows. Use the original `Calendar` from `react-native-calendars` there; preserve existing markings, month-change callbacks, date bounds, and day/night colors. All other calendars keep the updated shared design.

## Scope

Applies to: HomeScreen, UpcomingTripsScreen, YardPeriodJobsScreen, AddEditYardJobScreen, TasksCalendarScreen, AddEditTaskScreen, AddEditTripScreen, CreateWatchTimetableScreen, and any future screens that add calendar components.

## Approved shared selector design

- Use `AppCalendar` for embedded calendars except Home and Hours of Rest, and `DateOnlyPicker` for date-entry fields.
- Display separate Month and Year dropdowns above the day grid, with full month names and a check beside the displayed selection.
- Month/year choices only navigate the calendar. For a single date field, tapping a day commits the date and dismisses the popover; there is no Set Date / Done step. Dismissing without a day selection preserves the previous value.
- Dropdowns are scrollable, open near the current choice, fit inside the viewport, and use the current day/night theme. Do not stack native Modals.
- The selected single date is navy with white text in day mode and light blue with dark text in night mode. Today has a separate subtle highlight. Disabled dates have muted text.
- Keep existing range-selection workflows, event/department colours, date bounds, callbacks and permissions unchanged. Display calendars are not converted into single-date forms.
- Keep all date-only values in local YYYY-MM-DD form; never shift the selected day through UTC conversion.
