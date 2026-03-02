# Form Labels and Hints in Dark Mode

## Rule

Labels and hint/helper text that appear above or below text inputs must use **white text** in Dark Mode for readability.

## Implementation

Use `themeColors.isDark ? COLORS.white : themeColors.textSecondary` for these elements.

## Scope

All form screens—labels above inputs, hints below labels (e.g. "Which department is this for?"), and similar helper text.

**In-scope:** Form labels, hints, helper text, cancel buttons in modals, and descriptive text directly tied to form fields.

**Out-of-scope:** Dropdown chevrons, generic "Join a vessel" full-screen messages (unless desired), and purely decorative text.
