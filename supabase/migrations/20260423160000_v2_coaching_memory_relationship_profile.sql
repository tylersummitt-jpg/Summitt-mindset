-- V2 SMS: long-horizon relationship profile (rule-derived projection on coaching memory).
-- Additive only. No new spine event types.

ALTER TABLE v2_commitment_coaching_memory
  ADD COLUMN IF NOT EXISTS relationship_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS relationship_profile_version TEXT NULL,
  ADD COLUMN IF NOT EXISTS relationship_profile_updated_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN v2_commitment_coaching_memory.relationship_profile IS
  'Structured sms_relationship_v1 JSON: tone/density fit hints; rule-derived; not authoritative for cadence/next_move/overlays.';
