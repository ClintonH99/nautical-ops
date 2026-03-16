# Rule: Board / Card Design Unity

## Rule

All "boards" and card-style content areas across the app must share the same visual design for both Day and Night modes. The **Muster Station & Duties** screen is the reference design that all other boards must match.

## Reference Design (MusterStationScreen)

```ts
// Card/board container
{
  backgroundColor: themeColors.surface,
  borderRadius: BORDER_RADIUS.lg,        // typically 16
  padding: SPACING.lg,
  ...SHADOWS.md,                         // platform shadow
}

// Inner section header / top accent
{
  borderTopWidth: 4,
  borderTopColor: COLORS.primary,
  borderTopLeftRadius: BORDER_RADIUS.lg,
  borderTopRightRadius: BORDER_RADIUS.lg,
}

// Primary text inside board
{ color: themeColors.textPrimary }

// Secondary / muted text inside board
{ color: themeColors.textSecondary }
```

## Day vs Night

| Property        | Day                          | Night                          |
|-----------------|------------------------------|--------------------------------|
| Card background | `themeColors.surface` (white/light) | `themeColors.surface` (dark) |
| Primary text    | Dark (`COLORS.textPrimary`)  | White (`COLORS.white`)         |
| Secondary text  | Muted grey                   | White / near-white             |
| Shadows         | Visible (subtle)             | Subtle (reduced opacity)       |

## What Counts as a "Board"

- Any card-style container displaying informational content (rules, duties, checklists, watch schedules)
- Named "board", "section", "card", or "panel" in the code
- Examples: Watch Keeping Rules board, Muster Station boards, Pre-Departure Checklist cards

## What Does NOT Apply

- Form inputs, navigation rows, list items — these follow their own component standards.
- Action buttons and FABs.

## When to Apply

Apply when creating new boards/cards or modifying existing board-style components. If a board deviates from this design, update it to match.
