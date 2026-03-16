# Run Contract Type Migration

## What This Does

Adds a `contract_type` column to the `profiles` (users) table in Supabase.
This supports the new Crew Contract Type feature: Permanent, Temporary (TEMP badge), Rotational (Rotation badge).

## Steps

1. Open your [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Go to **SQL Editor** (left sidebar)
4. Paste and run the following SQL:

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS contract_type TEXT NOT NULL DEFAULT 'permanent'
  CHECK (contract_type IN ('permanent', 'temporary', 'rotational'));
```

> **Note:** If your users table is named `users` instead of `profiles`, replace `public.profiles` with `public.users` in the SQL above.

## After Running

- All existing crew members will default to `permanent` (no badge shown).
- New crew members will set their contract type during registration.
- HODs and Captains can change a crew member's contract type from the Crew Management screen.

## Verification

Run this query to confirm the column was added:

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'profiles' AND column_name = 'contract_type';
```
