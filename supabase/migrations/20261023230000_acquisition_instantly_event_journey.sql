-- Atomically store one Instantly person event and its observational journey.
-- Git push does not run this file. This file does not send email or change lifecycle.

CREATE OR REPLACE FUNCTION public.acquisition_persist_instantly_person_event(
  p_person_id UUID,
  p_provider_event_id TEXT,
  p_event_type TEXT,
  p_occurred_at TIMESTAMPTZ,
  p_campaign_id TEXT,
  p_sender TEXT,
  p_metadata JSONB
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_campaign TEXT;
  v_event_id UUID;
  v_journey_id UUID;
  v_journey_count INTEGER;
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

  -- Namespace 6102317 is this function only, separate from coach-memory locks.
  -- A hash collision only shares the wait. The reads below still filter the pair.
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
    RETURN 'duplicate';
  END IF;

  IF v_campaign IS NOT NULL THEN
    SELECT count(*)
    INTO v_journey_count
    FROM public.acquisition_journeys
    WHERE person_id = p_person_id
      AND campaign_id = v_campaign;
    IF v_journey_count = 1 THEN
      SELECT id
      INTO v_journey_id
      FROM public.acquisition_journeys
      WHERE person_id = p_person_id
        AND campaign_id = v_campaign
      LIMIT 1;
    ELSIF v_journey_count = 0 THEN
      INSERT INTO public.acquisition_journeys (person_id, campaign_id)
      VALUES (p_person_id, v_campaign)
      RETURNING id INTO v_journey_id;
    ELSE
      v_journey_id := NULL;
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

  RETURN 'inserted';
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
      RETURN 'duplicate';
    END IF;
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.acquisition_persist_instantly_person_event(
  uuid, text, text, timestamptz, text, text, jsonb
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.acquisition_persist_instantly_person_event(
  uuid, text, text, timestamptz, text, text, jsonb
) FROM anon;

REVOKE ALL ON FUNCTION public.acquisition_persist_instantly_person_event(
  uuid, text, text, timestamptz, text, text, jsonb
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.acquisition_persist_instantly_person_event(
  uuid, text, text, timestamptz, text, text, jsonb
) TO service_role;

COMMENT ON FUNCTION public.acquisition_persist_instantly_person_event(
  uuid, text, text, timestamptz, text, text, jsonb
) IS
  'Stores one Instantly person event. Reuses one observational journey for a person and campaign. Does not change lifecycle or send email.';
