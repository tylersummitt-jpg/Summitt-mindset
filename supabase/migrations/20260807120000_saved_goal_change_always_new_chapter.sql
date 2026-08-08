-- Product law: saved Current Goal change always starts a new season.
-- Preserves v2_apply_sms_goal_change_with_season_mutation signature/return shape.
-- p_season_mode='same_season_sync' is accepted for compatibility but auto-upgraded to new_chapter.
-- Does NOT modify guided replace or onboarding activation RPCs.
-- Invoker security posture unchanged (no elevated security attributes added).

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
  v_effective_mode TEXT;
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

  -- Compatibility: accept legacy same_season_sync, but always execute new_chapter.
  IF p_season_mode NOT IN ('same_season_sync', 'new_chapter') THEN
    RETURN QUERY SELECT
      'error'::TEXT, false, p_old_commitment_id, NULL::UUID,
      false, NULL::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::TEXT,
      false, false, 'invalid_season_mode'::TEXT;
    RETURN;
  END IF;

  v_effective_mode := 'new_chapter';

  IF trim(coalesce(p_idempotency_key, '')) = '' THEN
    RETURN QUERY SELECT
      'error'::TEXT, false, p_old_commitment_id, NULL::UUID,
      false, NULL::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::TEXT,
      false, false, 'missing_idempotency_key'::TEXT;
    RETURN;
  END IF;

  -- Idempotent replay via audit spine row (always report actual new_chapter truth)
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
      true,
      p_old_commitment_id,
      coalesce(v_replace_new, p_old_commitment_id),
      true,
      v_effective_mode,
      NULL::UUID,
      v_new_season_id,
      NULL::TEXT,
      v_season_name,
      false,
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

  -- new_chapter (sole mutation path for saved Current Goal replacement)
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
      'requested_season_mode', p_season_mode,
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
    v_effective_mode,
    v_old_season_id,
    v_new_season_id,
    v_old_season_name,
    v_season_name,
    false,
    (v_replace_result = 'already_applied'),
    NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION v2_apply_sms_goal_change_with_season_mutation(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v2_apply_sms_goal_change_with_season_mutation(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TIMESTAMPTZ) TO service_role;
