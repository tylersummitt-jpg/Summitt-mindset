-- V2: pending blocker capture window + blocker_captured event type

ALTER TABLE v2_commitment
  ADD COLUMN IF NOT EXISTS blocker_capture_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS blocker_capture_after_event TEXT NULL;

ALTER TABLE v2_commitment_event DROP CONSTRAINT IF EXISTS v2_commitment_event_type_chk;

ALTER TABLE v2_commitment_event ADD CONSTRAINT v2_commitment_event_type_chk CHECK (
  event_type IN (
    'created',
    'activated',
    'check_sent',
    'user_yes',
    'user_no',
    'user_partial',
    'user_silent',
    'blocker_captured',
    'ask_shrunk',
    'timing_shifted',
    'tone_shifted',
    'paused',
    'resumed',
    'completed',
    'abandoned',
    'superseded'
  )
);
