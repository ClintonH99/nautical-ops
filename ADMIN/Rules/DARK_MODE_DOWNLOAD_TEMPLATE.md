# Download Template Buttons in Dark Mode

## Rule

Buttons in Import/Export that say "Download Template" must have **white border and white text** in Dark Mode only. Day mode keeps the current outline style.

## Implementation

In ImportExportScreen, when `themeColors.isDark` is true, use `variant="outlineLight"` (or equivalent) for the Download Template buttons so text and border are white.

## Scope

Applies to Import/Export screen Download Template buttons only.
