-- V2 standard accountability outbound deterministic post-send bookkeeping.
-- Scope: canonical check_sent spine write + deterministic outbound intent snapshot.

CREATE TABLE IF NOT EXISTS v2_check_sent_outbound_intent_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id UUID NOT NULL REFERENCES v2_commitment(id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  message_sid TEXT NOT NULL,
  template_id INTEGER NOT NULL,
  template_family TEXT NOT NULL CHECK (template_family IN ('standard', 'recovery')),
  body_preview TEXT NOT NULL DEFAULT '',
  effective_ask_text TEXT NOT NULL DEFAULT '',
  prompt_kind TEXT NOT NULL CHECK (prompt_kind IN ('standard_accountability', 'contract_overlay_proposal')),
  expected_reply_semantics TEXT NOT NULL CHECK (expected_reply_semantics IN ('yes_no_partial', 'proposal_yes_no')),
  check_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL,
  source_wrapped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS v2_check_sent_outbound_intent_snapshot_key_idx
  ON v2_check_sent_outbound_intent_snapshot (idempotency_key);

CREATE INDEX IF NOT EXISTS v2_check_sent_outbound_intent_snapshot_commitment_time_idx
  ON v2_check_sent_outbound_intent_snapshot (commitment_id, source_wrapped_at DESC);

CREATE OR REPLACE FUNCTION v2_apply_check_sent_post_send_bookkeeping_mutation(
  p_commitment_id UUID,
  p_clerk_user_id TEXT,
  p_day_key TEXT,
  p_message_sid TEXT,
  p_template_id INTEGER,
  p_template_family TEXT,
  p_body_preview TEXT,
  p_effective_ask_text TEXT,
  p_prompt_kind TEXT,
  p_expected_reply_semantics TEXT,
  p_check_payload_json JSONB DEFAULT '{}'::jsonb,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  result TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_row v2_commitment%ROWTYPE;
  v_day_key TEXT;
  v_message_sid TEXT;
  v_template_family TEXT;
  v_prompt_kind TEXT;
  v_expected_reply_semantics TEXT;
  v_idempotency_key TEXT;
  v_payload JSONB;
BEGIN
  v_day_key := trim(coalesce(p_day_key, ''));
  v_message_sid := trim(coalesce(p_message_sid, ''));
  v_template_family := lower(trim(coalesce(p_template_family, '')));
  v_prompt_kind := lower(trim(coalesce(p_prompt_kind, '')));
  v_expected_reply_semantics := lower(trim(coalesce(p_expected_reply_semantics, '')));

  IF v_day_key = '' OR v_message_sid = '' THEN
    RETURN QUERY SELECT 'error'::TEXT;
    RETURN;
  END IF;
  IF p_template_id IS NULL OR p_template_id <= 0 THEN
    RETURN QUERY SELECT 'error'::TEXT;
    RETURN;
  END IF;
  IF v_template_family NOT IN ('standard', 'recovery') THEN
    RETURN QUERY SELECT 'error'::TEXT;
    RETURN;
  END IF;
  IF v_prompt_kind NOT IN ('standard_accountability', 'contract_overlay_proposal') THEN
    RETURN QUERY SELECT 'error'::TEXT;
    RETURN;
  END IF;
  IF v_expected_reply_semantics NOT IN ('yes_no_partial', 'proposal_yes_no') THEN
    RETURN QUERY SELECT 'error'::TEXT;
    RETURN;
  END IF;
  IF p_check_payload_json IS NULL OR jsonb_typeof(p_check_payload_json) <> 'object' THEN
    RETURN QUERY SELECT 'error'::TEXT;
    RETURN;
  END IF;

  SELECT *
  INTO v_row
  FROM v2_commitment
  WHERE id = p_commitment_id
    AND clerk_user_id = p_clerk_user_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT;
    RETURN;
  END IF;

  v_idempotency_key := format('v2_check_sent:%s:%s', p_commitment_id::TEXT, v_day_key);
  IF EXISTS (
    SELECT 1 FROM v2_commitment_event WHERE idempotency_key = v_idempotency_key
  ) THEN
    RETURN QUERY SELECT 'already_applied'::TEXT;
    RETURN;
  END IF;

  v_payload := p_check_payload_json
    || jsonb_build_object(
      'day_key', v_day_key,
      'template_id', p_template_id,
      'template_family', v_template_family,
      'channel', 'sms',
      'message_sid', v_message_sid,
      'body_preview', left(coalesce(p_body_preview, ''), 160),
      'effective_ask_text', left(coalesce(p_effective_ask_text, ''), 240),
      'prompt_kind', v_prompt_kind,
      'expected_reply_semantics', v_expected_reply_semantics
    );

  INSERT INTO v2_check_sent_outbound_intent_snapshot (
    commitment_id,
    clerk_user_id,
    day_key,
    message_sid,
    template_id,
    template_family,
    body_preview,
    effective_ask_text,
    prompt_kind,
    expected_reply_semantics,
    check_payload_json,
    idempotency_key,
    source_wrapped_at
  )
  VALUES (
    p_commitment_id,
    p_clerk_user_id,
    v_day_key,
    v_message_sid,
    p_template_id,
    v_template_family,
    left(coalesce(p_body_preview, ''), 160),
    left(coalesce(p_effective_ask_text, ''), 240),
    v_prompt_kind,
    v_expected_reply_semantics,
    v_payload,
    v_idempotency_key,
    p_now
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  INSERT INTO v2_commitment_event (
    commitment_id,
    clerk_user_id,
    event_type,
    occurred_at,
    source,
    payload_json,
    idempotency_key
  )
  VALUES (
    p_commitment_id,
    p_clerk_user_id,
    'check_sent',
    p_now,
    'sms_v2_accountability',
    v_payload,
    v_idempotency_key
  );

  RETURN QUERY SELECT 'applied'::TEXT;
END;
$$;

COMMENT ON TABLE v2_check_sent_outbound_intent_snapshot IS 'Deterministic source-of-truth snapshots for standard V2 accountability check_sent post-send bookkeeping.';

COMMENT ON FUNCTION v2_apply_check_sent_post_send_bookkeeping_mutation(
  UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ
) IS 'Transactional wrapper for standard V2 accountability post-send bookkeeping: inserts deterministic outbound intent snapshot and canonical check_sent event atomically.';
