# CaptainWelcome Screen Access

## Rule

The "Account Created! / Create a Vessel" screen (CaptainWelcomeScreen) **must** be shown **only** to a captain who has just registered and has not yet created a vessel.

- **Crew members:** Never see this screen. Go directly to Home/Dashboard after registration.
- **Existing captains (who already have a vessel):** Never see this screen when logging in. Go directly to Home/Dashboard.
- **New captains (no vessel yet):** See this screen after registration to create their first vessel.

## Implementation

- Route to CaptainWelcome only when: `isCaptain && !hasVessel`
- Route to MainTabs (Home/Dashboard) for: crew members, captains who already have a vessel, or any user who has completed vessel setup

## Scope

Applies to RootNavigator (initial route logic for authenticated stack), WelcomeScreen (post-welcome navigation), and any auth state transitions.
