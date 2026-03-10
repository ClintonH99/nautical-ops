# Welcome Screen on App Open

## Rule

The "Welcome to Nautical Ops" screen **must** display every time a user opens the app (cold start), regardless of whether they are a new or returning member.

## Implementation

- On app launch (cold start), the initial route must be the Welcome screen
- After the welcome duration (~3 seconds), navigate based on auth state:
  - Unauthenticated → Login screen
  - Authenticated → Home (MainTabs) or CaptainWelcome (for captains without a vessel)
- This applies only to cold start; returning from background does not re-show the welcome screen

## Scope

Applies to RootNavigator (initial route logic) and WelcomeScreen (navigation target based on auth state).
