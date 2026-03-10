# Department Dropdown Style

## Rule

All department **dropdown/selection controls** (where the user picks a department) must use **standard text with no colored background** behind the department names.

## Scope

- **Applies to:** Dropdown triggers, modal option lists, chip selectors, and button groups used for department selection (e.g. Add/Edit Shopping List, Add/Edit Inventory, Add/Edit Task, Add/Edit Yard Job, Profile, Register, Register Crew).
- **Out of scope:** Department badges on list cards, task cards, and other display-only department indicators—those may continue to use colored backgrounds per [DEPARTMENT_COLOR_TAGS.md](DEPARTMENT_COLOR_TAGS.md).

## Implementation

- Use plain text for department labels (e.g. Bridge, Engineering, Exterior, Interior, Galley).
- For selected state: use a border (e.g. `borderColor: COLORS.primary`, `borderWidth: 2`) or text styling (e.g. `color: COLORS.primary`, `fontWeight: '700'`) instead of a colored background.
- Do not use `getDepartmentColor()` or department-specific background colors in selection controls.
