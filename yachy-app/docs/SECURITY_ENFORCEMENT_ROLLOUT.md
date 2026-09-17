# Security Enforcement Rollout

The security migrations intentionally create the new server workflows with
strict enforcement **disabled**. This prevents currently installed app builds
from being locked out before the RPC-based app version reaches users.

## Current production state (verified 2026-09-18)

- The role, subscription-grace, two-device and server-enforcement migrations
  are applied to the linked Supabase project.
- Forward migration `20260918130000_RESTORE_PRODUCTION_FOUNDATION_PARITY.sql`
  is applied. It restored the missing transactional vessel/account/QR/Apple
  RPCs, device push-token fields, indexes and least-privilege grants without
  replaying the production baseline.
- All ten locally managed Edge Functions are deployed and active with their
  intended JWT modes. Unauthenticated guard probes pass, malformed QR codes
  return `400`, and the three live-only Paddle/legacy functions were not
  changed.
- `security_enforcement_settings.enabled` is still `false`, as required until
  a compatible app build is tested and available to all users.
- The SQL foundation passed a disposable PostgreSQL test covering two allowed
  devices, rejection of a third device, active and canceled paid-through
  access, the 16-day `past_due` grace period, post-grace data lockout, Captain
  access to payment recovery, and immediate refund/revocation lockout.
- A production smoke suite using only tagged disposable identities passed QR
  claim/one-time consumption, Crew leave, sole-Captain protection, vessel
  deletion/member isolation, Apple cancellation reminders, Captain succession,
  account/Auth deletion and verified cleanup of every disposable row/user.
- iOS 1.1.3 build 47 is a valid internal TestFlight beta. A real Apple sandbox
  purchase and restore still require a physical device and have not yet been
  claimed as verified.
- The obsolete Nautical Ops Paddle functions and secrets still exist in the
  live Supabase project. Removing them is a separate, explicitly approved
  production cleanup; Paddle remains valid only for Fleet HQ.
- The three production Database Webhooks still carry a service credential. The
  hardened `send-trip-push` and `send-welcome-email` functions are deployed;
  replacing the legacy broad credential remains a separately staged task.
- The storage ownership migration was applied directly to production on
  2026-09-04. Both public image buckets now have 10 MB limits; profile writes
  are owner-only; vessel-banner writes are Captain-only for the matching
  vessel; broad legacy policies are absent; and anonymous execution of the
  ownership helpers is denied. All checks were verified through read-only
  metadata queries after the change.
- The app is on Expo SDK 57 / React Native 0.86.3. The repaired lockfile passes
  the exact npm 10 clean install used by EAS, 120 tests, TypeScript and an iOS
  export. `npm audit` reports no critical issue; 29 inherited advisories and 22
  available Expo patch updates remain a separate reviewed maintenance change.
  Do not use `npm audit fix --force` as a production shortcut.

## Safe rollout order

### Migration-history warning

`20260213000000_PRODUCTION_SCHEMA_BASELINE.sql` is the authoritative starting
point for a clean database. It is a schema-only snapshot and contains no
customer rows or webhook credentials. Production already contained this schema,
so it was marked as represented in migration history and was not replayed. Do
**not** apply the baseline to production and do **not** use
`supabase db push --include-all` against production. The 41 untimestamped
historical scripts are retained under `supabase/legacy-migrations/` and must not
be replayed individually.

The production ledger now matches every represented migration except
`20260904120000_HARDEN_TASK_RECURRENCE.sql`. That recurrence constraint is
intentionally deferred because installed older clients can still write values
outside the new narrower set; enforcing it before a compatible release could
break those users.

1. Completed for this change: temporary pre-change schema and data dumps were
   taken, then removed from temporary storage after successful postflight so
   customer data was not left on disk. Do not treat those temporary files as a
   retained rollback backup for future migrations.
2. Keep `security_enforcement_settings.enabled` set to `false` while testing.
3. Completed: the forward parity migration was applied before the dependent
   Edge Functions; the migration ledger was reconciled without `--include-all`.
4. Test production profile-photo upload/delete as a normal user and
   vessel-banner upload/delete as the matching vessel Captain. The policy and
   size-limit metadata is already verified.
5. Completed: all three Database Webhooks were confirmed to carry a service
   authorization header, and the hardened push/welcome functions were deployed.
6. Replace the legacy broad webhook credential with a dedicated secret in a
   staged change. Do not rotate the project JWT secret without first migrating
   the app and all server integrations, because that would invalidate current
   app keys and user sessions.
7. Use build 47 to test Captain registration, vessel creation, Crew registration,
   invite joining, two-device login, Apple purchase/restore, failed renewal,
   refund/revocation, storage upload/delete and every role-gated write. The
   production backend already passed tagged disposable tests for account/vessel
   deletion and QR sign-in.
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
