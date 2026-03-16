# Rule: Night Mode — All Text Must Be White

## Rule

In **Night** (dark) mode, **all text** in the app must be white or near-white. No dark text is permitted on dark backgrounds.

## Implementation

- Always use `themeColors.textPrimary` for primary text — in Night mode this resolves to `COLORS.white`.
- Always use `themeColors.textSecondary` for secondary/muted text — in Night mode this must also be white or near-white (e.g. `#FFFFFF` or `rgba(255,255,255,0.75)`).
- **Never** hardcode `color: COLORS.textPrimary`, `color: COLORS.textSecondary`, `color: '#000'`, `color: '#000000'`, or `color: COLORS.black` for text that will be shown in Night mode.
- If a component conditionally applies text color, use: `{ color: themeColors.isDark ? COLORS.white : themeColors.textSecondary }` as a minimum.

## `BACKGROUND_THEMES` Requirements

In `yachy-app/src/store/index.ts`, the `night` theme entry must have:

```ts
textPrimary: COLORS.white,       // '#FFFFFF'
textSecondary: COLORS.white,     // '#FFFFFF' (or near-white ≥ 0.75 opacity)
```

## Screens and Components Affected

All screens and components that render visible text. Pay special attention to:

- Labels and hints on form screens
- Board/card content text
- Section headers and titles
- Placeholder text on inputs (use `themeColors.textSecondary` as `placeholderTextColor`)

## When to Apply

Apply to every screen when adding or editing text-rendering code, and audit existing screens when theming is touched.
