# Targeted Apple test-billing cutover

## Diagnosis — 7 October 2026

The Vessel Plans warning on JOHN DOE TEST VESSEL comes from an Apple row still
marked active, with a period ending 29 July 2026 and no subsequent update.
The client deliberately resolves expired active records as unavailable, not
proof of non-payment. Do not weaken that rule or hide the warning globally.

## Operation

`supabase/operations/archive_john_doe_apple_test.sql` is a manual operation,
not an automatic migration. Apply only after the owner approves this specific
live-data change. It snapshots every column into a private RLS-protected archive
and removes exactly the inspected old subscription in one transaction. It aborts
if its vessel, provider, status, expiry, update timestamp or Paddle binding changed.
Retries do not touch any new Paddle subscription. No new trial or payment starts.

No accounts, vessel data, memberships, Sea Miles or other subscriptions are changed.
Paddle checkout remains disabled independently. This is not a completed migration
of all historical Apple billing and does not disable legacy provider endpoints.

## Verification

Run the disposable PostgreSQL test with `PGLITE_MODULE_PATH` pointing at
`@electric-sql/pglite@0.5.8`, then run the subscription service Jest tests.
After approval/application, verify one archived snapshot, no old active row, and
refresh the signed-in Vessel Plans page. The unconfirmed-status warning should
disappear while tax previews work and checkout remains disabled.

## Recovery

An operator can restore the original row using `jsonb_populate_record` against
`public.vessel_subscriptions` from the archived `snapshot`. First check that no
replacement subscription exists for the vessel; never overwrite one. Keep the
archive for audit. Do not expose snapshots or provider identifiers to clients.

## Application status

Applied to Supabase on 7 October 2026 after explicit owner approval.
Read-only verification returned one archived record, zero old active records,
and the vessel still present. Refresh Plan Status in the signed-in web app
cleared the warning; regional tax totals remained visible and the page still
confirmed that checkout is disabled. No frontend deployment was required.
