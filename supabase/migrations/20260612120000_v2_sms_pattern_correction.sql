-- Durable SMS pattern correction hints (review/storage only; non-authoritative).
-- Service-role writes from app; no client-facing access.

CREATE TABLE v2_sms_pattern_correction (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL,
  clerk_user_id TEXT NULL,
  commitment_id UUID NULL,
  correction_type TEXT NOT NULL,
  phrase_pattern TEXT NULL,
  normalized_pattern TEXT NULL,
  meaning_label TEXT NOT NULL,
  correction_summary TEXT NOT NULL,
  usage_policy TEXT NOT NULL DEFAULT 'prompt_hint_only',
  status TEXT NOT NULL DEFAULT 'suggested',
  source TEXT NOT NULL,
  source_shadow_id UUID NULL REFERENCES v2_sms_meaning_interpretation_shadow (id) ON DELETE SET NULL,
  source_event_id UUID NULL,
  source_message_sid TEXT NULL,
  confidence NUMERIC NULL,
  review_note TEXT NULL,
  reviewed_by TEXT NULL,
  reviewed_at TIMESTAMPTZ NULL,
  created_by TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NULL,
  last_used_at TIMESTAMPTZ NULL,
  use_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT v2_sms_pattern_correction_scope_chk CHECK (
    scope IN ('user', 'commitment', 'global')
  ),
  CONSTRAINT v2_sms_pattern_correction_status_chk CHECK (
    status IN ('suggested', 'approved', 'rejected', 'archived')
  ),
  CONSTRAINT v2_sms_pattern_correction_usage_policy_chk CHECK (
    usage_policy IN ('blocked', 'prompt_hint_only', 'routing_hint_shadow', 'routing_hint_reviewed')
  ),
  CONSTRAINT v2_sms_pattern_correction_source_chk CHECK (
    source IN (
      'shadow_review',
      'user_correction',
      'operator_seed',
      'deterministic_pattern',
      'app_action',
      'offline_replay'
    )
  ),
  CONSTRAINT v2_sms_pattern_correction_type_chk CHECK (
    correction_type IN (
      'user_phrase_meaning',
      'open_question_answer_style',
      'blocker_phrase_pattern',
      'completion_phrase_pattern',
      'non_completion_phrase_pattern',
      'goal_change_phrase_pattern',
      'pause_or_cadence_phrase_pattern',
      'season_change_phrase_pattern',
      'frustration_or_repetition_signal',
      'do_not_repeat_question_pattern',
      'clarification_needed_pattern',
      'tone_preference_observed',
      'app_sms_alignment_pattern',
      'false_positive_route',
      'false_negative_route',
      'global_parser_rule_candidate',
      'user_specific_parser_hint',
      'shadow_disagreement_reviewed'
    )
  ),
  CONSTRAINT v2_sms_pattern_correction_confidence_chk CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  ),
  CONSTRAINT v2_sms_pattern_correction_use_count_chk CHECK (use_count >= 0),
  CONSTRAINT v2_sms_pattern_correction_scope_user_chk CHECK (
    scope <> 'user'
    OR (clerk_user_id IS NOT NULL AND commitment_id IS NULL)
  ),
  CONSTRAINT v2_sms_pattern_correction_scope_commitment_chk CHECK (
    scope <> 'commitment'
    OR (clerk_user_id IS NOT NULL AND commitment_id IS NOT NULL)
  ),
  CONSTRAINT v2_sms_pattern_correction_scope_global_chk CHECK (
    scope <> 'global'
    OR (clerk_user_id IS NULL AND commitment_id IS NULL)
  ),
  CONSTRAINT v2_sms_pattern_correction_pattern_chk CHECK (
    (
      phrase_pattern IS NOT NULL
      AND length(trim(phrase_pattern)) > 0
    )
    OR (
      normalized_pattern IS NOT NULL
      AND length(trim(normalized_pattern)) > 0
    )
  )
);

CREATE INDEX idx_v2_sms_pattern_correction_clerk_status_type
  ON v2_sms_pattern_correction (clerk_user_id, status, correction_type);

CREATE INDEX idx_v2_sms_pattern_correction_commitment_status
  ON v2_sms_pattern_correction (commitment_id, status);

CREATE INDEX idx_v2_sms_pattern_correction_scope_status_type
  ON v2_sms_pattern_correction (scope, status, correction_type);

CREATE INDEX idx_v2_sms_pattern_correction_source_shadow_id
  ON v2_sms_pattern_correction (source_shadow_id);

CREATE INDEX idx_v2_sms_pattern_correction_source_message_sid
  ON v2_sms_pattern_correction (source_message_sid);

CREATE INDEX idx_v2_sms_pattern_correction_expires_at
  ON v2_sms_pattern_correction (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX idx_v2_sms_pattern_correction_updated_at
  ON v2_sms_pattern_correction (updated_at DESC);

CREATE UNIQUE INDEX uq_v2_sms_pattern_correction_approved_pattern
  ON v2_sms_pattern_correction (
    scope,
    coalesce(clerk_user_id, ''),
    coalesce(commitment_id::text, ''),
    correction_type,
    normalized_pattern
  )
  WHERE status = 'approved' AND normalized_pattern IS NOT NULL;

COMMENT ON TABLE v2_sms_pattern_correction IS
  'Reviewed SMS interpretation correction hints. Non-authoritative; must not mutate routing, proof, commitment, or season state.';

ALTER TABLE v2_sms_pattern_correction ENABLE ROW LEVEL SECURITY;

-- No policies for anon/authenticated — service role bypasses RLS for server writes/reads.
