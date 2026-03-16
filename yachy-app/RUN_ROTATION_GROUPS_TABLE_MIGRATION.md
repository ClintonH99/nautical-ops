# Run Rotation Groups Table Migration

## What This Does

Creates a `rotation_groups` table to store named rotation groups (e.g. "Bridge Team", "Stew Team").
Users are linked to a group via their existing `rotation_group_id` column, which now references `rotation_groups.id`.

## Steps

1. Open your [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Go to **SQL Editor** (left sidebar)
4. Paste and run the following SQL:

```sql
CREATE TABLE IF NOT EXISTS public.rotation_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## After Running

- HOD and MOV can create named rotation groups from the Rotational Groups screen.
- Existing crew with a `rotation_group_id` set (from the previous migration) will appear as "Ungrouped" until their group is re-created with a name.

## Verification

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name = 'rotation_groups';
```
