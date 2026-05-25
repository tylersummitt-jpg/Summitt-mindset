-- Unified SMS Meaning Interpreter Shadow Mode (telemetry only; no product state).
-- Service-role writes from app; no client-facing access.

CREATE TABLE v2_sms_meaning_interpretation_shadow (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  commitment_id UUID NULL,
  sms_inbound_message_id UUID NULL,
  inbound_message_sid TEXT NOT NULL,
  coach_job_message_sid TEXT NULL,
  deterministic_route TEXT NOT NULL,
  deterministic_facts JSONB NOT NULL DEFAULT '{}'::jsonb,
  model TEXT NULL,
  prompt_version TEXT NOT NULL,
  shadow_json JSONB NULL,
  primary_intent TEXT NULL,
  confidence NUMERIC NULL,
  disagreement BOOLEAN NOT NULL DEFAULT false,
  disagreement_flags TEXT[] NULL,
  latency_ms INTEGER NULL,
  ok BOOLEAN NOT NULL DEFAULT false,
  error_code TEXT NULL,
  shadow_status TEXT NOT NULL DEFAULT 'openai_ok'
    CHECK (shadow_status IN ('openai_ok', 'openai_failed', 'skipped')),
  skipped_reason TEXT NULL,
  outcome_sent BOOLEAN NOT NULL DEFAULT true,
  body_preview TEXT NULL,
  reply_body_preview TEXT NULL,
  body_hash TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_v2_sms_meaning_shadow_inbound_message_sid
  ON v2_sms_meaning_interpretation_shadow (inbound_message_sid);

CREATE INDEX idx_v2_sms_meaning_shadow_clerk_created
  ON v2_sms_meaning_interpretation_shadow (clerk_user_id, created_at DESC);

CREATE INDEX idx_v2_sms_meaning_shadow_commitment_created
  ON v2_sms_meaning_interpretation_shadow (commitment_id, created_at DESC)
  WHERE commitment_id IS NOT NULL;

CREATE INDEX idx_v2_sms_meaning_shadow_disagreement_created
  ON v2_sms_meaning_interpretation_shadow (disagreement, created_at DESC);

CREATE INDEX idx_v2_sms_meaning_shadow_primary_intent_created
  ON v2_sms_meaning_interpretation_shadow (primary_intent, created_at DESC)
  WHERE primary_intent IS NOT NULL;

CREATE INDEX idx_v2_sms_meaning_shadow_ok_created
  ON v2_sms_meaning_interpretation_shadow (ok, created_at DESC);

CREATE INDEX idx_v2_sms_meaning_shadow_route_created
  ON v2_sms_meaning_interpretation_shadow (deterministic_route, created_at DESC);

COMMENT ON TABLE v2_sms_meaning_interpretation_shadow IS
  'OpenAI meaning interpreter shadow telemetry. Non-authoritative; does not drive SMS routing or proof.';

ALTER TABLE v2_sms_meaning_interpretation_shadow ENABLE ROW LEVEL SECURITY;

-- No policies for anon/authenticated — service role bypasses RLS for server writes/reads.
