-- Add optional second department for crew (e.g. deck/stew = Exterior + Interior)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS department_2 TEXT
  CHECK (department_2 IS NULL OR department_2 IN ('BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'));

COMMENT ON COLUMN public.users.department_2 IS 'Optional second department for dual-role crew (e.g. deck/stew)';
