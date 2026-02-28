-- Add department to pre-departure checklists for filtering

ALTER TABLE public.pre_departure_checklists
  ADD COLUMN IF NOT EXISTS department TEXT CHECK (department IN ('BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'));
