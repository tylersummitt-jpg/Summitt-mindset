-- V2 guided resolution: DB-atomic commitment replacement wrapper.
-- Scope: commitment_replace only.

CREATE OR REPLACE FUNCTION v2_apply_guided_commitment_replace_mutation(
  p_old_commitment_id UUID,
  p_clerk_user_id TEXT,
  p_new_behavior_statement TEXT,
  p_expected_old_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  result TEXT,
  old_commitment_id UUID,
  new_commitment_id UUID
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_old v2_commitment%ROWTYPE;
  v_new_id UUID;
  v_now TIMESTAMPTZ;
  v_new_behavior TEXT;
  v_created_key TEXT;
  v_activated_key TEXT;
BEGIN
  v_now := coalesce(p_now, now());
  v_new_behavior := trim(coalesce(p_new_behavior_statement, ''));

  IF v_new_behavior = '' THEN
    RETURN QUERY SELECT 'error'::TEXT, p_old_commitment_id, NULL::UUID;
    RETURN;
  END IF;

  -- Idempotent retry winner: replacement already exists and is currently active.
  SELECT c.id
  INTO v_new_id
  FROM v2_commitment c
  WHERE c.clerk_user_id = p_clerk_user_id
    AND c.status = 'active'
    AND c.supersedes_commitment_id = p_old_commitment_id
  ORDER BY c.started_at DESC
  LIMIT 1;

  IF v_new_id IS NOT NULL THEN
    RETURN QUERY SELECT 'already_applied'::TEXT, p_old_commitment_id, v_new_id;
    RETURN;
  END IF;

  SELECT *
  INTO v_old
  FROM v2_commitment
  WHERE id = p_old_commitment_id
    AND clerk_user_id = p_clerk_user_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT, p_old_commitment_id, NULL::UUID;
    RETURN;
  END IF;

  IF p_expected_old_updated_at IS NOT NULL
     AND v_old.updated_at IS DISTINCT FROM p_expected_old_updated_at THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, p_old_commitment_id, NULL::UUID;
    RETURN;
  END IF;

  IF v_old.pending_resolution_kind IS DISTINCT FROM 'commitment_replace' THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, p_old_commitment_id, NULL::UUID;
    RETURN;
  END IF;

  -- 1) Supersede old active chapter and clear pending state atomically.
  UPDATE v2_commitment
  SET status = 'superseded',
      ended_at = v_now,
      pending_resolution_kind = NULL,
      pending_resolution_created_at = NULL,
      pending_resolution_expires_at = NULL,
      pending_resolution_payload = NULL,
      updated_at = v_now
  WHERE id = v_old.id;

  -- 2) Insert new active chapter with explicit lineage fields.
  INSERT INTO v2_commitment (
    clerk_user_id,
    status,
    title,
    commitment_type,
    behavior_statement,
    success_criteria,
    cadence_kind,
    tone_preference,
    reachability_window,
    source,
    started_at,
    updated_at,
    supersedes_commitment_id,
    evolution_kind,
    evolution_reason_code,
    pending_resolution_kind,
    pending_resolution_created_at,
    pending_resolution_expires_at,
    pending_resolution_payload
  )
  VALUES (
    v_old.clerk_user_id,
    'active',
    v_old.title,
    v_old.commitment_type,
    v_new_behavior,
    v_old.success_criteria,
    coalesce(v_old.cadence_kind, 'daily'),
    v_old.tone_preference,
    coalesce(v_old.reachability_window, '{}'::jsonb),
    'guided_resolution_v2',
    v_now,
    v_now,
    v_old.id,
    'replace',
    'guided_resolution_new',
    NULL,
    NULL,
    NULL,
    NULL
  )
  RETURNING id INTO v_new_id;

  -- 3) Canonical chapter transition events (new row).
  v_created_key := format('guided_resolution_replace_created:%s', v_new_id::TEXT);
  v_activated_key := format('guided_resolution_replace_activated:%s', v_new_id::TEXT);

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
    v_new_id,
    v_old.clerk_user_id,
    'created',
    v_now,
    'guided_resolution_v2',
    jsonb_build_object(
      'supersedes_commitment_id', v_old.id,
      'evolution_kind', 'replace',
      'evolution_reason_code', 'guided_resolution_new'
    ),
    v_created_key
  );

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
    v_new_id,
    v_old.clerk_user_id,
    'activated',
    v_now,
    'guided_resolution_v2',
    jsonb_build_object(
      'supersedes_commitment_id', v_old.id,
      'evolution_kind', 'replace',
      'evolution_reason_code', 'guided_resolution_new'
    ),
    v_activated_key
  );

  RETURN QUERY SELECT 'applied'::TEXT, v_old.id, v_new_id;
END;
$$;

COMMENT ON FUNCTION v2_apply_guided_commitment_replace_mutation(
  UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) IS 'Transactional wrapper for guided commitment replacement: validates active+pending replacement state, supersedes old chapter, inserts new active chapter with lineage, and writes created/activated events atomically.';
