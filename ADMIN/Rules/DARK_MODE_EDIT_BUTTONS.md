# Edit Buttons in Dark Mode

## Rule

All buttons that display the word "Edit" (including "Edit colors", "Edit items", "Edit Rules") must have **white text** in Dark Mode.

## Implementation

When `themeColors.isDark` is true, use `COLORS.white` for the text color of any Edit button.

Example: `color: themeColors.isDark ? COLORS.white : COLORS.primary`

## Key Locations

- ButtonTagCard – edit action text
- WatchKeepingScreen – Edit Rules button
- WatchScheduleScreen – Edit button
- VesselSettingsScreen – Edit (vessel name)
- ProfileScreen – Edit button
- ShoppingListScreen – Edit, Edit items
- Trips screens – "Edit colors" header button
