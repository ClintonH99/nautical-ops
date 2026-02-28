-- Add notification preferences (what types of notifications user wants)

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{
    "tasks": true,
    "trips": true,
    "preDeparture": true,
    "maintenance": true,
    "yardJobs": true,
    "watchSchedule": true
  }'::jsonb;

COMMENT ON COLUMN public.users.notification_preferences IS 'User preferences for which notification types to receive';
