# Shopping Lists table

Shopping Lists are already part of the production schema. For a clean local or
test database, use the timestamped production baseline and later migrations:

1. Apply `supabase/migrations/20260213000000_PRODUCTION_SCHEMA_BASELINE.sql`.
2. Apply the remaining timestamped migrations in filename order.

The old shopping-list scripts are retained under `supabase/legacy-migrations/`
for historical reference only. Do not run them individually against production.
