-- V2: explicit identity + commitment refresh session (SMS-first, auditable).
ALTER TABLE v2_commitment
  ADD COLUMN IF NOT EXISTS refresh_session JSONB NULL,
  ADD COLUMN IF NOT EXISTS commitment_refresh_last_prompted_at TIMESTAMPTZ NULL;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS identity_refresh_last_prompted_at TIMESTAMPTZ NULL;

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
    'contract_overlay_proposed',
    'contract_overlay_activated',
    'contract_overlay_declined',
    'coaching_refresh_prompted',
    'coaching_refresh_resolved',
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
