-- Season lifecycle by SMS — bundled goal-change + season alignment (pre-push foundation).
-- Does NOT modify sob_complete_onboarding_activation or v2_apply_guided_commitment_replace_mutation.

-- ---------------------------------------------------------------------------
-- v2_close_active_accountability_season
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION v2_close_active_accountability_season(
  p_clerk_user_id TEXT,
  p_idempotency_key TEXT,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  result TEXT,
  season_id UUID,
  idempotent_replay BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_now TIMESTAMPTZ := coalesce(p_now, now());
  v_idem TEXT;
  v_season user_accountability_season%ROWTYPE;
BEGIN
  IF trim(coalesce(p_clerk_user_id, '')) = '' THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::UUID, false;
    RETURN;
  END IF;

  v_idem := 'season_close:' || trim(coalesce(p_idempotency_key, ''));

  IF trim(coalesce(p_idempotency_key, '')) = '' THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::UUID, false;
    RETURN;
  END IF;

  SELECT s.*
  INTO v_season
  FROM user_accountability_season s
  WHERE s.clerk_user_id = p_clerk_user_id
    AND s.status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'no_active_season'::TEXT, NULL::UUID, false;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM v2_commitment_event e WHERE e.idempotency_key = v_idem) THEN
    RETURN QUERY SELECT 'already_applied'::TEXT, v_season.id, true;
    RETURN;
  END IF;

  UPDATE user_accountability_season
  SET status = 'completed',
      ended_at = v_now
  WHERE id = v_season.id;

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
    v_season.commitment_id,
    p_clerk_user_id,
    'sms_memory_signal',
    v_now,
    'server',
    jsonb_build_object(
      'season_lifecycle', true,
      'exclude_from_proof_curation', true,
      'season_transition_action', 'season_closed',
      'season_id', v_season.id,
      'memory_signal', jsonb_build_object('season_lifecycle', true)
    ),
    v_idem
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

  RETURN QUERY SELECT 'applied'::TEXT, v_season.id, false;
END;
$$;

-- ---------------------------------------------------------------------------
-- v2_rename_accountability_season
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION v2_rename_accountability_season(
  p_clerk_user_id TEXT,
  p_season_name TEXT,
  p_idempotency_key TEXT,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  result TEXT,
  season_id UUID,
  season_name TEXT,
  idempotent_replay BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_now TIMESTAMPTZ := coalesce(p_now, now());
  v_name TEXT;
  v_idem TEXT;
  v_season user_accountability_season%ROWTYPE;
BEGIN
  v_name := trim(coalesce(p_season_name, ''));
  IF trim(coalesce(p_clerk_user_id, '')) = '' OR v_name = '' THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::UUID, NULL::TEXT, false;
    RETURN;
  END IF;

  IF char_length(v_name) > 80 THEN
    RETURN QUERY SELECT 'name_too_long'::TEXT, NULL::UUID, NULL::TEXT, false;
    RETURN;
  END IF;

  v_idem := 'season_rename:' || trim(coalesce(p_idempotency_key, ''));
  IF trim(coalesce(p_idempotency_key, '')) = '' THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::UUID, NULL::TEXT, false;
    RETURN;
  END IF;

  SELECT s.*
  INTO v_season
  FROM user_accountability_season s
  WHERE s.clerk_user_id = p_clerk_user_id
    AND s.status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'no_active_season'::TEXT, NULL::UUID, NULL::TEXT, false;
    RETURN;
  END IF;

  IF v_season.season_name = v_name THEN
    IF EXISTS (SELECT 1 FROM v2_commitment_event e WHERE e.idempotency_key = v_idem) THEN
      RETURN QUERY SELECT 'already_applied'::TEXT, v_season.id, v_name, true;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'already_applied'::TEXT, v_season.id, v_name, true;
    RETURN;
  END IF;

  UPDATE user_accountability_season
  SET season_name = v_name
  WHERE id = v_season.id;

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
    v_season.commitment_id,
    p_clerk_user_id,
    'sms_memory_signal',
    v_now,
    'server',
    jsonb_build_object(
      'season_lifecycle', true,
      'exclude_from_proof_curation', true,
      'season_transition_action', 'season_renamed',
      'season_id', v_season.id,
      'new_season_name', v_name,
      'memory_signal', jsonb_build_object('season_lifecycle', true)
    ),
    v_idem
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

  RETURN QUERY SELECT 'applied'::TEXT, v_season.id, v_name, false;
END;
$$;

-- ---------------------------------------------------------------------------
-- v2_start_accountability_season_for_commitment (recovery-only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION v2_start_accountability_season_for_commitment(
  p_clerk_user_id TEXT,
  p_commitment_id UUID,
  p_idempotency_key TEXT,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  result TEXT,
  season_id UUID,
  idempotent_replay BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_now TIMESTAMPTZ := coalesce(p_now, now());
  v_idem TEXT;
  v_commitment v2_commitment%ROWTYPE;
  v_profile user_profiles%ROWTYPE;
  v_identity user_identity_version%ROWTYPE;
  v_active_season user_accountability_season%ROWTYPE;
  v_existing_season user_accountability_season%ROWTYPE;
  v_season_id UUID;
  v_season_count INTEGER;
  v_season_name TEXT;
  v_identity_snapshot JSONB;
  v_goal_snapshot JSONB;
BEGIN
  IF trim(coalesce(p_clerk_user_id, '')) = '' OR p_commitment_id IS NULL THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::UUID, false;
    RETURN;
  END IF;

  v_idem := 'season_start:' || trim(coalesce(p_idempotency_key, ''));
  IF trim(coalesce(p_idempotency_key, '')) = '' THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::UUID, false;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM v2_commitment_event e WHERE e.idempotency_key = v_idem) THEN
    SELECT s.id INTO v_season_id
    FROM user_accountability_season s
    WHERE s.commitment_id = p_commitment_id;
    RETURN QUERY SELECT 'already_applied'::TEXT, v_season_id, true;
    RETURN;
  END IF;

  SELECT *
  INTO v_active_season
  FROM user_accountability_season s
  WHERE s.clerk_user_id = p_clerk_user_id
    AND s.status = 'active';

  IF FOUND THEN
    RETURN QUERY SELECT 'active_season_exists'::TEXT, NULL::UUID, false;
    RETURN;
  END IF;

  SELECT *
  INTO v_existing_season
  FROM user_accountability_season s
  WHERE s.commitment_id = p_commitment_id;

  IF FOUND THEN
    RETURN QUERY SELECT 'commitment_already_has_season'::TEXT, v_existing_season.id, false;
    RETURN;
  END IF;

  SELECT *
  INTO v_commitment
  FROM v2_commitment c
  WHERE c.id = p_commitment_id
    AND c.clerk_user_id = p_clerk_user_id
    AND c.status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'commitment_not_active'::TEXT, NULL::UUID, false;
    RETURN;
  END IF;

  SELECT *
  INTO v_profile
  FROM user_profiles
  WHERE clerk_user_id = p_clerk_user_id;

  IF NOT FOUND OR v_profile.active_identity_version_id IS NULL THEN
    RETURN QUERY SELECT 'missing_identity'::TEXT, NULL::UUID, false;
    RETURN;
  END IF;

  SELECT *
  INTO v_identity
  FROM user_identity_version
  WHERE id = v_profile.active_identity_version_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'missing_identity'::TEXT, NULL::UUID, false;
    RETURN;
  END IF;

  SELECT count(*)::INTEGER
  INTO v_season_count
  FROM user_accountability_season
  WHERE clerk_user_id = p_clerk_user_id;

  v_season_name := 'Season ' || (GREATEST(v_season_count, 0) + 1)::TEXT;

  v_identity_snapshot := jsonb_build_object(
    'preferred_name', v_profile.preferred_name,
    'identity_anchor_text', v_identity.identity_anchor_text,
    'identity_version_id', v_identity.id,
    'captured_at', v_now
  );

  v_goal_snapshot := jsonb_build_object(
    'title', v_commitment.title,
    'behavior_statement', v_commitment.behavior_statement,
    'commitment_id', v_commitment.id,
    'captured_at', v_now
  );

  INSERT INTO user_accountability_season (
    clerk_user_id,
    commitment_id,
    identity_version_id,
    season_name,
    identity_snapshot,
    goal_snapshot,
    started_at,
    status
  )
  VALUES (
    p_clerk_user_id,
    p_commitment_id,
    v_identity.id,
    v_season_name,
    v_identity_snapshot,
    v_goal_snapshot,
    v_now,
    'active'
  )
  RETURNING id INTO v_season_id;

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
    'sms_memory_signal',
    v_now,
    'server',
    jsonb_build_object(
      'season_lifecycle', true,
      'exclude_from_proof_curation', true,
      'season_transition_action', 'season_started',
      'season_id', v_season_id,
      'memory_signal', jsonb_build_object('season_lifecycle', true)
    ),
    v_idem
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

  RETURN QUERY SELECT 'applied'::TEXT, v_season_id, false;
END;
$$;

-- ---------------------------------------------------------------------------
-- v2_apply_sms_goal_change_with_season_mutation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION v2_apply_sms_goal_change_with_season_mutation(
  p_old_commitment_id UUID,
  p_clerk_user_id TEXT,
  p_new_behavior_statement TEXT,
  p_season_mode TEXT,
  p_expected_old_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  result TEXT,
  commitment_replace_applied BOOLEAN,
  old_commitment_id UUID,
  new_commitment_id UUID,
  season_transition_applied BOOLEAN,
  season_transition_action TEXT,
  old_season_id UUID,
  new_season_id UUID,
  old_season_name TEXT,
  new_season_name TEXT,
  same_season_goal_snapshot_synced BOOLEAN,
  idempotent_replay BOOLEAN,
  warning_code TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_now TIMESTAMPTZ := coalesce(p_now, now());
  v_new_behavior TEXT;
  v_old v2_commitment%ROWTYPE;
  v_active_season user_accountability_season%ROWTYPE;
  v_profile user_profiles%ROWTYPE;
  v_identity user_identity_version%ROWTYPE;
  v_idem TEXT;
  v_replace_result TEXT;
  v_replace_old UUID;
  v_replace_new UUID;
  v_season_count INTEGER;
  v_season_name TEXT;
  v_identity_snapshot JSONB;
  v_goal_snapshot JSONB;
  v_new_season_id UUID;
  v_old_season_id UUID;
  v_old_season_name TEXT;
BEGIN
  v_new_behavior := trim(coalesce(p_new_behavior_statement, ''));
  v_idem := 'sms_goal_season_bundle:' || trim(coalesce(p_idempotency_key, ''));

  IF v_new_behavior = '' OR trim(coalesce(p_clerk_user_id, '')) = '' OR p_old_commitment_id IS NULL THEN
    RETURN QUERY SELECT
      'error'::TEXT, false, p_old_commitment_id, NULL::UUID,
      false, NULL::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::TEXT,
      false, false, 'invalid_args'::TEXT;
    RETURN;
  END IF;

  IF p_season_mode NOT IN ('same_season_sync', 'new_chapter') THEN
    RETURN QUERY SELECT
      'error'::TEXT, false, p_old_commitment_id, NULL::UUID,
      false, NULL::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::TEXT,
      false, false, 'invalid_season_mode'::TEXT;
    RETURN;
  END IF;

  IF trim(coalesce(p_idempotency_key, '')) = '' THEN
    RETURN QUERY SELECT
      'error'::TEXT, false, p_old_commitment_id, NULL::UUID,
      false, NULL::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::TEXT,
      false, false, 'missing_idempotency_key'::TEXT;
    RETURN;
  END IF;

  -- Idempotent replay via audit spine row
  IF EXISTS (SELECT 1 FROM v2_commitment_event e WHERE e.idempotency_key = v_idem) THEN
    SELECT c.id INTO v_replace_new
    FROM v2_commitment c
    WHERE c.clerk_user_id = p_clerk_user_id AND c.status = 'active'
    ORDER BY c.created_at DESC
    LIMIT 1;

    SELECT s.id, s.season_name
    INTO v_new_season_id, v_season_name
    FROM user_accountability_season s
    WHERE s.clerk_user_id = p_clerk_user_id AND s.status = 'active'
    LIMIT 1;

    RETURN QUERY SELECT
      'already_applied'::TEXT,
      (p_season_mode = 'new_chapter'),
      p_old_commitment_id,
      coalesce(v_replace_new, p_old_commitment_id),
      true,
      p_season_mode,
      NULL::UUID,
      v_new_season_id,
      NULL::TEXT,
      v_season_name,
      (p_season_mode = 'same_season_sync'),
      true,
      NULL::TEXT;
    RETURN;
  END IF;

  SELECT *
  INTO v_old
  FROM v2_commitment c
  WHERE c.id = p_old_commitment_id
    AND c.clerk_user_id = p_clerk_user_id
    AND c.status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      'error'::TEXT, false, p_old_commitment_id, NULL::UUID,
      false, NULL::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::TEXT,
      false, false, 'commitment_not_active'::TEXT;
    RETURN;
  END IF;

  IF p_expected_old_updated_at IS NOT NULL AND v_old.updated_at IS DISTINCT FROM p_expected_old_updated_at THEN
    RETURN QUERY SELECT
      'stale_commitment'::TEXT, false, p_old_commitment_id, NULL::UUID,
      false, NULL::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::TEXT,
      false, false, NULL::TEXT;
    RETURN;
  END IF;

  IF v_old.pending_resolution_kind IS DISTINCT FROM 'commitment_replace' THEN
    RETURN QUERY SELECT
      'invalid_pending_kind'::TEXT, false, p_old_commitment_id, NULL::UUID,
      false, NULL::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::TEXT,
      false, false, NULL::TEXT;
    RETURN;
  END IF;

  IF p_season_mode = 'same_season_sync' THEN
    -- State-based idempotency: pending cleared + bar already matches
    IF v_old.pending_resolution_kind IS NULL
       AND trim(coalesce(v_old.behavior_statement, '')) = v_new_behavior THEN
      RETURN QUERY SELECT
        'already_applied'::TEXT, false, v_old.id, v_old.id,
        true, 'same_season_sync', NULL::UUID, NULL::UUID, NULL::TEXT, NULL::TEXT,
        true, true, NULL::TEXT;
      RETURN;
    END IF;

    SELECT s.*
    INTO v_active_season
    FROM user_accountability_season s
    WHERE s.clerk_user_id = p_clerk_user_id
      AND s.status = 'active'
      AND s.commitment_id = v_old.id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN QUERY SELECT
        'no_active_season_for_commitment'::TEXT, false, v_old.id, v_old.id,
        false, NULL::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::TEXT,
        false, false, 'season_drift'::TEXT;
      RETURN;
    END IF;

    UPDATE v2_commitment
    SET behavior_statement = v_new_behavior,
        pending_resolution_kind = NULL,
        pending_resolution_payload = NULL,
        pending_resolution_created_at = NULL,
        pending_resolution_expires_at = NULL,
        updated_at = v_now
    WHERE id = v_old.id;

    v_goal_snapshot := jsonb_build_object(
      'title', v_old.title,
      'behavior_statement', v_new_behavior,
      'commitment_id', v_old.id,
      'captured_at', v_now
    );

    UPDATE user_accountability_season
    SET goal_snapshot = v_goal_snapshot
    WHERE id = v_active_season.id;

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
      v_old.id,
      p_clerk_user_id,
      'sms_memory_signal',
      v_now,
      'server',
      jsonb_build_object(
        'season_lifecycle', true,
        'exclude_from_proof_curation', true,
        'season_transition_action', 'same_season_goal_sync',
        'season_mode', 'same_season_sync',
        'old_season_id', v_active_season.id,
        'memory_signal', jsonb_build_object('season_lifecycle', true)
      ),
      v_idem
    )
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

    RETURN QUERY SELECT
      'applied'::TEXT, false, v_old.id, v_old.id,
      true, 'same_season_sync', v_active_season.id, v_active_season.id,
      v_active_season.season_name, v_active_season.season_name,
      true, false, NULL::TEXT;
    RETURN;
  END IF;

  -- new_chapter
  SELECT s.*
  INTO v_active_season
  FROM user_accountability_season s
  WHERE s.clerk_user_id = p_clerk_user_id
    AND s.status = 'active'
  FOR UPDATE;

  IF FOUND THEN
    v_old_season_id := v_active_season.id;
    v_old_season_name := v_active_season.season_name;
    UPDATE user_accountability_season
    SET status = 'completed',
        ended_at = v_now
    WHERE id = v_active_season.id;
  END IF;

  SELECT r.result, r.old_commitment_id, r.new_commitment_id
  INTO v_replace_result, v_replace_old, v_replace_new
  FROM v2_apply_guided_commitment_replace_mutation(
    p_old_commitment_id,
    p_clerk_user_id,
    v_new_behavior,
    p_expected_old_updated_at,
    v_now
  ) AS r
  LIMIT 1;

  IF v_replace_result IS NULL OR v_replace_result NOT IN ('applied', 'already_applied') THEN
    RAISE EXCEPTION 'replace_mutation_failed:%', coalesce(v_replace_result, 'null');
  END IF;

  IF v_replace_new IS NULL THEN
    RETURN QUERY SELECT
      'error'::TEXT, false, v_replace_old, NULL::UUID,
      false, NULL::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::TEXT,
      false, false, 'missing_new_commitment'::TEXT;
    RETURN;
  END IF;

  SELECT *
  INTO v_profile
  FROM user_profiles
  WHERE clerk_user_id = p_clerk_user_id;

  IF NOT FOUND OR v_profile.active_identity_version_id IS NULL THEN
    RAISE EXCEPTION 'missing_identity';
  END IF;

  SELECT *
  INTO v_identity
  FROM user_identity_version
  WHERE id = v_profile.active_identity_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'missing_identity';
  END IF;

  SELECT count(*)::INTEGER
  INTO v_season_count
  FROM user_accountability_season
  WHERE clerk_user_id = p_clerk_user_id;

  v_season_name := 'Season ' || (GREATEST(v_season_count, 0) + 1)::TEXT;

  v_identity_snapshot := jsonb_build_object(
    'preferred_name', v_profile.preferred_name,
    'identity_anchor_text', v_identity.identity_anchor_text,
    'identity_version_id', v_identity.id,
    'captured_at', v_now
  );

  SELECT jsonb_build_object(
    'title', c.title,
    'behavior_statement', c.behavior_statement,
    'commitment_id', c.id,
    'captured_at', v_now
  )
  INTO v_goal_snapshot
  FROM v2_commitment c
  WHERE c.id = v_replace_new;

  INSERT INTO user_accountability_season (
    clerk_user_id,
    commitment_id,
    identity_version_id,
    season_name,
    identity_snapshot,
    goal_snapshot,
    started_at,
    status
  )
  VALUES (
    p_clerk_user_id,
    v_replace_new,
    v_identity.id,
    v_season_name,
    v_identity_snapshot,
    v_goal_snapshot,
    v_now,
    'active'
  )
  ON CONFLICT (commitment_id) DO NOTHING
  RETURNING id INTO v_new_season_id;

  IF v_new_season_id IS NULL THEN
    SELECT s.id INTO v_new_season_id
    FROM user_accountability_season s
    WHERE s.commitment_id = v_replace_new;
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
    v_replace_new,
    p_clerk_user_id,
    'sms_memory_signal',
    v_now,
    'server',
    jsonb_build_object(
      'season_lifecycle', true,
      'exclude_from_proof_curation', true,
      'season_transition_action', 'new_chapter',
      'season_mode', 'new_chapter',
      'old_season_id', v_old_season_id,
      'new_season_id', v_new_season_id,
      'old_season_name', v_old_season_name,
      'new_season_name', v_season_name,
      'memory_signal', jsonb_build_object('season_lifecycle', true)
    ),
    v_idem
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

  RETURN QUERY SELECT
    CASE WHEN v_replace_result = 'already_applied' THEN 'already_applied' ELSE 'applied' END::TEXT,
    true,
    v_replace_old,
    v_replace_new,
    true,
    'new_chapter',
    v_old_season_id,
    v_new_season_id,
    v_old_season_name,
    v_season_name,
    false,
  (v_replace_result = 'already_applied'),
    NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION v2_close_active_accountability_season(TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2_rename_accountability_season(TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2_start_accountability_season_for_commitment(TEXT, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2_apply_sms_goal_change_with_season_mutation(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TIMESTAMPTZ) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION v2_close_active_accountability_season(TEXT, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION v2_rename_accountability_season(TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION v2_start_accountability_season_for_commitment(TEXT, UUID, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION v2_apply_sms_goal_change_with_season_mutation(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TIMESTAMPTZ) TO service_role;
