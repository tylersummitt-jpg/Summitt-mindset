-- Fix PL/pgSQL ambiguity: RETURNS TABLE output columns (commitment_id, season_id, etc.)
-- shadow unqualified SQL identifiers. Production error 42702 on season archive UPDATE.
-- Behavior unchanged; qualifies table columns and sets variable_conflict = use_column.

CREATE OR REPLACE FUNCTION public.sob_complete_onboarding_activation(p_clerk_user_id TEXT)
RETURNS TABLE (
  result TEXT,
  commitment_id UUID,
  season_id UUID,
  commitment_was_activated BOOLEAN,
  activated_event_inserted BOOLEAN,
  prior_seasons_archived INTEGER
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
  v_now TIMESTAMPTZ := now();
  v_profile user_profiles%ROWTYPE;
  v_identity user_identity_version%ROWTYPE;
  v_commitment_id UUID;
  v_commitment_status TEXT;
  v_commitment_was_activated BOOLEAN := false;
  v_activated_event_inserted BOOLEAN := false;
  v_prior_archived INTEGER := 0;
  v_season_id UUID;
  v_season_count INTEGER;
  v_season_name TEXT;
  v_identity_snapshot JSONB;
  v_goal_snapshot JSONB;
  v_event_key TEXT;
  v_rows INTEGER;
BEGIN
  IF p_clerk_user_id IS NULL OR length(trim(p_clerk_user_id)) = 0 THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::UUID, NULL::UUID, false, false, 0;
    RETURN;
  END IF;

  SELECT *
  INTO v_profile
  FROM user_profiles AS up
  WHERE up.clerk_user_id = p_clerk_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'no_identity'::TEXT, NULL::UUID, NULL::UUID, false, false, 0;
    RETURN;
  END IF;

  IF v_profile.active_identity_version_id IS NULL THEN
    RETURN QUERY SELECT 'no_identity'::TEXT, NULL::UUID, NULL::UUID, false, false, 0;
    RETURN;
  END IF;

  SELECT *
  INTO v_identity
  FROM user_identity_version AS uiv
  WHERE uiv.id = v_profile.active_identity_version_id
    AND uiv.clerk_user_id = p_clerk_user_id
    AND uiv.is_active = true;

  IF NOT FOUND OR length(trim(v_identity.identity_anchor_text)) = 0 THEN
    RETURN QUERY SELECT 'no_identity'::TEXT, NULL::UUID, NULL::UUID, false, false, 0;
    RETURN;
  END IF;

  SELECT c.id, c.status
  INTO v_commitment_id, v_commitment_status
  FROM v2_commitment AS c
  WHERE c.clerk_user_id = p_clerk_user_id
    AND c.status = 'proposed'
  ORDER BY c.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_commitment_id IS NULL THEN
    SELECT c.id, c.status
    INTO v_commitment_id, v_commitment_status
    FROM v2_commitment AS c
    WHERE c.clerk_user_id = p_clerk_user_id
      AND c.status = 'active'
    ORDER BY c.created_at DESC
    LIMIT 1;
  END IF;

  IF v_commitment_id IS NULL THEN
    RETURN QUERY SELECT 'no_commitment'::TEXT, NULL::UUID, NULL::UUID, false, false, 0;
    RETURN;
  END IF;

  IF v_commitment_status = 'proposed' THEN
    UPDATE v2_commitment AS c
    SET status = 'active',
        started_at = v_now,
        updated_at = v_now
    WHERE c.id = v_commitment_id
      AND c.clerk_user_id = p_clerk_user_id
      AND c.status = 'proposed';

    IF NOT FOUND THEN
      SELECT c.status
      INTO v_commitment_status
      FROM v2_commitment AS c
      WHERE c.id = v_commitment_id;

      IF v_commitment_status IS DISTINCT FROM 'active' THEN
        RETURN QUERY SELECT 'conflict'::TEXT, v_commitment_id, NULL::UUID, false, false, 0;
        RETURN;
      END IF;
    ELSE
      v_commitment_was_activated := true;
      v_commitment_status := 'active';
    END IF;
  ELSIF v_commitment_status <> 'active' THEN
    RETURN QUERY SELECT 'conflict'::TEXT, v_commitment_id, NULL::UUID, false, false, 0;
    RETURN;
  END IF;

  v_event_key := 'onboarding_activated:' || v_commitment_id::TEXT;

  INSERT INTO v2_commitment_event (
    commitment_id,
    clerk_user_id,
    event_type,
    source,
    payload_json,
    idempotency_key
  )
  SELECT
    v_commitment_id,
    p_clerk_user_id,
    'activated',
    'onboarding_v2',
    '{}'::jsonb,
    v_event_key
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_activated_event_inserted := (v_rows > 0);

  UPDATE user_accountability_season AS uas
  SET status = 'completed',
      ended_at = v_now
  WHERE uas.clerk_user_id = p_clerk_user_id
    AND uas.status = 'active'
    AND uas.commitment_id IS DISTINCT FROM v_commitment_id;

  GET DIAGNOSTICS v_prior_archived = ROW_COUNT;

  SELECT count(*)::INTEGER
  INTO v_season_count
  FROM user_accountability_season AS uas
  WHERE uas.clerk_user_id = p_clerk_user_id;

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
  FROM v2_commitment AS c
  WHERE c.id = v_commitment_id;

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
  SELECT
    p_clerk_user_id,
    v_commitment_id,
    v_identity.id,
    v_season_name,
    v_identity_snapshot,
    v_goal_snapshot,
    v_now,
    'active'
  ON CONFLICT ON CONSTRAINT user_accountability_season_commitment_id_uniq DO NOTHING;

  SELECT uas.id
  INTO v_season_id
  FROM user_accountability_season AS uas
  WHERE uas.commitment_id = v_commitment_id;

  IF v_season_id IS NULL THEN
    RETURN QUERY SELECT 'error'::TEXT, v_commitment_id, NULL::UUID, v_commitment_was_activated, v_activated_event_inserted, v_prior_archived;
    RETURN;
  END IF;

  UPDATE user_profiles AS up
  SET identity_intake_completed_at = COALESCE(up.identity_intake_completed_at, v_now)
  WHERE up.clerk_user_id = p_clerk_user_id;

  RETURN QUERY SELECT
    'ok'::TEXT,
    v_commitment_id,
    v_season_id,
    v_commitment_was_activated,
    v_activated_event_inserted,
    v_prior_archived;
END;
$$;

REVOKE ALL ON FUNCTION public.sob_complete_onboarding_activation(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sob_complete_onboarding_activation(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.sob_complete_onboarding_activation(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sob_complete_onboarding_activation(TEXT) TO service_role;
