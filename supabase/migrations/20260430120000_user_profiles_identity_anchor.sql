-- Identity anchor for V2 coaching (user-origin; user_profiles is source of truth).
-- Additive only; no new tables.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS identity_anchor_text TEXT NULL,
  ADD COLUMN IF NOT EXISTS identity_source TEXT NULL,
  ADD COLUMN IF NOT EXISTS identity_last_confirmed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS identity_refresh_due_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS identity_last_referenced_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN user_profiles.identity_source IS
  'e.g. onboarding_life_desires | user_edited — informational; not enforced by CHECK in v1.';
