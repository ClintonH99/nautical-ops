# Auth Screen Input Style Rule

## Rule

All text input fields (and their labels) on MARITIME auth and onboarding screens **must always** display with:

- **White background** on the input box
- **Black text** for typed content
- **Black label** above each field

This applies regardless of the global Day/Night theme setting.

## Affected Screens

- Login Screen (`LoginScreen.tsx`)
- Register Captain Screen (`RegisterCaptainScreen.tsx`)
- Register Crew Screen (`RegisterCrewScreen.tsx`)
- Create Vessel Screen (`CreateVesselScreen.tsx`)

## How to Implement

Use the `forceLight` prop on the shared `Input` component:

```tsx
<Input
  label="Email"
  placeholder="your@email.com"
  forceLight
  ...
/>
```

The `forceLight` prop on `Input` bypasses the `useThemeColors` hook and hardcodes:
- `backgroundColor: COLORS.white`
- `color: COLORS.black` (typed text)
- Label `color: COLORS.black`

## Reason

These screens use the MARITIME dark navy theme with white form cards. Input fields and labels must remain readable on the white card background regardless of whether the user has Night mode enabled in their app settings.

## Future Screens

Any new MARITIME-themed auth or onboarding screen added to the app must follow this rule and use `forceLight` on all `Input` components.
