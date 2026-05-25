-- SoB no-Why onboarding persistence (additive).
-- No life_desires. No My Why tables.

-- ---------------------------------------------------------------------------
-- user_identity_version
-- ---------------------------------------------------------------------------
CREATE TABLE user_identity_version (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  identity_anchor_text TEXT NOT NULL,
  intake_origin TEXT NOT NULL,
  ingredient_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  other_text TEXT NULL,
  use_mine_anyway BOOLEAN NOT NULL DEFAULT false,
  clarity_score SMALLINT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_identity_version_intake_origin_chk CHECK (
    intake_origin IN ('user_written', 'generated', 'template')
  ),
  CONSTRAINT user_identity_version_clarity_score_chk CHECK (
    clarity_score IS NULL OR (clarity_score >= 0 AND clarity_score <= 100)
  ),
  CONSTRAINT user_identity_version_clerk_version_uniq UNIQUE (clerk_user_id, version_number)
);

CREATE UNIQUE INDEX uq_user_identity_version_one_active
  ON user_identity_version (clerk_user_id)
  WHERE is_active = true;

CREATE INDEX idx_user_identity_version_clerk_created
  ON user_identity_version (clerk_user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- important_people
-- ---------------------------------------------------------------------------
CREATE TABLE important_people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'onboarding',
  is_private BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ NULL,
  CONSTRAINT important_people_relationship_type_chk CHECK (
    relationship_type IN (
      'spouse_partner',
      'child',
      'grandchild',
      'team_player_staff',
      'family_member',
      'other'
    )
  ),
  CONSTRAINT important_people_source_chk CHECK (
    source IN ('onboarding', 'edit', 'sms')
  ),
  CONSTRAINT important_people_display_name_nonempty CHECK (
    length(trim(display_name)) > 0
  )
);

CREATE INDEX idx_important_people_clerk_active
  ON important_people (clerk_user_id)
  WHERE is_active = true AND removed_at IS NULL;

CREATE INDEX idx_important_people_clerk_source
  ON important_people (clerk_user_id, source);

-- ---------------------------------------------------------------------------
-- v2_commitment_intake
-- ---------------------------------------------------------------------------
CREATE TABLE v2_commitment_intake (
  commitment_id UUID PRIMARY KEY REFERENCES v2_commitment (id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  selected_area_id TEXT NOT NULL,
  selected_template_id TEXT NULL,
  intake_origin TEXT NOT NULL,
  use_mine_anyway BOOLEAN NOT NULL DEFAULT false,
  checkability_score SMALLINT NULL,
  coherence_status TEXT NOT NULL DEFAULT 'unknown',
  sms_suitability TEXT NOT NULL DEFAULT 'acceptable',
  identity_version_id UUID NULL REFERENCES user_identity_version (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT v2_commitment_intake_origin_chk CHECK (
    intake_origin IN ('user_written', 'generated', 'template', 'recommended')
  ),
  CONSTRAINT v2_commitment_intake_coherence_status_chk CHECK (
    coherence_status IN ('high', 'medium', 'low', 'unknown')
  ),
  CONSTRAINT v2_commitment_intake_sms_suitability_chk CHECK (
    sms_suitability IN ('strong', 'acceptable', 'weak')
  ),
  CONSTRAINT v2_commitment_intake_checkability_score_chk CHECK (
    checkability_score IS NULL OR (checkability_score >= 0 AND checkability_score <= 100)
  )
);

CREATE INDEX idx_v2_commitment_intake_clerk ON v2_commitment_intake (clerk_user_id);
CREATE INDEX idx_v2_commitment_intake_area ON v2_commitment_intake (selected_area_id);

-- ---------------------------------------------------------------------------
-- goal_coherence_log
-- ---------------------------------------------------------------------------
CREATE TABLE goal_coherence_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  identity_version_id UUID NOT NULL REFERENCES user_identity_version (id) ON DELETE RESTRICT,
  commitment_id UUID NOT NULL REFERENCES v2_commitment (id) ON DELETE CASCADE,
  direct_connection_likely BOOLEAN NOT NULL,
  supporting_connection_likely BOOLEAN NOT NULL,
  confidence SMALLINT NOT NULL,
  bridge_question_asked TEXT NULL,
  user_response TEXT NULL,
  coach_pat_note_generated BOOLEAN NOT NULL DEFAULT false,
  coach_pat_note_text TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT goal_coherence_log_confidence_chk CHECK (
    confidence >= 0 AND confidence <= 100
  ),
  CONSTRAINT goal_coherence_log_commitment_uniq UNIQUE (commitment_id)
);

CREATE INDEX idx_goal_coherence_log_clerk ON goal_coherence_log (clerk_user_id);

-- ---------------------------------------------------------------------------
-- user_accountability_season
-- ---------------------------------------------------------------------------
CREATE TABLE user_accountability_season (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  commitment_id UUID NOT NULL REFERENCES v2_commitment (id) ON DELETE CASCADE,
  identity_version_id UUID NOT NULL REFERENCES user_identity_version (id) ON DELETE RESTRICT,
  season_name TEXT NOT NULL,
  identity_snapshot JSONB NOT NULL,
  goal_snapshot JSONB NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ NULL,
  CONSTRAINT user_accountability_season_status_chk CHECK (
    status IN ('active', 'completed', 'archived')
  ),
  CONSTRAINT user_accountability_season_commitment_id_uniq UNIQUE (commitment_id)
);

CREATE UNIQUE INDEX uq_user_accountability_season_one_active_per_user
  ON user_accountability_season (clerk_user_id)
  WHERE status = 'active';

CREATE INDEX idx_user_accountability_season_clerk_status
  ON user_accountability_season (clerk_user_id, status, started_at DESC);

-- ---------------------------------------------------------------------------
-- user_profiles extensions
-- ---------------------------------------------------------------------------
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS active_identity_version_id UUID NULL,
  ADD COLUMN IF NOT EXISTS identity_intake_completed_at TIMESTAMPTZ NULL;

ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_active_identity_version_fk;

ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_active_identity_version_fk
  FOREIGN KEY (active_identity_version_id)
  REFERENCES user_identity_version (id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_active_identity_version
  ON user_profiles (active_identity_version_id)
  WHERE active_identity_version_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS (no policies — server/service-role only in this build)
-- ---------------------------------------------------------------------------
ALTER TABLE user_identity_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE important_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2_commitment_intake ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_coherence_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_accountability_season ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- RPC: transactional onboarding activation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sob_complete_onboarding_activation(p_clerk_user_id TEXT)
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
  FROM user_profiles
  WHERE clerk_user_id = p_clerk_user_id
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
  FROM user_identity_version
  WHERE id = v_profile.active_identity_version_id
    AND clerk_user_id = p_clerk_user_id
    AND is_active = true;

  IF NOT FOUND OR length(trim(v_identity.identity_anchor_text)) = 0 THEN
    RETURN QUERY SELECT 'no_identity'::TEXT, NULL::UUID, NULL::UUID, false, false, 0;
    RETURN;
  END IF;

  SELECT c.id, c.status
  INTO v_commitment_id, v_commitment_status
  FROM v2_commitment c
  WHERE c.clerk_user_id = p_clerk_user_id
    AND c.status = 'proposed'
  ORDER BY c.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_commitment_id IS NULL THEN
    SELECT c.id, c.status
    INTO v_commitment_id, v_commitment_status
    FROM v2_commitment c
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
    UPDATE v2_commitment
    SET status = 'active',
        started_at = v_now,
        updated_at = v_now
    WHERE id = v_commitment_id
      AND clerk_user_id = p_clerk_user_id
      AND status = 'proposed';

    IF NOT FOUND THEN
      SELECT status INTO v_commitment_status
      FROM v2_commitment
      WHERE id = v_commitment_id;

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
  VALUES (
    v_commitment_id,
    p_clerk_user_id,
    'activated',
    'onboarding_v2',
    '{}'::jsonb,
    v_event_key
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_activated_event_inserted := (v_rows > 0);

  UPDATE user_accountability_season
  SET status = 'completed',
      ended_at = v_now
  WHERE clerk_user_id = p_clerk_user_id
    AND status = 'active'
    AND commitment_id IS DISTINCT FROM v_commitment_id;

  GET DIAGNOSTICS v_prior_archived = ROW_COUNT;

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
  VALUES (
    p_clerk_user_id,
    v_commitment_id,
    v_identity.id,
    v_season_name,
    v_identity_snapshot,
    v_goal_snapshot,
    v_now,
    'active'
  )
  ON CONFLICT (commitment_id) DO NOTHING;

  SELECT s.id
  INTO v_season_id
  FROM user_accountability_season s
  WHERE s.commitment_id = v_commitment_id;

  IF v_season_id IS NULL THEN
    RETURN QUERY SELECT 'error'::TEXT, v_commitment_id, NULL::UUID, v_commitment_was_activated, v_activated_event_inserted, v_prior_archived;
    RETURN;
  END IF;

  UPDATE user_profiles
  SET identity_intake_completed_at = COALESCE(identity_intake_completed_at, v_now)
  WHERE clerk_user_id = p_clerk_user_id;

  RETURN QUERY SELECT
    'ok'::TEXT,
    v_commitment_id,
    v_season_id,
    v_commitment_was_activated,
    v_activated_event_inserted,
    v_prior_archived;
END;
$$;

REVOKE ALL ON FUNCTION sob_complete_onboarding_activation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sob_complete_onboarding_activation(TEXT) TO service_role;
