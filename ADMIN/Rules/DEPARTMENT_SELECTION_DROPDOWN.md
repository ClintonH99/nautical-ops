# Rule: Department Selection — Dropdown Only

## Rule

All department selection UI elements across the app **must** use a dropdown (modal picker), not chip buttons or toggle buttons.

## Appearance

| Theme | Text Color | Background |
|-------|-----------|------------|
| Day   | Black (`COLORS.textPrimary`) | White / `themeColors.surface` |
| Night | White (`themeColors.textPrimary`) | Dark surface (`themeColors.surface`) |

## Implementation Pattern

- Trigger: `TouchableOpacity` styled as a form input (row with chevron `▼`)
- Options: `Modal` with `Pressable` backdrop to dismiss; options listed as `TouchableOpacity` rows
- Selected option highlighted with `COLORS.primaryLight` tint
- Departments: `BRIDGE`, `ENGINEERING`, `EXTERIOR`, `INTERIOR`, `GALLEY`

## Exceptions

- **RegisterCrewScreen**: Multi-select (up to 2 departments) uses button toggles. This is the only permitted exception due to the multi-select requirement.

## Screens Affected

- `AddEditTaskScreen`
- `AddEditInventoryItemScreen`
- `AddEditYardJobScreen`
- `ProfileScreen`
- Any future screen that includes department selection

## When to Apply

Apply this pattern whenever adding or modifying department selection UI in any current or future screen.
