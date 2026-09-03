# Security Enforcement Rollout

The security migrations intentionally create the new server workflows with
strict enforcement **disabled**. This prevents currently installed app builds
from being locked out before the RPC-based app version reaches users.

## Safe rollout order

1. Back up the Supabase database and rehearse the migrations in a non-production project.
2. Apply the pending migrations. Confirm `security_enforcement_settings.enabled` is `false`.
3. Deploy `verify-apple-iap`, `apple-subscription-webhook`, and `delete-vessel`.
4. Test Captain registration, vessel creation, Crew registration, invite joining, two-device login, Apple purchase/restore, failed renewal, refund/revocation, and every role-gated write.
5. Release the RPC-based app version through TestFlight, then the App Store. Do not activate strict enforcement while users still depend on an older build.
6. After the required app version is available to all users, require that version and activate enforcement in the Supabase SQL editor:

   ```sql
   UPDATE public.security_enforcement_settings
   SET enabled = TRUE, updated_at = now()
   WHERE singleton = TRUE;
   ```

7. Repeat the role, subscription, and device tests against production.

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
