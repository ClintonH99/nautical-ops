# Contractors table

To use **Contractor Database**, create the table in Supabase:

1. Open **Supabase Dashboard** → your project → **SQL Editor**.
2. Run the migration: **`supabase/migrations/CREATE_CONTRACTORS_TABLE.sql`**.
3. Run the migration: **`supabase/migrations/ADD_CONTRACTOR_DEPARTMENT.sql`** (adds department column).
4. Run the migration: **`supabase/migrations/ADD_CONTRACTOR_KNOWN_FOR.sql`** (adds known_for for keyword search).

After this, the Contractor Database screen will load and save contractors per vessel.
