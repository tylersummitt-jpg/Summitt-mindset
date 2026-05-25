-- Victory Room: persisted Coach Pat's Read (server/service-role only).

CREATE TABLE v2_victory_pat_read_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  commitment_id UUID NOT NULL REFERENCES v2_commitment (id) ON DELETE CASCADE,
  season_id UUID NULL REFERENCES user_accountability_season (id) ON DELETE SET NULL,
  strength_text TEXT NOT NULL,
  pattern_text TEXT NULL,
  next_move_text TEXT NOT NULL,
  provenance TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  valid_for_day_key TEXT NOT NULL,
  input_bundle_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  pattern_confidence TEXT NOT NULL DEFAULT 'none',
  reason_for_update TEXT NOT NULL DEFAULT 'initial',
  linked_proof_moment_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT v2_victory_pat_read_snapshot_provenance_chk CHECK (
    provenance IN ('deterministic', 'ai', 'fallback')
  ),
  CONSTRAINT v2_victory_pat_read_snapshot_pattern_confidence_chk CHECK (
    pattern_confidence IN ('none', 'low', 'medium', 'high')
  ),
  CONSTRAINT v2_victory_pat_read_snapshot_reason_for_update_chk CHECK (
    reason_for_update IN (
      'initial',
      'source_hash_match',
      'daily_refresh',
      'first_real_proof',
      'identity_changed',
      'goal_changed',
      'season_changed',
      'pattern_became_confident',
      'major_evidence_change',
      'fallback'
    )
  )
);

CREATE UNIQUE INDEX uq_v2_victory_pat_read_snapshot_clerk_commitment
  ON v2_victory_pat_read_snapshot (clerk_user_id, commitment_id);

CREATE INDEX idx_v2_victory_pat_read_snapshot_clerk_generated
  ON v2_victory_pat_read_snapshot (clerk_user_id, generated_at DESC);

CREATE INDEX idx_v2_victory_pat_read_snapshot_commitment
  ON v2_victory_pat_read_snapshot (commitment_id);

CREATE INDEX idx_v2_victory_pat_read_snapshot_source_hash
  ON v2_victory_pat_read_snapshot (source_hash);

ALTER TABLE v2_victory_pat_read_snapshot ENABLE ROW LEVEL SECURITY;
