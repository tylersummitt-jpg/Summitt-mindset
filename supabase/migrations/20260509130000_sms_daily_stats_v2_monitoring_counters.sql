ALTER TABLE IF EXISTS public.sms_daily_stats
  ADD COLUMN IF NOT EXISTS skipped_not_fully_on_v2 integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS user_loop_errors integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.sms_daily_stats.skipped_not_fully_on_v2
IS 'Count of users skipped in daily-sms because buildDailySmsContent returned not_fully_on_v2_daily_sms.';

COMMENT ON COLUMN public.sms_daily_stats.user_loop_errors
IS 'Count of per-user exceptions caught by the daily-sms cron loop.';
