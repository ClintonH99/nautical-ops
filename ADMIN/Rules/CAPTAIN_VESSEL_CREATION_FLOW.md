# Captain Vessel Creation Flow

## Rule

1. **Mandatory vessel creation:** On the "Account Created! / Create a Vessel" screen (CaptainWelcomeScreen), the only action must be "Create a Vessel." There must be no alternative to skip or proceed to Home without creating a vessel. The user must create a vessel before moving on.

2. **Post-vessel creation:** Once a captain has created a vessel (entered vessel name and completed the flow), they must be taken directly to the Home/Dashboard screen.

## Implementation

- CaptainWelcomeScreen: Remove any "Go to Home instead" or "Proceed to homepage" link. Only the "Create a Vessel" button.
- CreateVesselScreen: After successful vessel creation, navigate user to MainTabs (Home/Dashboard).

## Scope

Applies to CaptainWelcomeScreen and CreateVesselScreen.
