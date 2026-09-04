# Security Enforcement Rollout

The security migrations intentionally create the new server workflows with
strict enforcement **disabled**. This prevents currently installed app builds
from being locked out before the RPC-based app version reaches users.

## Current production state (verified 2026-09-03)

- The role, subscription-grace, two-device and server-enforcement migrations
  are applied to the linked Supabase project.
- `verify-apple-iap`, `apple-subscription-webhook` and `delete-vessel` are
  deployed, and the required Apple server secrets and notification URL are
  configured.
- `security_enforcement_settings.enabled` is still `false`, as required until
  a compatible app build is tested and available to all users.
- The SQL foundation passed a disposable PostgreSQL test covering two allowed
  devices, rejection of a third device, active and canceled paid-through
  access, the 16-day `past_due` grace period, post-grace data lockout, Captain
  access to payment recovery, and immediate refund/revocation lockout.
- The obsolete Nautical Ops Paddle functions and secrets still exist in the
  live Supabase project. Removing them is a separate, explicitly approved
  production cleanup; Paddle remains valid only for Fleet HQ.
- Four additional transactional security migrations are verified locally but
  not yet deployed: atomic vessel leave/delete, atomic account-deletion
  preparation, one-time QR link consumption, and atomic Apple purchase-token
  activation.
- The three production Database Webhooks were inspected read-only. Trip push,
  subscription email and user welcome-email hooks all carry a legacy service
  credential; no webhook settings were changed. The hardened function code is
  not yet deployed.
- The storage ownership migration was applied directly to production on
  2026-09-04. Both public image buckets now have 10 MB limits; profile writes
  are owner-only; vessel-banner writes are Captain-only for the matching
  vessel; broad legacy policies are absent; and anonymous execution of the
  ownership helpers is denied. All checks were verified through read-only
  metadata queries after the change.
- The Expo SDK 54 dependency set is internally consistent and passes
  `expo install --check`. `npm audit` reports no critical issue, but inherited
  Expo/React Navigation tooling still reports high/moderate advisories whose
  automated fix requires a breaking Expo SDK upgrade. Do not use
  `npm audit fix --force` as a production shortcut.

## Safe rollout order

### Migration-history warning

`20260213000000_PRODUCTION_SCHEMA_BASELINE.sql` is the authoritative starting
point for a clean database. It is a schema-only snapshot and contains no
customer rows or webhook credentials. Production already contains this schema,
so do **not** apply the baseline to production and do **not** use
`supabase db push --include-all` against production. The baseline should be
marked as already represented in migration history during a separately approved
alignment step. The 41 untimestamped historical scripts are retained under
`supabase/legacy-migrations/` and must not be replayed individually.

1. Back up the Supabase database.
2. Keep `security_enforcement_settings.enabled` set to `false` while testing.
3. Apply the pending transactional migrations before deploying the Edge
   Functions that call their RPCs. Deploying functions first would break those
   operations.
4. Test production profile-photo upload/delete as a normal user and
   vessel-banner upload/delete as the matching vessel Captain. The policy and
   size-limit metadata is already verified.
5. Reconfirm all three Database Webhooks still send the service authorization
   header, then deploy `send-trip-push` and `send-welcome-email` hardening.
6. Replace the legacy broad webhook credential with a dedicated secret in a
   staged change. Do not rotate the project JWT secret without first migrating
   the app and all server integrations, because that would invalidate current
   app keys and user sessions.
7. Test Captain registration, vessel creation, Crew registration, invite joining, two-device login, Apple purchase/restore, failed renewal, refund/revocation, account/vessel deletion, QR sign-in, and every role-gated write in a compatible TestFlight build.
8. Release that RPC-based app version through the App Store. Do not activate strict enforcement while users still depend on an older build.
9. After the required app version is available to all users, remove direct
   client reads of the full subscription table. Current app code uses the safe
   entitlement RPC, which excludes Apple/Google transaction identifiers:

   ```sql
   REVOKE SELECT ON public.vessel_subscriptions FROM anon, authenticated;
   ```

10. Require the compatible app version and activate enforcement in the
    Supabase SQL editor:

   ```sql
   UPDATE public.security_enforcement_settings
   SET enabled = TRUE, updated_at = now()
   WHERE singleton = TRUE;
   ```

11. Repeat the role, subscription, device, QR, storage and deletion tests against production.

## Emergency access rollback

If the new app cannot access expected vessel data, a database owner can
temporarily disable the new self-promotion/device trigger enforcement while the
cause is investigated:

```sql
UPDATE public.security_enforcement_settings
SET enabled = FALSE, updated_at = now()
WHERE singleton = TRUE;
```

This switch is server-only. It is not exposed to app users. Disabling it is a
temporary compatibility measure, not a finished security state.

## Important limitations

- The two-device control binds authenticated sessions to app installation
  fingerprints. It blocks ordinary credential sharing. Strong resistance to a
  deliberately modified client additionally requires Apple App Attest and
  Google Play Integrity validation on a trusted backend.
- Voluntary sign-out releases that device slot. A user who permanently loses a
  device without signing out still needs a support-assisted revocation path.
- Paddle remains only as historical database compatibility. A legacy
  Paddle-linked vessel cannot be deleted until support confirms its billing is
  cancelled. New Nautical Ops app subscriptions use Apple or Google billing.
