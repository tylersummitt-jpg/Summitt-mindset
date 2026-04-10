-- Shadow-mode weekly SMS reflections (not sent; parallel to production weekly SMS)

CREATE TABLE weekly_sms_reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  week_start_date DATE NOT NULL,
  memory_bucket TEXT NOT NULL,
  sms_body TEXT NOT NULL,
  inputs_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT weekly_sms_reflections_user_week_uniq UNIQUE (clerk_user_id, week_key)
);

CREATE INDEX idx_weekly_sms_reflections_clerk ON weekly_sms_reflections (clerk_user_id);
CREATE INDEX idx_weekly_sms_reflections_week_key ON weekly_sms_reflections (week_key);
