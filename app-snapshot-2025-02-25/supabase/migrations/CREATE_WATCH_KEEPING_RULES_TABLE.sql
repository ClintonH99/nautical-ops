-- Watch Keeping Rules (one per vessel)
-- Run in Supabase SQL Editor
-- HODs can edit; crew can view

CREATE TABLE IF NOT EXISTS public.watch_keeping_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE UNIQUE,
  content TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_watch_rules_vessel_id ON public.watch_keeping_rules(vessel_id);

ALTER TABLE public.watch_keeping_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vessel members can read and manage watch rules"
  ON public.watch_keeping_rules
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.watch_keeping_rules IS 'Watch keeping rules text; HODs edit, crew view';
