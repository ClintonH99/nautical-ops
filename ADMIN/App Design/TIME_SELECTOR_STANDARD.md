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

## Approved design — 18 November 2026

Clinton explicitly approved the [rendered Apple-style spinner mockup](References/time-spinner-approved-2026-11-18.png) and instructed: "Make that the standard design and you cannot change this design for time selection without my approval."

This is the app-wide standard. Never replace or redesign these controls without Clinton's explicit approval of the proposed design. A bug-fix instruction does not grant design approval.

## Open Selector

- Open a white/themed rounded bottom sheet with the existing dimmed backdrop, centered grabber and title.
- Use two Apple-style vertical spinner wheels: hours 00–23 and minutes 00–59, separated by a colon. No AM/PM column.
- Show five rows, with the selected time centered in one subtle rounded grey selection band spanning both columns. Adjacent values fade and compress toward the outer edges.
- No text-entry boxes, keyboard, extra visible hour/minute labels, presets or alternative selector styles.
- Keep the existing outlined Cancel button and navy Done button beneath the wheels.
- Open centered on the saved time. Scrolling must work on phone web, desktop web and native without changing the selected date.
- Cancel discards changes. Done applies the centered hour/minute selection in 24-hour HH:mm format.
- Fix scrolling, initial positioning and saving defects while preserving this approved appearance.

## Existing Modal Screens

Never stack React Native modals. When a time selector is opened from an existing modal, keep the existing modal and render `TimePickerSheetContent` inside it. Use `TimePickerTrigger` for the closed field.

## Appearance

- Use `useThemeColors()` for every surface, border, icon, and text color.
- The component structure and spacing are identical in day and night mode.
- The selected/primary action remains Nautical Ops navy in both modes.
