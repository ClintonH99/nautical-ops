# Titles in Dark Mode

## Rule

All title text in Dark mode **must** be white. Applies to:
- Screen headers (navigation bar titles)
- Section titles within pages
- Card titles and other prominent headings

## Implementation

When `themeColors.isDark` is true (from `useThemeColors()` / `BACKGROUND_THEMES`), use `COLORS.white` for title text instead of `COLORS.primary` or theme-based colors.

Example: `color: themeColors.isDark ? COLORS.white : COLORS.primary`

## Scope

Applies to all screens. Key areas: RootNavigator (headerTintColor), ButtonTagCard (header title), section titles (e.g. "Calendar", "Trip types", "Pre-Departure Checklist"), and any text styled as a heading.
