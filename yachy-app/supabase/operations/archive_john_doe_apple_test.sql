-- Manual, owner-approved web billing cutover. NOT a blanket Apple cleanup.
-- Run as postgres only after approval. No accounts or vessel records are removed.
BEGIN;

CREATE TABLE IF NOT EXISTS public.vessel_subscription_cutover_archive (
  subscription_id UUID PRIMARY KEY,
  vessel_id UUID NOT NULL,
  snapshot JSONB NOT NULL,
  reason TEXT NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.vessel_subscription_cutover_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vessel_subscription_cutover_archive FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  old_row public.vessel_subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO old_row FROM public.vessel_subscriptions
  WHERE id = 'b442bec0-3a37-401f-9780-859dd4a83622'
  FOR UPDATE;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.vessel_subscription_cutover_archive
      WHERE subscription_id = 'b442bec0-3a37-401f-9780-859dd4a83622'
        AND vessel_id = '2ac4d294-90f5-42f9-ab0e-44d19abd0d61') THEN
      RETURN; -- Already archived; never touch a replacement Paddle subscription.
    END IF;
    RAISE EXCEPTION 'Expected test subscription not found; investigate before cutover';
  END IF;

  IF old_row.vessel_id IS DISTINCT FROM '2ac4d294-90f5-42f9-ab0e-44d19abd0d61'::uuid
    OR old_row.payment_provider IS DISTINCT FROM 'apple'
    OR old_row.status IS DISTINCT FROM 'active'
    OR old_row.current_period_end IS DISTINCT FROM '2026-07-29 18:52:27+00'::timestamptz
    OR old_row.updated_at IS DISTINCT FROM '2026-07-28 18:58:25.741+00'::timestamptz
    OR old_row.paddle_subscription_id IS NOT NULL THEN
    RAISE EXCEPTION 'Test subscription changed since inspection; refusing to archive';
  END IF;

  INSERT INTO public.vessel_subscription_cutover_archive
    (subscription_id, vessel_id, snapshot, reason)
  VALUES (old_row.id, old_row.vessel_id, to_jsonb(old_row),
    'Owner-confirmed Apple sandbox test; expired July 2026; Paddle web cutover');

  DELETE FROM public.vessel_subscriptions WHERE id = old_row.id;
END;
$$;

COMMIT;
