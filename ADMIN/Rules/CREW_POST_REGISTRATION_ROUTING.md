# Crew Post-Registration Routing

## Rule

When a crew member successfully creates an account, they **must** be taken directly to the Dashboard/Home screen. Crew members must **never** see the Captain "Account Created! / Create a Vessel" screen (CaptainWelcomeScreen).

## Implementation

- After successful crew registration, route to MainTabs (Home/Dashboard)
- CaptainWelcomeScreen is only for captains who have no vessel yet
- Crew members (and captains who already have a vessel) go straight to MainTabs

## Scope

Applies to: RootNavigator (authenticated stack initial route), RegisterCrewScreen (post-registration navigation), and any auth state transitions that determine which screen to show when the user becomes authenticated.
