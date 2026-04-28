-- Weak no-reply counters for V2 learned send-time (additive, rollback = DROP COLUMN).

ALTER TABLE v2_user_send_time_profile
  ADD COLUMN IF NOT EXISTS weak_no_reply_morning INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weak_no_reply_midday INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weak_no_reply_afternoon INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weak_no_reply_evening INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN v2_user_send_time_profile.weak_no_reply_morning IS
  'Bounded weak-negative count: accountability check sent in morning window with no same-calendar-day user outcome.';
