# Notification Preferences

Notification preferences are already part of the production schema. For a clean
local or test database:

1. Apply `supabase/migrations/20260213000000_PRODUCTION_SCHEMA_BASELINE.sql`.
2. Apply the remaining timestamped migrations in filename order.

The old incremental script is retained under `supabase/legacy-migrations/` for
historical reference only. Do not run it individually against production.
