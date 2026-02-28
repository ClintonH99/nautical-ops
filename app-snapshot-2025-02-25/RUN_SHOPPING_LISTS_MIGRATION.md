# Shopping Lists table

To use **Shopping List** (General Shopping and Trip Shopping, each with department filters), create the table in Supabase:

1. Open **Supabase Dashboard** → your project → **SQL Editor**.
2. Run the migration: **`supabase/migrations/CREATE_SHOPPING_LISTS_TABLE.sql`**.
3. Run the migration: **`supabase/migrations/ADD_SHOPPING_LIST_TYPE.sql`** (adds list_type column).
4. Run the migration: **`supabase/migrations/ADD_SHOPPING_LIST_IS_MASTER.sql`** (adds is_master for Trip Shopping persistent board).

After this, the Shopping List screen will load and save lists per vessel.
