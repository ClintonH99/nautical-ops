# Time Selector Standard

Use this standard for every time-selection feature in Nautical Ops.

## Shared Component

- Use `TimePickerField` from `src/components/TimePickerField.tsx`.
- Do not create screen-specific time dropdowns, native compact pills, inline spinners, text inputs, or icon-only time controls.
- Display and select time in 24-hour `HH:mm` format.

## Closed Field

- Place the field label above the control.
- Use the shared 50-point control height, `BORDER_RADIUS.md`, themed control surface, themed border, and navy active border.
- Show the selected time on the left and the outline clock icon on the right.
- For a start/end range, use two equal-width fields with a right arrow between them.

## Open Selector

- Open the shared bottom sheet with a dimmed backdrop.
- Show a 24-hour hour-and-minute wheel.
- Use `Cancel` to close without changing the stored time.
- Use `Done` to apply the selected time.
- Do not add quick-time shortcuts, presets, a separate Next button, or other unapproved actions.

## Existing Modal Screens

Never stack React Native modals. When a time selector is opened from an existing modal, keep the existing modal and render `TimePickerSheetContent` inside it. Use `TimePickerTrigger` for the closed field.

## Appearance

- Use `useThemeColors()` for every surface, border, icon, and text color.
- The component structure and spacing are identical in day and night mode.
- The selected/primary action remains Nautical Ops navy in both modes.
