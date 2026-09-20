# Department Selection Dropdown

## Canonical Rule

Every department selection or department filter in the app must use a shared component:

- Use `DepartmentSelector` for a single selection.
- Use `DepartmentMultiSelector` when more than one department can be selected.
- Do not create screen-specific department dropdowns, chip selectors, or department button groups.
- Apply this rule to all current screens and every future build.

The available departments are `BRIDGE`, `ENGINEERING`, `EXTERIOR`, `INTERIOR`, and `GALLEY`. Filter controls may also include `All Departments`.

## Trigger

The trigger is a full-width form control with the `Department` label, the current value, and a chevron.

| Theme | Trigger surface | Value and chevron |
|-------|-----------------|-------------------|
| Day | White / `themeColors.control` | Navy / `COLORS.primary` |
| Night | Dark / `themeColors.control` | White / `themeColors.textPrimary` |

Labels must remain readable in both themes. Do not use department-specific colours in a selector trigger.

## Open Picker

- Present the picker as a centered modal with a dimmed backdrop.
- Bound the modal to the viewport, with a maximum width and height suitable for phones and tablets.
- Render the option rows inside a vertically scrollable list so every option remains reachable on small screens, in landscape, and with larger accessibility text.
- The underlying page does not scroll or receive touches while the modal is open.
- Use the theme's elevated surface, border, and primary text colours for the modal and unselected rows.

## Selected State

- Use `COLORS.primary` (the Nautical Ops navy) for the selected row background in both Day and Night modes.
- Use white text and a white checkmark on the selected row.
- Do not use `COLORS.primaryLight`, grey highlights, department-specific colours, or per-screen selected styles.
- A single selector closes immediately after the user chooses an option.

## Multi-Select Behaviour

- Keep the picker open while the user changes departments.
- Keep a fixed `Done` action below the scrollable options; its background is `COLORS.primary` and its text is white.
- When every department is selected, highlight only the `All Departments` row. Do not also render every individual department row as selected.
- Respect any minimum or maximum selection limit supplied by the screen.

## Selectors Inside Native Modals

Never stack one React Native `Modal` inside another. When a department selector is rendered inside an existing native modal, use the shared component's inline presentation so its option list stays within the parent modal's scrollable content.

Inline presentation is only for this nested-native-modal case. Normal screens must use the centered modal presentation. If a shared selector does not yet support inline presentation, extend that shared component rather than building a local picker.

## Display-Only Department Tags

This rule applies only where a user selects or filters by department. Display-only department badges on cards, lists, calendars, and records continue to use the department colours defined in [Department Color Tags](DEPARTMENT_COLOR_TAGS.md).

## Maintenance

The two shared selector components are the implementation source of truth. Fix their layout, theme, accessibility, or interaction behaviour centrally so every existing caller and future screen receives the same result.
