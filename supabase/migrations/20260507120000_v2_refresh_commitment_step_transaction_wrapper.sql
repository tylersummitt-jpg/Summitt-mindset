-- V2 refresh transactional wrapper (first slice): commitment-step outcomes only.
-- Atomic bundle: validate active refresh_session(step=commitment), insert resolved event,
-- clear refresh_session, and set/clear pending_resolution state.

CREATE OR REPLACE FUNCTION v2_apply_refresh_commitment_step_resolution_mutation(
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
  pending_resolution_kind TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_row v2_commitment%ROWTYPE;
  v_resolution TEXT;
  v_session JSONB;
  v_session_step TEXT;
  v_session_id TEXT;
  v_event_idempotency_key TEXT;
  v_pending_kind TEXT;
  v_pending_created_at TIMESTAMPTZ;
  v_pending_expires_at TIMESTAMPTZ;
  v_pending_payload JSONB;
BEGIN
  v_resolution := lower(trim(coalesce(p_resolution, '')));
  IF v_resolution NOT IN ('keep', 'tighten', 'new', 'aborted_unclear') THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ, NULL::TEXT;
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
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::TIMESTAMPTZ, NULL::TEXT;
    RETURN;
  END IF;

  IF p_expected_updated_at IS NOT NULL
     AND v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at, NULL::TEXT;
    RETURN;
  END IF;

  IF v_row.refresh_session IS NULL OR jsonb_typeof(v_row.refresh_session) <> 'object' THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at, NULL::TEXT;
    RETURN;
  END IF;
  v_session := v_row.refresh_session;
  v_session_step := trim(coalesce(v_session->>'step', ''));
  v_session_id := trim(coalesce(v_session->>'session_id', ''));
  IF v_session_step <> 'commitment' OR v_session_id = '' THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at, NULL::TEXT;
    RETURN;
  END IF;
  IF p_expected_session_id IS NOT NULL
     AND trim(p_expected_session_id) <> ''
     AND trim(p_expected_session_id) <> v_session_id THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at, NULL::TEXT;
    RETURN;
  END IF;

  v_event_idempotency_key := format(
    'v2_coaching_refresh_resolved:%s:%s:%s:%s:%s',
    p_commitment_id::TEXT,
    v_session_id,
    'commitment',
    v_resolution,
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
      v_row.pending_resolution_kind;
    RETURN;
  END IF;

  IF v_resolution = 'tighten' THEN
    v_pending_kind := 'commitment_tighten';
    v_pending_created_at := p_now;
    v_pending_expires_at := p_now + interval '7 days';
    v_pending_payload := jsonb_build_object(
      'source', 'coaching_refresh_resolved',
      'resolution', 'tighten',
      'session_id', v_session_id,
      'inbound_message_sid', trim(coalesce(p_inbound_message_sid, ''))
    );
  ELSIF v_resolution = 'new' THEN
    v_pending_kind := 'commitment_replace';
    v_pending_created_at := p_now;
    v_pending_expires_at := p_now + interval '7 days';
    v_pending_payload := jsonb_build_object(
      'source', 'coaching_refresh_resolved',
      'resolution', 'new',
      'session_id', v_session_id,
      'inbound_message_sid', trim(coalesce(p_inbound_message_sid, ''))
    );
  ELSE
    v_pending_kind := NULL;
    v_pending_created_at := NULL;
    v_pending_expires_at := NULL;
    v_pending_payload := NULL;
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
      'step', 'commitment',
      'resolution', v_resolution,
      'inbound_message_sid', trim(coalesce(p_inbound_message_sid, ''))
    ),
    v_event_idempotency_key
  );

  UPDATE v2_commitment
  SET refresh_session = NULL,
      pending_resolution_kind = v_pending_kind,
      pending_resolution_created_at = v_pending_created_at,
      pending_resolution_expires_at = v_pending_expires_at,
      pending_resolution_payload = v_pending_payload,
      updated_at = p_now
  WHERE id = p_commitment_id
  RETURNING v2_commitment.updated_at, v2_commitment.pending_resolution_kind
  INTO v_row.updated_at, v_row.pending_resolution_kind;

  RETURN QUERY SELECT
    'applied'::TEXT,
    v_row.updated_at,
    v_row.pending_resolution_kind;
END;
$$;

COMMENT ON FUNCTION v2_apply_refresh_commitment_step_resolution_mutation(
  UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) IS 'Transactional wrapper for V2 refresh commitment-step resolution (keep/tighten/new/aborted_unclear): validates session state, inserts coaching_refresh_resolved, clears refresh_session, and sets/clears pending_resolution atomically.';
