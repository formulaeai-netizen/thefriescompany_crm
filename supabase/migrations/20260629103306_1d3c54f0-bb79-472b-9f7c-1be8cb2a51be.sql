
ALTER TABLE public.daily_production
  ADD COLUMN IF NOT EXISTS day_end_sent boolean DEFAULT false;

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS day_end_notification_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS day_end_report_time time DEFAULT '20:00',
  ADD COLUMN IF NOT EXISTS day_end_last_sent_at timestamptz;
