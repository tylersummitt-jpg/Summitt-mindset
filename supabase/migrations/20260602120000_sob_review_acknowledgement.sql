-- SoB onboarding: persisted Review acknowledgment on commitment intake.

ALTER TABLE v2_commitment_intake
  ADD COLUMN IF NOT EXISTS review_acknowledged_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_v2_commitment_intake_review_acknowledged
  ON v2_commitment_intake (clerk_user_id, review_acknowledged_at)
  WHERE review_acknowledged_at IS NOT NULL;
