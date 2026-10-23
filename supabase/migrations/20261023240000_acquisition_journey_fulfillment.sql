-- Journey-scoped fulfillment snapshots and a result RPC.
-- Does not drop UNIQUE (person_id, action_type).
-- Does not send email. Git push does not run this file.
-- The deployed text RPC stays in place for the current application.

ALTER TABLE public.acquisition_actions
  ADD COLUMN promised_offer_key TEXT NULL,
  ADD COLUMN promised_label TEXT NULL,
  ADD COLUMN promised_assets JSONB NULL;

ALTER TABLE public.acquisition_actions
  ADD CONSTRAINT acquisition_actions_promised_offer_key_chk
  CHECK (
    promised_offer_key IS NULL
    OR promised_offer_key ~ '^[a-z0-9_]{1,64}$'
  );

ALTER TABLE public.acquisition_actions
  ADD CONSTRAINT acquisition_actions_promised_label_chk
  CHECK (
    promised_label IS NULL
    OR char_length(promised_label) BETWEEN 1 AND 120
  );

-- Structural limit only. The application catalog rejects unknown resources.
ALTER TABLE public.acquisition_actions
  ADD CONSTRAINT acquisition_actions_promised_assets_chk
  CHECK (
    CASE
      WHEN promised_assets IS NULL THEN true
      WHEN jsonb_typeof(promised_assets) <> 'array' THEN false
      ELSE
        jsonb_array_length(promised_assets) BETWEEN 1 AND 4
        AND pg_column_size(promised_assets) <= 500
    END
  );

CREATE UNIQUE INDEX acquisition_actions_legacy_person_type_uq
  ON public.acquisition_actions (person_id, action_type)
  WHERE journey_id IS NULL;

CREATE UNIQUE INDEX acquisition_actions_journey_type_uq
  ON public.acquisition_actions (journey_id, action_type)
  WHERE journey_id IS NOT NULL;

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
    RETURN jsonb_build_object('result', 'duplicate', 'journey_id', NULL);
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

  RETURN jsonb_build_object('result', 'inserted', 'journey_id', v_journey_id);
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
      RETURN jsonb_build_object('result', 'duplicate', 'journey_id', NULL);
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
  'Stores one Instantly person event and returns the journey it used. Does not change lifecycle or send email.';
