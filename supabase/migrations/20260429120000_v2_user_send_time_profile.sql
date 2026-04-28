-- V2: learned send-time profile (user-scoped, rule-derived). Additive only.

CREATE TABLE v2_user_send_time_profile (
  clerk_user_id TEXT PRIMARY KEY,
  preferred_window TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  reply_count_morning INTEGER NOT NULL DEFAULT 0,
  reply_count_midday INTEGER NOT NULL DEFAULT 0,
  reply_count_afternoon INTEGER NOT NULL DEFAULT 0,
  reply_count_evening INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT v2_user_send_time_profile_window_chk CHECK (
    preferred_window IN ('morning', 'midday', 'afternoon', 'evening')
  )
);

CREATE INDEX idx_v2_user_send_time_profile_confidence
  ON v2_user_send_time_profile (confidence DESC);
