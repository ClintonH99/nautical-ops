# Department Color Tags

## Rule

All department tags displayed in the app **must** show the department name with a **colored background** behind the text. This applies everywhere department is shown on information cards, list items, or filters.

## Reference Design

Use the same design as **Shopping List**: a pill/badge with:
- Background color from `getDepartmentColor(department, overrides)`
- White text (`COLORS.white` or `deptBadgeText` style)

## Implementation

- **Colors:** `COLORS.departmentColors` in [theme.ts](../yachy-app/src/constants/theme.ts)
  - BRIDGE: blue, ENGINEERING: red, EXTERIOR: ocean blue, INTERIOR: purple, GALLEY: green
- **HOD overrides:** Use `useDepartmentColorStore` and pass `overrides` to `getDepartmentColor()` so Settings-customized colors apply
- **Pattern:** Wrap department label in a `View` with `backgroundColor: getDepartmentColor(dept, overrides)` containing `Text` with white color

## Scope

Apply to: Shopping List, Inventory, Contractor Database, Yard Period Jobs, Tasks, Yard Period Trips, Pre-Departure Checklist, Overdue/Upcoming/Completed Tasks, View Pre-Departure Checklist, and any other screens that display department on cards or list items.
