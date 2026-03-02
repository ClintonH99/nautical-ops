# Text Boxes in Dark Mode

## Rule

All text inputs and dropdown triggers in Dark Mode must have a **dark surface background** that blends with the theme, like the Equipment box in Maintenance Log (Add/Edit Maintenance Log screen). Search bars are excluded—they follow the SEARCH_BARS rule (white background, black text).

## Implementation

- Use `themeColors.surface` for form inputs and dropdowns when `themeColors.isDark` is true.
- The shared `Input` component (non-search variant) and custom dropdown triggers (e.g. Equipment, Location, Serial number) need theme-aware backgrounds.
- Search inputs use `variant="search"` and keep white background per SEARCH_BARS.md.

## Scope

Applies to all form screens: Add/Edit screens, modals with text inputs, dropdown selectors.
