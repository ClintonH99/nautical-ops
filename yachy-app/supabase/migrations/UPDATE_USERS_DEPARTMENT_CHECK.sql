-- Update users.department check constraint to new values: Bridge, Engineering, Exterior, Interior, Galley
-- Run this in Supabase SQL Editor. Order matters: DROP first, then UPDATE, then ADD.

-- 1. Remove the old constraint (so it no longer blocks BRIDGE / new values)
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_department_check;

-- 2. Migrate existing data: map old "DECK" to "BRIDGE"
UPDATE public.users
SET department = 'BRIDGE'
WHERE department = 'DECK';

-- 3. Add the new constraint
ALTER TABLE public.users
  ADD CONSTRAINT users_department_check
  CHECK (department IN ('BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'));
