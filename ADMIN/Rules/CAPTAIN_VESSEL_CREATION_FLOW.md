# Captain Vessel Creation Flow

## Rule

1. **Mandatory vessel creation:** On the "Account Created! / Create a Vessel" screen (CaptainWelcomeScreen), the only action must be "Create a Vessel." There must be no alternative to skip or proceed to Home without creating a vessel. The user must create a vessel before moving on.

2. **Post-vessel creation (approved 30 September 2026):** The success screen directs the Captain to Home. A welcome board offers Continue (explore the app) and See Plans (Vessel Plans). A paid plan is still required before inviting crew.

## Implementation

- CaptainWelcomeScreen: Remove any "Go to Home instead" or "Proceed to homepage" link. Only the "Create a Vessel" button.
- CreateVesselScreen: After successful vessel creation, the continuation action opens Home. Remember welcome dismissal per account and vessel, not per device globally.

## Scope

Applies to CaptainWelcomeScreen and CreateVesselScreen.

## Existing accounts after departure (approved 27 September 2026)

- Leaving or being removed from a shared vessel resets the user to CREW in a fresh private Crew Account, retaining their account identity and personal My Sea Miles. Old vessel records stay with the old vessel and are not copied into the fresh workspace.
- Only that server-verified departure unlocks Create a New Vessel for an existing Crew account. A new Crew account cannot unlock it by leaving its private workspace, editing its profile, or calling the creation API directly.
- The last Captain/MOV cannot voluntarily leave: another Captain/MOV must remain.
- An eligible independent user may create a new vessel. Creation assigns Captain/MOV on the new vessel and consumes the independent-account creation permission. Joining an existing shared vessel also consumes it.
- New Captain signups without a vessel retain their existing creation access. Signup-type restoration is not used.
- No historical eligibility is guessed for accounts that departed before this feature was recorded.
- The creation success action is Go to Home. The Captain selects/pays for the new vessel's plan before crew can join; old vessel subscriptions are not transferred.
