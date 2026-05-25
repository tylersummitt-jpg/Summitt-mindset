-- Victory Room: persisted season summary snapshot (server/service-role only).

CREATE TABLE v2_victory_season_summary_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  season_id UUID NOT NULL REFERENCES user_accountability_season (id) ON DELETE CASCADE,
  commitment_id UUID NOT NULL REFERENCES v2_commitment (id) ON DELETE CASCADE,
  summary_text TEXT NULL,
  strongest_proof_moment_id TEXT NULL,
  pattern_text TEXT NULL,
  principle_lived_title TEXT NULL,
  proof_moment_count INTEGER NOT NULL DEFAULT 0,
  confidence TEXT NOT NULL DEFAULT 'none',
  source_hash TEXT NOT NULL,
  valid_for_season_key TEXT NOT NULL,
  input_bundle_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason_for_update TEXT NOT NULL DEFAULT 'initial',
  provenance TEXT NOT NULL DEFAULT 'deterministic',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT v2_victory_season_summary_snapshot_confidence_chk CHECK (
    confidence IN ('none', 'low', 'medium', 'high')
  ),
  CONSTRAINT v2_victory_season_summary_snapshot_provenance_chk CHECK (
    provenance IN ('deterministic', 'ai', 'fallback')
  ),
  CONSTRAINT v2_victory_season_summary_snapshot_reason_for_update_chk CHECK (
    reason_for_update IN (
      'initial',
      'source_hash_match',
      'season_closed',
      'weekly_refresh',
      'first_real_proof',
      'major_evidence_change',
      'pat_read_changed',
      'pat_principles_changed',
      'fallback'
    )
  ),
  CONSTRAINT v2_victory_season_summary_snapshot_proof_moment_count_chk CHECK (
    proof_moment_count >= 0
  )
);

CREATE UNIQUE INDEX uq_v2_victory_season_summary_snapshot_clerk_season
  ON v2_victory_season_summary_snapshot (clerk_user_id, season_id);

CREATE INDEX idx_v2_victory_season_summary_snapshot_clerk_generated
  ON v2_victory_season_summary_snapshot (clerk_user_id, generated_at DESC);

CREATE INDEX idx_v2_victory_season_summary_snapshot_season
  ON v2_victory_season_summary_snapshot (season_id);

CREATE INDEX idx_v2_victory_season_summary_snapshot_commitment
  ON v2_victory_season_summary_snapshot (commitment_id);

CREATE INDEX idx_v2_victory_season_summary_snapshot_source_hash
  ON v2_victory_season_summary_snapshot (source_hash);

ALTER TABLE v2_victory_season_summary_snapshot ENABLE ROW LEVEL SECURITY;
