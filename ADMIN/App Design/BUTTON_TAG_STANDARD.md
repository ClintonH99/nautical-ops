# Button Tag Standard

Interactive list/card design for screens where users tap to view/edit and items display multiple fields. Use this design for all similar screens across the app.

## Visual Design

- **Shape**: Rounded rectangle, `borderRadius: BORDER_RADIUS.lg` (16)
- **Background**: `themeColors.surface` (theme-aware for day/night)
- **Shadow**: `shadowColor: COLORS.black`, `shadowOffset: { width: 0, height: 2 }`, `shadowOpacity: 0.08`, `shadowRadius: 4`, `elevation: 3`
- **Padding**: `SPACING.lg` (24); **marginBottom**: `SPACING.md` (16)
- **Border**: `borderWidth: 2`, `borderColor: 'transparent'` (use `COLORS.primary` when selected for bulk action)

## Typography

| Element | fontSize | fontWeight | color |
|---------|----------|------------|-------|
| Title (header) | FONTS.base (16) | '700' | COLORS.primary |
| Edit (action) | FONTS.sm (14) | '600' | COLORS.primary |
| Labels (e.g. DATE, POSITION/LOCATION) | FONTS.xs (12) | '600' | themeColors.textSecondary |
| Values (primary content) | FONTS.base | normal | themeColors.textPrimary |
| Created by / Logged by (footer) | FONTS.xs | normal | themeColors.textSecondary |

**Label styling**: `textTransform: 'uppercase'`, `letterSpacing: 0.5`, `marginBottom: 2`

**Value styling**: `lineHeight: 20`

**Footer styling**: `fontStyle: 'italic'`, `marginTop: SPACING.xs`

## Layout

```
[Checkbox?] Title                [Delete icon] Edit
Date (when applicable)
Time (when applicable)
Label
Value
Logged by / Created by
```

- **Header row**: flexDirection row, justifyContent space-between; left: checkbox (if applicable) + **title** (main identifier); right: delete icon + Edit text. The title is always the first thing the user sees.
- **Content rows**: Date and Time as label/value rows when the form has them; then other fields. Label above value, stacked; marginBottom SPACING.sm between rows.
- **Footer**: "Logged by X" or "Created by X" at bottom

### Title Mapping (per screen)

| Screen | Title (header) |
|--------|----------------|
| General Waste Log | Position/Location |
| Fuel Log | Location of refueling |
| Pump Out Log | Location |
| Maintenance Log | Equipment name |
| Pre-Departure Checklist | Checklist title |
| Inventory | Item title |
| Trips (Boss/Guest/Delivery/Yard) | Trip title |
| Tasks List | Task title |
| Yard Period Jobs | Job title |

- If no date in the form: do not show Date in content.
- If no time in the form: do not show Time in content.
- Title is required; users must insert a title.

## Checkbox (Optional)

- **When**: Only if the screen supports bulk selection (select multiple, export PDF, delete selected). If no bulk action, do NOT add checkbox.
- **Style**: 22x22, borderRadius BORDER_RADIUS.sm, borderWidth 2, borderColor COLORS.gray300; checked: backgroundColor COLORS.primary, borderColor COLORS.primary, white checkmark
- **Placement**: Top-left of card header, before title

## Actions

- **Delete**: Ionicons `trash-outline`, size 20, `color: COLORS.danger`
- **Edit**: Text "Edit", fontSize FONTS.sm, fontWeight '600', color COLORS.primary

## Reference Implementation

General Waste Log: `yachy-app/src/screens/GeneralWasteLogScreen.tsx`

## Screens Using This Standard

- General Waste Log, Fuel Log, Pump Out Log (with checkbox)
- Maintenance Log, Pre-Departure Checklist, Inventory (with checkbox where bulk export exists)
- Boss/Guest/Delivery Trips, Yard Period Trips, Tasks List, Yard Period Jobs (no checkbox)
