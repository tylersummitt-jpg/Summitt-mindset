-- V2 refresh post-send prompted bookkeeping wrapper.
-- Atomic bundle after successful outbound refresh SMS send:
-- - validate active commitment/session state
-- - persist refresh_session progression
-- - update prompted timestamp field(s)
-- - insert coaching_refresh_prompted event

CREATE OR REPLACE FUNCTION v2_apply_refresh_prompted_post_send_bookkeeping_mutation(
  p_commitment_id UUID,
  p_clerk_user_id TEXT,
  p_message_sid TEXT,
  p_prompt_step TEXT,
  p_prompt_kind TEXT,
  p_body_preview TEXT,
  p_next_refresh_session JSONB,
  p_expected_session_id TEXT DEFAULT NULL,
  p_expected_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  result TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_row v2_commitment%ROWTYPE;
  v_prompt_step TEXT;
  v_prompt_kind TEXT;
  v_message_sid TEXT;
  v_event_idempotency_key TEXT;
  v_current_session_id TEXT;
BEGIN
  v_prompt_step := lower(trim(coalesce(p_prompt_step, '')));
  v_prompt_kind := lower(trim(coalesce(p_prompt_kind, '')));
  v_message_sid := trim(coalesce(p_message_sid, ''));

  IF v_prompt_step NOT IN ('identity', 'commitment') THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;
  IF v_prompt_kind NOT IN ('identity_first', 'identity_reminder', 'commitment_daily') THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;
  IF v_message_sid = '' THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;
  IF p_next_refresh_session IS NULL OR jsonb_typeof(p_next_refresh_session) <> 'object' THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ;
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
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF p_expected_updated_at IS NOT NULL
     AND v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at;
    RETURN;
  END IF;

  IF p_expected_session_id IS NOT NULL AND trim(p_expected_session_id) <> '' THEN
    IF v_row.refresh_session IS NULL OR jsonb_typeof(v_row.refresh_session) <> 'object' THEN
      RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at;
      RETURN;
    END IF;
    v_current_session_id := trim(coalesce(v_row.refresh_session->>'session_id', ''));
    IF v_current_session_id = '' OR v_current_session_id <> trim(p_expected_session_id) THEN
      RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at;
      RETURN;
    END IF;
  END IF;

  v_event_idempotency_key := format(
    'v2_coaching_refresh_prompted:%s:%s:%s:%s',
    p_commitment_id::TEXT,
    trim(coalesce(p_next_refresh_session->>'session_id', '')),
    v_prompt_step,
    v_message_sid
  );

  IF EXISTS (
    SELECT 1
    FROM v2_commitment_event
    WHERE idempotency_key = v_event_idempotency_key
  ) THEN
    RETURN QUERY SELECT 'already_applied'::TEXT, v_row.updated_at;
    RETURN;
  END IF;

  UPDATE v2_commitment
  SET refresh_session = p_next_refresh_session,
      commitment_refresh_last_prompted_at = CASE
        WHEN v_prompt_kind = 'commitment_daily' THEN p_now
        ELSE commitment_refresh_last_prompted_at
      END,
      updated_at = p_now
  WHERE id = p_commitment_id
  RETURNING v2_commitment.updated_at INTO v_row.updated_at;

  IF v_prompt_kind = 'identity_first' OR v_prompt_kind = 'identity_reminder' THEN
    UPDATE user_profiles
    SET identity_refresh_last_prompted_at = p_now
    WHERE clerk_user_id = p_clerk_user_id;
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
    'coaching_refresh_prompted',
    p_now,
    'sms_v2_accountability',
    jsonb_build_object(
      'session_id', trim(coalesce(p_next_refresh_session->>'session_id', '')),
      'step', v_prompt_step,
      'message_sid', v_message_sid,
      'body_preview', left(coalesce(p_body_preview, ''), 160)
    ),
    v_event_idempotency_key
  );

  RETURN QUERY SELECT 'applied'::TEXT, v_row.updated_at;
END;
$$;

COMMENT ON FUNCTION v2_apply_refresh_prompted_post_send_bookkeeping_mutation(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) IS 'Transactional wrapper for post-send refresh bookkeeping: validates state, writes refresh_session progression, updates prompted timestamp fields, and inserts coaching_refresh_prompted atomically.';
