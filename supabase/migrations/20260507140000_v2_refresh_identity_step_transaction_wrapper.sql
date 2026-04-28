-- V2 refresh transactional wrapper (identity-step slice).
-- Atomic bundle: validate identity refresh session state, insert resolved event,
-- mutate refresh_session, and set/clear pending_resolution state.

CREATE OR REPLACE FUNCTION v2_apply_refresh_identity_step_resolution_mutation(
  p_commitment_id UUID,
  p_clerk_user_id TEXT,
  p_inbound_message_sid TEXT,
  p_resolution TEXT,
  p_expected_session_id TEXT DEFAULT NULL,
  p_expected_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  result TEXT,
  updated_at TIMESTAMPTZ,
  pending_resolution_kind TEXT,
  refresh_session_step TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_row v2_commitment%ROWTYPE;
  v_resolution TEXT;
  v_session JSONB;
  v_session_step TEXT;
  v_session_id TEXT;
  v_started_at TEXT;
  v_channel TEXT;
  v_clarifications_remaining INTEGER;
  v_event_idempotency_key TEXT;
  v_event_resolution TEXT;
  v_next_refresh_session JSONB;
  v_pending_kind TEXT;
  v_pending_created_at TIMESTAMPTZ;
  v_pending_expires_at TIMESTAMPTZ;
  v_pending_payload JSONB;
BEGIN
  v_resolution := lower(trim(coalesce(p_resolution, '')));
  IF v_resolution NOT IN ('still', 'change', 'clarify_identity', 'aborted_unclear') THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ, NULL::TEXT, NULL::TEXT;
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
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::TIMESTAMPTZ, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF p_expected_updated_at IS NOT NULL
     AND v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at, v_row.pending_resolution_kind, NULL::TEXT;
    RETURN;
  END IF;

  IF v_row.refresh_session IS NULL OR jsonb_typeof(v_row.refresh_session) <> 'object' THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at, v_row.pending_resolution_kind, NULL::TEXT;
    RETURN;
  END IF;

  v_session := v_row.refresh_session;
  v_session_step := trim(coalesce(v_session->>'step', ''));
  v_session_id := trim(coalesce(v_session->>'session_id', ''));
  IF v_session_step <> 'identity' OR v_session_id = '' THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at, v_row.pending_resolution_kind, NULL::TEXT;
    RETURN;
  END IF;
  IF p_expected_session_id IS NOT NULL
     AND trim(p_expected_session_id) <> ''
     AND trim(p_expected_session_id) <> v_session_id THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at, v_row.pending_resolution_kind, v_session_step;
    RETURN;
  END IF;

  v_event_resolution := CASE
    WHEN v_resolution = 'clarify_identity' THEN 'clarify_identity'
    ELSE v_resolution
  END;
  v_event_idempotency_key := format(
    'v2_coaching_refresh_resolved:%s:%s:%s:%s:%s',
    p_commitment_id::TEXT,
    v_session_id,
    'identity',
    v_event_resolution,
    trim(coalesce(p_inbound_message_sid, 'none'))
  );

  IF EXISTS (
    SELECT 1
    FROM v2_commitment_event
    WHERE idempotency_key = v_event_idempotency_key
  ) THEN
    RETURN QUERY SELECT
      'already_applied'::TEXT,
      v_row.updated_at,
      v_row.pending_resolution_kind,
      v_session_step;
    RETURN;
  END IF;

  v_pending_kind := NULL;
  v_pending_created_at := NULL;
  v_pending_expires_at := NULL;
  v_pending_payload := NULL;
  v_next_refresh_session := NULL;

  IF v_resolution = 'still' THEN
    v_started_at := to_char(p_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    v_channel := coalesce(v_session->>'channel', 'sms');
    v_clarifications_remaining := COALESCE((v_session->>'clarifications_remaining')::INTEGER, 1);
    v_next_refresh_session := jsonb_build_object(
      'session_id', v_session_id,
      'step', 'commitment',
      'started_at', v_started_at,
      'channel', v_channel,
      'clarifications_remaining', GREATEST(0, v_clarifications_remaining),
      'commitment_prompt_delivered', false
    );
  ELSIF v_resolution = 'change' THEN
    v_pending_kind := 'identity_anchor_update';
    v_pending_created_at := p_now;
    v_pending_expires_at := p_now + interval '7 days';
    v_pending_payload := jsonb_build_object(
      'source', 'coaching_refresh_resolved',
      'resolution', 'change',
      'session_id', v_session_id,
      'inbound_message_sid', trim(coalesce(p_inbound_message_sid, ''))
    );
  ELSIF v_resolution = 'clarify_identity' THEN
    v_started_at := coalesce(v_session->>'started_at', to_char(p_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    v_channel := coalesce(v_session->>'channel', 'sms');
    v_clarifications_remaining := COALESCE((v_session->>'clarifications_remaining')::INTEGER, 0);
    IF v_clarifications_remaining <= 0 THEN
      RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at, v_row.pending_resolution_kind, v_session_step;
      RETURN;
    END IF;
    v_next_refresh_session := jsonb_build_object(
      'session_id', v_session_id,
      'step', 'identity',
      'started_at', v_started_at,
      'channel', v_channel,
      'clarifications_remaining', v_clarifications_remaining - 1,
      'commitment_prompt_delivered', (v_session->>'commitment_prompt_delivered') = 'true'
    );
  END IF;

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
    'coaching_refresh_resolved',
    p_now,
    'sms_v2_accountability',
    jsonb_build_object(
      'session_id', v_session_id,
      'step', 'identity',
      'resolution', v_event_resolution,
      'inbound_message_sid', trim(coalesce(p_inbound_message_sid, ''))
    ),
    v_event_idempotency_key
  );

  UPDATE v2_commitment
  SET refresh_session = v_next_refresh_session,
      pending_resolution_kind = v_pending_kind,
      pending_resolution_created_at = v_pending_created_at,
      pending_resolution_expires_at = v_pending_expires_at,
      pending_resolution_payload = v_pending_payload,
      updated_at = p_now
  WHERE id = p_commitment_id
  RETURNING
    v2_commitment.updated_at,
    v2_commitment.pending_resolution_kind,
    CASE
      WHEN v2_commitment.refresh_session IS NULL THEN NULL
      ELSE trim(coalesce(v2_commitment.refresh_session->>'step', ''))
    END
  INTO
    v_row.updated_at,
    v_row.pending_resolution_kind,
    v_session_step;

  RETURN QUERY SELECT
    'applied'::TEXT,
    v_row.updated_at,
    v_row.pending_resolution_kind,
    v_session_step;
END;
$$;

COMMENT ON FUNCTION v2_apply_refresh_identity_step_resolution_mutation(
  UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) IS 'Transactional wrapper for V2 refresh identity-step resolution (still/change/clarify_identity/aborted_unclear): validates session state, inserts coaching_refresh_resolved, mutates refresh_session, and sets/clears pending_resolution atomically.';
