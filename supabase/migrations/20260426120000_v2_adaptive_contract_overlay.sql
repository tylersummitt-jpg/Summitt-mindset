-- V2: temporary adaptive ask overlay + explicit shrink proposal (same commitment row).
-- Additive only. No new tables.

ALTER TABLE v2_commitment
  ADD COLUMN IF NOT EXISTS adaptive_ask_text TEXT NULL,
  ADD COLUMN IF NOT EXISTS adaptive_ask_active_from TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS adaptive_ask_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS adaptive_proposal_text TEXT NULL,
  ADD COLUMN IF NOT EXISTS adaptive_proposal_created_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS adaptive_proposal_expires_at TIMESTAMPTZ NULL;

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
