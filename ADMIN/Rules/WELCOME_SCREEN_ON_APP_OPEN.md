# Instant App Startup

## Rule

Users must reach usable app content as quickly as possible. A returning authenticated user must not be held on a timed Welcome screen, splash screen, or loading spinner before Home can render.

## Implementation

- Render a cached authenticated user immediately while refreshing their profile in the background.
- Route unauthenticated users directly to Login.
- Route authenticated users directly to Home (`MainTabs`).
- Route a Captain/MOV without a vessel to `CaptainWelcome`.
- Do not add an artificial startup delay.
- Do not re-show the Welcome screen when returning from the background.

## Scope

Applies to `RootNavigator`, authentication bootstrap, and any splash/welcome loading logic.
