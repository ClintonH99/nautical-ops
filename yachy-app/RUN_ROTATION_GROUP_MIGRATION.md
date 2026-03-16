# Run Rotation Group Migration

## What This Does

Adds a `rotation_group_id` column (UUID, nullable) to the `users` table.
Crew members assigned the same UUID are linked as a rotation group (e.g. two Chief Stews rotating the same role).

## Steps

1. Open your [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Go to **SQL Editor** (left sidebar)
4. Paste and run the following SQL:

```sql
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS rotation_group_id UUID DEFAULT NULL;
```

## After Running

- All existing crew will have `rotation_group_id = NULL` (not in any group).
- HOD/MOV can link rotational crew into groups from the Rotational Groups screen in Crew Management.

## Verification

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'users' AND column_name = 'rotation_group_id';
```
