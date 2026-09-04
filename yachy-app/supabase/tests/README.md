# Supabase schema tests

`schema_replay_runtime_prelude.sql` supplies the `auth.uid()`, `auth.role()` and
`auth.jwt()` helpers that the hosted Supabase platform normally provides. It is
test scaffolding only and must never be applied to production.

The database-foundation check is:

1. Start a disposable Supabase PostgreSQL container.
2. Apply `schema_replay_runtime_prelude.sql` as `supabase_admin`.
3. Apply `../migrations/20260213000000_PRODUCTION_SCHEMA_BASELINE.sql`.
4. Apply every later timestamped public-schema migration in filename order.
5. Run the privilege and RLS assertions in the audit checklist.

The storage migration is tested separately because a bare PostgreSQL container
does not include Supabase Storage's `storage.objects` and `storage.buckets`
tables.
