-- Add push_token for Expo push notifications

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS push_token TEXT;

COMMENT ON COLUMN public.users.push_token IS 'Expo push token for notifications';
