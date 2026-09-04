# Historical database scripts

These untimestamped SQL files are retained for historical reference only. Supabase CLI ignored them because their filenames do not use the required timestamp format.

The authoritative clean-environment starting point is `../migrations/20260213000000_PRODUCTION_SCHEMA_BASELINE.sql`, followed by the timestamped migrations in `../migrations/`.

Do not run these files individually against production. They describe earlier, incremental setup steps and may conflict with the current schema or security policies.
