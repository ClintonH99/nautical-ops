# Wallet sandbox checkpoint — 20 October 2026

## Saved implementation

- Branch: `fix/safari-keyboard-preview`
- Tested implementation: `5741125eb3c81f27eae76a9d6426c41c4a6a291b`
- Previous wallet UI commit: `4b6e3bb8882bb77ae4dc0f236037e04049602cfd`
- Preview: https://nautical-ops-git-fix-safari-keyboar-9d2909-clintonh99s-projects.vercel.app
- Scope: existing **Clinton Handford TEST** sandbox subscription only.

## User-confirmed results

| Test | Evidence | Result |
| --- | --- | --- |
| Apple Pay payment-method update | 19 October: iPhone Safari opened the native wallet with US$0.00; the user's screenshot showed “Payment method updated” and “Apple Pay”. The user confirmed the return to the app worked. | Passed in sandbox |
| Google Pay payment-method update | 20 October: checkout showed Sandbox / Test mode and USD 0.00 due. The user's screenshot showed “Payment method updated” and “Google Pay”; the user then confirmed normal access after returning to Nautical Ops. | Passed in sandbox |
| Manual card recovery | Earlier in this chat, the user confirmed successful payment recovery, restored crew access, and Captain return to Home with normal use. | User-confirmed sandbox recovery |

These wallet tests updated payment methods on an existing subscription. They
do **not** prove a nonzero wallet charge, an automatic wallet renewal, or live
payment processing. Browser confirmation is not a replacement for server-side
subscription verification.

## Preserved boundaries

- No public production deployment or live-payment activation as part of this checkpoint.
- No new subscription, membership change, device-limit change, or trial restart.
- Payment fields remain inside Paddle; final wallet confirmation is performed by the user.
- Keep the one-page checkout variant: express was rejected for the cardless-trial-origin subscription.
- The exact preview domain was approved for Apple Pay following the user's one-time authorization. The temporary Vercel protection exception was removed afterward; do not treat the older “verification blocked” wording in the subscription rules as current status or as permission to weaken protection.
- Separate uncommitted security-header, pricing-script and dependency work is not part of this verified wallet checkpoint.

## Next release checks

1. Reconcile server/provider evidence with these user-confirmed outcomes.
2. Verify the production catalogue, regional taxes, checkout-domain approval,
   signed webhook configuration and billing safeguards before proposing activation.
3. Keep nonzero wallet payment / renewal verification explicitly outstanding.
4. Review and test unrelated local edits separately; do not include them in a
   release merely because the wallet tests passed.
5. Obtain explicit approval before public deployment or live-payment activation.
