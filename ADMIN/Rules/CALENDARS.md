# Calendars

## Rule

All calendars in the app (current and newly added) **must** use:
- **Day mode:** Black text for day numbers, day headers (Mon, Tue, etc.), month name, and arrows
- **Dark mode:** White text for all calendar elements

## Implementation

- Use `themeColors.isDark` from `useThemeColors()` (which reads from `BACKGROUND_THEMES`)
- When `themeColors.isDark` is **true**: use `COLORS.white` for text colors (`dayTextColor`, `textDisabledColor`, `textSectionTitleColor`, `monthTextColor`, `arrowColor`, `todayTextColor`)
- When `themeColors.isDark` is **false**: use `COLORS.black` or `themeColors.textPrimary` for text colors

## Scope

Applies to: HomeScreen, UpcomingTripsScreen, YardPeriodTripsScreen, TasksCalendarScreen, AddEditTaskScreen, AddEditTripScreen, CreateWatchTimetableScreen, and any future screens that add calendar components.
