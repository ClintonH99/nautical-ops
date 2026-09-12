-- Personal folders organise Sea Miles without modifying the official entry.
-- This keeps approved records permanently locked while allowing their owner
-- to move them between folders at any time.

CREATE TABLE IF NOT EXISTS public.sea_mile_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sea_mile_folders_owner_name_unique_idx
  ON public.sea_mile_folders (user_id, lower(trim(name)));

CREATE INDEX IF NOT EXISTS sea_mile_folders_owner_idx
  ON public.sea_mile_folders (user_id, name);

CREATE TABLE IF NOT EXISTS public.sea_mile_folder_items (
  entry_id UUID PRIMARY KEY REFERENCES public.sea_mile_entries(id) ON DELETE CASCADE,
  folder_id UUID NOT NULL REFERENCES public.sea_mile_folders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sea_mile_folder_items_folder_idx
  ON public.sea_mile_folder_items (folder_id);

DROP TRIGGER IF EXISTS update_sea_mile_folders_updated_at ON public.sea_mile_folders;
CREATE TRIGGER update_sea_mile_folders_updated_at
  BEFORE UPDATE ON public.sea_mile_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_sea_mile_folder_items_updated_at ON public.sea_mile_folder_items;
CREATE TRIGGER update_sea_mile_folder_items_updated_at
  BEFORE UPDATE ON public.sea_mile_folder_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.sea_mile_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sea_mile_folder_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read sea-mile folders" ON public.sea_mile_folders;
CREATE POLICY "Owners read sea-mile folders"
  ON public.sea_mile_folders FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Owners create sea-mile folders" ON public.sea_mile_folders;
CREATE POLICY "Owners create sea-mile folders"
  ON public.sea_mile_folders FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Owners rename sea-mile folders" ON public.sea_mile_folders;
CREATE POLICY "Owners rename sea-mile folders"
  ON public.sea_mile_folders FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Owners delete sea-mile folders" ON public.sea_mile_folders;
CREATE POLICY "Owners delete sea-mile folders"
  ON public.sea_mile_folders FOR DELETE TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Owners read sea-mile folder assignments" ON public.sea_mile_folder_items;
CREATE POLICY "Owners read sea-mile folder assignments"
  ON public.sea_mile_folder_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sea_mile_entries entry
      WHERE entry.id = entry_id AND entry.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.sea_mile_folders folder
      WHERE folder.id = folder_id AND folder.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners create sea-mile folder assignments" ON public.sea_mile_folder_items;
CREATE POLICY "Owners create sea-mile folder assignments"
  ON public.sea_mile_folder_items FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sea_mile_entries entry
      WHERE entry.id = entry_id AND entry.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.sea_mile_folders folder
      WHERE folder.id = folder_id AND folder.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners move sea-mile folder assignments" ON public.sea_mile_folder_items;
CREATE POLICY "Owners move sea-mile folder assignments"
  ON public.sea_mile_folder_items FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sea_mile_entries entry
      WHERE entry.id = entry_id AND entry.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.sea_mile_folders folder
      WHERE folder.id = folder_id AND folder.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sea_mile_entries entry
      WHERE entry.id = entry_id AND entry.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.sea_mile_folders folder
      WHERE folder.id = folder_id AND folder.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners remove sea-mile folder assignments" ON public.sea_mile_folder_items;
CREATE POLICY "Owners remove sea-mile folder assignments"
  ON public.sea_mile_folder_items FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sea_mile_entries entry
      WHERE entry.id = entry_id AND entry.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.sea_mile_folders folder
      WHERE folder.id = folder_id AND folder.user_id = auth.uid()
    )
  );

REVOKE ALL ON TABLE public.sea_mile_folders FROM anon;
REVOKE ALL ON TABLE public.sea_mile_folder_items FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sea_mile_folders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sea_mile_folder_items TO authenticated;
