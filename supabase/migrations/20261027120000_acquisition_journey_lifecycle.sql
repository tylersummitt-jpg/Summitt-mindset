-- Journey-local lifecycle and close status.
-- Does not send email. Does not rewrite acquisition_actions.
-- Does not run on git push. Apply only after the live checks below succeed.
--
-- Required live verification before applying:
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'public.acquisition_actions'::regclass
--   ORDER BY conname;
--
--   SELECT indexname, indexdef
--   FROM pg_indexes
--   WHERE schemaname = 'public'
--     AND tablename IN ('acquisition_actions', 'acquisition_journeys')
--   ORDER BY tablename, indexname;
--
--   SELECT grantee, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE table_schema = 'public'
--     AND table_name = 'acquisition_journeys'
--     AND grantee = 'service_role';
--
--   SELECT pg_get_functiondef(
--     'public.acquisition_persist_instantly_person_event_result(uuid,text,text,timestamptz,text,text,jsonb)'::regprocedure
--   );
--
--   SELECT person_id, campaign_id, count(*)
--   FROM public.acquisition_journeys
--   GROUP BY 1, 2
--   HAVING count(*) > 1;
--
--   SELECT person_id, count(*)
--   FROM public.acquisition_journeys
--   GROUP BY 1
--   HAVING count(*) > 1;
--
--   SELECT id, status, journey_id IS NULL AS legacy, action_type
--   FROM public.acquisition_actions
--   WHERE status IN ('scheduled', 'claimed', 'accepted')
--   ORDER BY status, created_at;

DO $checks$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.acquisition_actions'::regclass
      AND conname = 'acquisition_actions_person_id_action_type_key'
  ) THEN
    RAISE EXCEPTION 'acquisition_actions_person_id_action_type_key still present';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'acquisition_actions_legacy_person_type_uq'
      AND indexdef ILIKE '%UNIQUE%'
      AND indexdef ILIKE '%(person_id, action_type)%'
      AND indexdef ILIKE '%journey_id IS NULL%'
  ) THEN
    RAISE EXCEPTION 'acquisition_actions_legacy_person_type_uq missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'acquisition_actions_journey_type_uq'
      AND indexdef ILIKE '%UNIQUE%'
      AND indexdef ILIKE '%(journey_id, action_type)%'
      AND indexdef ILIKE '%journey_id IS NOT NULL%'
  ) THEN
    RAISE EXCEPTION 'acquisition_actions_journey_type_uq missing';
  END IF;
END
$checks$;

DO $columns$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'acquisition_journeys'
      AND column_name = 'lifecycle_state'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM public.acquisition_journeys
      GROUP BY person_id
      HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION 'acquisition_journey_backfill_ambiguous';
    END IF;

    ALTER TABLE public.acquisition_journeys
      ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'cold_active';

    ALTER TABLE public.acquisition_journeys
      ADD CONSTRAINT acquisition_journeys_lifecycle_chk CHECK (
        lifecycle_state IN (
          'cold_active',
          'cold_no_response',
          'reply_needs_review',
          'asset_requested',
          'asset_sent',
          'warm_video_sent',
          'trial_invited',
          'trial_started',
          'paid_member',
          'not_interested',
          'unsubscribed',
          'suppressed',
          'trial_expired'
        )
      );

    -- One journey per person makes the shared person lifecycle that journey's state.
    -- closed_at stays null. asset_sent, suppressed, and cold states are not a proven close.
    UPDATE public.acquisition_journeys AS journey
    SET lifecycle_state = person.lifecycle_state
    FROM public.acquisition_people AS person
    WHERE journey.person_id = person.id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'acquisition_journeys'
      AND column_name = 'closed_at'
  ) THEN
    ALTER TABLE public.acquisition_journeys
      ADD COLUMN closed_at TIMESTAMPTZ NULL;
  END IF;
END
$columns$;

DO $open$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.acquisition_journeys
    WHERE closed_at IS NULL
      AND campaign_id IS NOT NULL
    GROUP BY person_id, campaign_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'acquisition_open_journey_conflict';
  END IF;
END
$open$;

CREATE UNIQUE INDEX IF NOT EXISTS acquisition_journeys_open_person_campaign_uq
  ON public.acquisition_journeys (person_id, campaign_id)
  WHERE closed_at IS NULL AND campaign_id IS NOT NULL;

GRANT UPDATE (lifecycle_state, closed_at) ON TABLE public.acquisition_journeys TO service_role;

CREATE OR REPLACE FUNCTION public.acquisition_persist_instantly_person_event_result(
  p_person_id UUID,
  p_provider_event_id TEXT,
  p_event_type TEXT,
  p_occurred_at TIMESTAMPTZ,
  p_campaign_id TEXT,
  p_sender TEXT,
  p_metadata JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_campaign TEXT;
  v_event_id UUID;
  v_journey_id UUID;
  v_open_count INTEGER;
  v_created BOOLEAN := false;
  v_ownership TEXT := 'none';
BEGIN
  IF p_person_id IS NULL THEN
    RAISE EXCEPTION 'acquisition_instantly_event_person_required'
      USING ERRCODE = '22023';
  END IF;
  IF p_provider_event_id IS NULL OR btrim(p_provider_event_id) = '' THEN
    RAISE EXCEPTION 'acquisition_instantly_event_id_required'
      USING ERRCODE = '22023';
  END IF;
  IF p_event_type IS NULL OR char_length(p_event_type) < 1 OR char_length(p_event_type) > 80 THEN
    RAISE EXCEPTION 'acquisition_instantly_event_type_invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_occurred_at IS NULL THEN
    RAISE EXCEPTION 'acquisition_instantly_event_time_required'
      USING ERRCODE = '22023';
  END IF;

  v_campaign := NULLIF(btrim(COALESCE(p_campaign_id, '')), '');
  IF v_campaign IS NOT NULL AND char_length(v_campaign) > 80 THEN
    RAISE EXCEPTION 'acquisition_instantly_campaign_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF v_campaign IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      6102317,
      hashtext(p_person_id::text || ':' || v_campaign)
    );
  END IF;

  SELECT id
  INTO v_event_id
  FROM public.acquisition_events
  WHERE provider = 'instantly'
    AND provider_event_id = p_provider_event_id
  LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'result', 'duplicate',
      'journey_id', NULL,
      'journey_created', false,
      'ownership', 'none'
    );
  END IF;

  IF v_campaign IS NOT NULL THEN
    SELECT count(*)
    INTO v_open_count
    FROM public.acquisition_journeys
    WHERE person_id = p_person_id
      AND campaign_id = v_campaign
      AND closed_at IS NULL;
    IF v_open_count = 1 THEN
      SELECT id
      INTO v_journey_id
      FROM public.acquisition_journeys
      WHERE person_id = p_person_id
        AND campaign_id = v_campaign
        AND closed_at IS NULL
      LIMIT 1;
      v_ownership := 'known';
    ELSIF v_open_count = 0 THEN
      INSERT INTO public.acquisition_journeys (person_id, campaign_id)
      VALUES (p_person_id, v_campaign)
      RETURNING id INTO v_journey_id;
      v_created := true;
      v_ownership := 'known';
    ELSE
      v_journey_id := NULL;
      v_ownership := 'ambiguous';
    END IF;
  END IF;

  INSERT INTO public.acquisition_events (
    person_id,
    provider,
    provider_event_id,
    event_type,
    occurred_at,
    campaign_id,
    sender,
    metadata,
    journey_id
  ) VALUES (
    p_person_id,
    'instantly',
    p_provider_event_id,
    p_event_type,
    p_occurred_at,
    v_campaign,
    p_sender,
    COALESCE(p_metadata, '{}'::jsonb),
    v_journey_id
  );

  RETURN jsonb_build_object(
    'result', 'inserted',
    'journey_id', v_journey_id,
    'journey_created', v_created,
    'ownership', v_ownership
  );
EXCEPTION
  WHEN unique_violation THEN
    v_event_id := NULL;
    SELECT id
    INTO v_event_id
    FROM public.acquisition_events
    WHERE provider = 'instantly'
      AND provider_event_id = p_provider_event_id
    LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'result', 'duplicate',
        'journey_id', NULL,
        'journey_created', false,
        'ownership', 'none'
      );
    END IF;
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.acquisition_persist_instantly_person_event_result(
  uuid, text, text, timestamptz, text, text, jsonb
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.acquisition_persist_instantly_person_event_result(
  uuid, text, text, timestamptz, text, text, jsonb
) FROM anon;

REVOKE ALL ON FUNCTION public.acquisition_persist_instantly_person_event_result(
  uuid, text, text, timestamptz, text, text, jsonb
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.acquisition_persist_instantly_person_event_result(
  uuid, text, text, timestamptz, text, text, jsonb
) TO service_role;

COMMENT ON FUNCTION public.acquisition_persist_instantly_person_event_result(
  uuid, text, text, timestamptz, text, text, jsonb
) IS
  'Stores one Instantly person event on the single open journey. Creates a journey only when none is open. Returns ambiguous when more than one is open. Does not send email or rewrite accepted actions.';
