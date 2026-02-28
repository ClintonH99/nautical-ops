-- Add weight and weight_unit to general waste logs

ALTER TABLE public.general_waste_logs
  ADD COLUMN IF NOT EXISTS weight NUMERIC,
  ADD COLUMN IF NOT EXISTS weight_unit TEXT DEFAULT 'kgs';
