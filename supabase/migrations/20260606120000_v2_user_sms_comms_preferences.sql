-- Slice C: durable SMS timing / cadence / pause preferences (user-scoped). Additive only.

CREATE TABLE v2_user_sms_comms_preferences (
  clerk_user_id TEXT PRIMARY KEY,

  pause_until TIMESTAMPTZ NULL,
  pause_reason_category TEXT NULL,

  cadence_override TEXT NULL,
  weekend_send_policy TEXT NULL,

  preferred_send_window TEXT NULL,
  preferred_local_hour SMALLINT NULL,

  source_message_sid TEXT NULL,
  resume_prompt_sent_at TIMESTAMPTZ NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT v2_user_sms_comms_prefs_pause_reason_chk CHECK (
    pause_reason_category IS NULL OR pause_reason_category IN (
      'vacation',
      'travel',
      'illness',
      'family_emergency',
      'grief',
      'hospital_or_surgery',
      'competition_or_camp',
      'work_or_schedule_overload',
      'pause_request',
      'weekend_or_short_break',
      'other'
    )
  ),
  CONSTRAINT v2_user_sms_comms_prefs_cadence_chk CHECK (
    cadence_override IS NULL OR cadence_override IN (
      'daily',
      'every_other_day',
      'every_3_days'
    )
  ),
  CONSTRAINT v2_user_sms_comms_prefs_weekend_chk CHECK (
    weekend_send_policy IS NULL OR weekend_send_policy IN ('all', 'weekdays_only')
  ),
  CONSTRAINT v2_user_sms_comms_prefs_window_chk CHECK (
    preferred_send_window IS NULL OR preferred_send_window IN (
      'morning',
      'midday',
      'afternoon',
      'evening'
    )
  ),
  CONSTRAINT v2_user_sms_comms_prefs_hour_chk CHECK (
    preferred_local_hour IS NULL OR (preferred_local_hour >= 0 AND preferred_local_hour <= 23)
  )
);

CREATE INDEX idx_v2_user_sms_comms_prefs_pause_until
  ON v2_user_sms_comms_preferences (pause_until)
  WHERE pause_until IS NOT NULL;

COMMENT ON TABLE v2_user_sms_comms_preferences IS
  'User-scoped SMS timing/cadence/pause overrides. STOP/opt-out remains sms_audience/sms_identities.';

ALTER TABLE v2_user_sms_comms_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY v2_user_sms_comms_prefs_select_own ON v2_user_sms_comms_preferences
  FOR SELECT
  TO authenticated
  USING (clerk_user_id = (auth.jwt() ->> 'sub'));

CREATE OR REPLACE FUNCTION set_v2_user_sms_comms_prefs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_v2_user_sms_comms_prefs_updated_at
  BEFORE UPDATE ON v2_user_sms_comms_preferences
  FOR EACH ROW
  EXECUTE PROCEDURE set_v2_user_sms_comms_prefs_updated_at();
