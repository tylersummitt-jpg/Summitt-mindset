-- Victory Room: persisted Pat Principles snapshot (server/service-role only).

CREATE TABLE v2_victory_pat_principles_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  commitment_id UUID NOT NULL REFERENCES v2_commitment (id) ON DELETE CASCADE,
  season_id UUID NULL REFERENCES user_accountability_season (id) ON DELETE SET NULL,
  living_well_principle_id TEXT NULL,
  living_well_title TEXT NULL,
  living_well_text TEXT NULL,
  living_well_evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  focus_next_principle_id TEXT NOT NULL,
  focus_next_title TEXT NOT NULL,
  focus_next_text TEXT NOT NULL,
  focus_next_evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  starter_text TEXT NULL,
  confidence TEXT NOT NULL DEFAULT 'starter',
  source_hash TEXT NOT NULL,
  valid_for_week_key TEXT NOT NULL,
  input_bundle_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason_for_update TEXT NOT NULL DEFAULT 'initial',
  provenance TEXT NOT NULL DEFAULT 'deterministic',
  visible BOOLEAN NOT NULL DEFAULT true,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT v2_victory_pat_principles_snapshot_confidence_chk CHECK (
    confidence IN ('starter', 'low', 'medium', 'high')
  ),
  CONSTRAINT v2_victory_pat_principles_snapshot_provenance_chk CHECK (
    provenance IN ('deterministic', 'ai', 'fallback')
  ),
  CONSTRAINT v2_victory_pat_principles_snapshot_reason_for_update_chk CHECK (
    reason_for_update IN (
      'initial',
      'source_hash_match',
      'weekly_refresh',
      'first_real_proof',
      'identity_changed',
      'goal_changed',
      'season_changed',
      'pattern_became_confident',
      'major_evidence_change',
      'pat_read_changed',
      'fallback'
    )
  ),
  CONSTRAINT v2_victory_pat_principles_snapshot_living_well_principle_chk CHECK (
    living_well_principle_id IS NULL
    OR living_well_principle_id IN (
      'respect_self_and_others',
      'take_full_responsibility',
      'loyalty',
      'great_communicator',
      'discipline_yourself',
      'hard_work_passion',
      'work_smart',
      'team_before_self',
      'winning_attitude',
      'be_a_competitor',
      'change_is_a_must',
      'handle_success_and_failure'
    )
  ),
  CONSTRAINT v2_victory_pat_principles_snapshot_focus_next_principle_chk CHECK (
    focus_next_principle_id IN (
      'respect_self_and_others',
      'take_full_responsibility',
      'loyalty',
      'great_communicator',
      'discipline_yourself',
      'hard_work_passion',
      'work_smart',
      'team_before_self',
      'winning_attitude',
      'be_a_competitor',
      'change_is_a_must',
      'handle_success_and_failure'
    )
  ),
  CONSTRAINT v2_victory_pat_principles_snapshot_living_well_evidence_ids_chk CHECK (
    jsonb_typeof(living_well_evidence_ids) = 'array'
  ),
  CONSTRAINT v2_victory_pat_principles_snapshot_focus_next_evidence_ids_chk CHECK (
    jsonb_typeof(focus_next_evidence_ids) = 'array'
  )
);

CREATE UNIQUE INDEX uq_v2_victory_pat_principles_snapshot_clerk_commitment
  ON v2_victory_pat_principles_snapshot (clerk_user_id, commitment_id);

CREATE INDEX idx_v2_victory_pat_principles_snapshot_clerk_generated
  ON v2_victory_pat_principles_snapshot (clerk_user_id, generated_at DESC);

CREATE INDEX idx_v2_victory_pat_principles_snapshot_commitment
  ON v2_victory_pat_principles_snapshot (commitment_id);

CREATE INDEX idx_v2_victory_pat_principles_snapshot_source_hash
  ON v2_victory_pat_principles_snapshot (source_hash);

ALTER TABLE v2_victory_pat_principles_snapshot ENABLE ROW LEVEL SECURITY;
