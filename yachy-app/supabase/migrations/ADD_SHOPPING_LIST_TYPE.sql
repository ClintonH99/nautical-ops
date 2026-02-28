-- Add list_type to shopping_lists (general vs trip)
-- Run in Supabase SQL Editor after CREATE_SHOPPING_LISTS_TABLE.sql

ALTER TABLE public.shopping_lists
  ADD COLUMN IF NOT EXISTS list_type TEXT NOT NULL DEFAULT 'general'
  CHECK (list_type IN ('general', 'trip'));

CREATE INDEX IF NOT EXISTS idx_shopping_lists_list_type ON public.shopping_lists(list_type);

COMMENT ON COLUMN public.shopping_lists.list_type IS 'general = General Shopping, trip = Trip Shopping';
