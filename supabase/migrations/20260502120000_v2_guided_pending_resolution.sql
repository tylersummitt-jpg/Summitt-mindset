-- V2: bounded pending state after refresh SMS handoff (CHANGE / NEW → app).
ALTER TABLE v2_commitment
  ADD COLUMN IF NOT EXISTS pending_resolution_kind TEXT NULL,
  ADD COLUMN IF NOT EXISTS pending_resolution_created_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS pending_resolution_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS pending_resolution_payload JSONB NULL;

COMMENT ON COLUMN v2_commitment.pending_resolution_kind IS 'identity_anchor_update | commitment_replace (app guided flow)';
COMMENT ON COLUMN v2_commitment.pending_resolution_expires_at IS 'Abandon handoff after this time; cleared on save/cancel/reactivation.';
