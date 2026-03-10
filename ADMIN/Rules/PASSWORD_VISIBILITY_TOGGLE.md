# Password Visibility Toggle

## Rule

All password input fields (when creating an account or logging in) **must** have a show/hide password toggle. The user must be able to tap an eye icon to toggle between masked (dots) and visible (plain text) password.

## Implementation

- Use an eye icon (e.g. `eye-outline` / `eye-off-outline` from Ionicons) inside or adjacent to the password field
- Toggle `secureTextEntry` on the TextInput based on user tap
- Apply to: LoginScreen, RegisterCaptainScreen, RegisterCrewScreen, RegisterScreen (and any future auth screens with password fields)

## Scope

Applies to all password fields in authentication and registration flows.
