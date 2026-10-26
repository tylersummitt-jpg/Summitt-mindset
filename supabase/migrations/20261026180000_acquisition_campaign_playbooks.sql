-- Campaign playbooks describe what Summitt Mindset may do after a reply.
-- A new version does not rewrite an older version. Journeys pin the version
-- that existed when the journey was created. This file does not send email,
-- does not change automation or the blocklist, and does not update existing actions.

CREATE TABLE public.acquisition_campaign_playbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  audience TEXT NOT NULL,
  offer_label TEXT NULL,
  offer_key TEXT NULL,
  resources JSONB NOT NULL DEFAULT '[]'::jsonb,
  manual_resource TEXT NULL,
  personal_video_id UUID NULL,
  permitted_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  reply_guidance TEXT NULL,
  fulfillment TEXT NOT NULL,
  status TEXT NOT NULL,
  scheduling_open BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT acquisition_campaign_playbooks_campaign_chk
    CHECK (campaign_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  CONSTRAINT acquisition_campaign_playbooks_version_chk
    CHECK (version >= 1),
  CONSTRAINT acquisition_campaign_playbooks_name_chk
    CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT acquisition_campaign_playbooks_audience_chk
    CHECK (char_length(audience) BETWEEN 1 AND 80),
  CONSTRAINT acquisition_campaign_playbooks_offer_label_chk
    CHECK (offer_label IS NULL OR char_length(offer_label) BETWEEN 1 AND 120),
  CONSTRAINT acquisition_campaign_playbooks_offer_key_chk
    CHECK (offer_key IS NULL OR offer_key ~ '^[a-z0-9_]{1,64}$'),
  CONSTRAINT acquisition_campaign_playbooks_resources_chk
    CHECK (jsonb_typeof(resources) = 'array' AND jsonb_array_length(resources) <= 4),
  CONSTRAINT acquisition_campaign_playbooks_manual_chk
    CHECK (manual_resource IS NULL OR char_length(manual_resource) BETWEEN 1 AND 400),
  CONSTRAINT acquisition_campaign_playbooks_guidance_chk
    CHECK (reply_guidance IS NULL OR char_length(reply_guidance) BETWEEN 1 AND 1000),
  CONSTRAINT acquisition_campaign_playbooks_fulfillment_chk
    CHECK (fulfillment IN ('catalog', 'video', 'catalog_and_video', 'manual', 'none')),
  CONSTRAINT acquisition_campaign_playbooks_status_chk
    CHECK (status IN ('current', 'superseded', 'paused', 'retired')),
  CONSTRAINT acquisition_campaign_playbooks_version_uq
    UNIQUE (campaign_id, version),
  CONSTRAINT acquisition_campaign_playbooks_video_fk
    FOREIGN KEY (personal_video_id) REFERENCES public.personal_videos (id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX acquisition_campaign_playbooks_open_uq
  ON public.acquisition_campaign_playbooks (campaign_id)
  WHERE status IN ('current', 'paused');

CREATE TABLE public.acquisition_journey_playbook_pins (
  journey_id UUID PRIMARY KEY,
  playbook_id UUID NOT NULL,
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT acquisition_journey_playbook_pins_journey_fk
    FOREIGN KEY (journey_id) REFERENCES public.acquisition_journeys (id) ON DELETE RESTRICT,
  CONSTRAINT acquisition_journey_playbook_pins_playbook_fk
    FOREIGN KEY (playbook_id) REFERENCES public.acquisition_campaign_playbooks (id) ON DELETE RESTRICT
);

ALTER TABLE public.acquisition_campaign_playbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acquisition_journey_playbook_pins ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.acquisition_campaign_playbooks FROM anon, authenticated, PUBLIC, service_role;
REVOKE ALL ON TABLE public.acquisition_journey_playbook_pins FROM anon, authenticated, PUBLIC, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.acquisition_campaign_playbooks TO service_role;
GRANT SELECT, INSERT ON TABLE public.acquisition_journey_playbook_pins TO service_role;

COMMENT ON TABLE public.acquisition_campaign_playbooks IS
  'Immutable campaign versions. Status may change. Promise fields stay on the version a journey pinned. Activating a playbook does not change automation, interpretation, sending, or the blocklist.';

COMMENT ON TABLE public.acquisition_journey_playbook_pins IS
  'One playbook version for a journey, written once. A later playbook edit does not move this pin. Journeys without a pin keep the legacy campaign_assets map.';

-- One transaction: the previous open version stays open unless the new row is inserted.
CREATE FUNCTION public.acquisition_save_campaign_playbook(
  p_campaign_id TEXT,
  p_name TEXT,
  p_audience TEXT,
  p_offer_label TEXT,
  p_offer_key TEXT,
  p_resources JSONB,
  p_manual_resource TEXT,
  p_personal_video_id UUID,
  p_permitted_actions JSONB,
  p_reply_guidance TEXT,
  p_fulfillment TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_latest_id UUID;
  v_latest_version INTEGER;
  v_latest_status TEXT;
  v_latest_open BOOLEAN;
  v_new_id UUID;
  v_new_version INTEGER;
  v_new_status TEXT;
  v_new_open BOOLEAN;
BEGIN
  PERFORM pg_advisory_xact_lock(6102618, hashtext(p_campaign_id));

  SELECT id, version, status, scheduling_open
  INTO v_latest_id, v_latest_version, v_latest_status, v_latest_open
  FROM public.acquisition_campaign_playbooks
  WHERE campaign_id = p_campaign_id
  ORDER BY version DESC
  LIMIT 1
  FOR UPDATE;

  IF v_latest_id IS NULL THEN
    v_new_status := 'current';
    v_new_open := true;
  ELSIF v_latest_status = 'retired' THEN
    v_new_status := 'retired';
    v_new_open := false;
  ELSIF v_latest_status = 'current' AND v_latest_open THEN
    v_new_status := 'current';
    v_new_open := true;
  ELSIF v_latest_status = 'superseded' AND v_latest_open THEN
    v_new_status := 'current';
    v_new_open := true;
  ELSE
    v_new_status := 'paused';
    v_new_open := false;
  END IF;

  IF v_latest_id IS NOT NULL AND v_latest_status IN ('current', 'paused') THEN
    UPDATE public.acquisition_campaign_playbooks
    SET status = 'superseded'
    WHERE id = v_latest_id
      AND status IN ('current', 'paused');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'acquisition_playbook_version_conflict'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  v_new_version := COALESCE(v_latest_version, 0) + 1;

  INSERT INTO public.acquisition_campaign_playbooks (
    campaign_id, version, name, audience, offer_label, offer_key,
    resources, manual_resource, personal_video_id, permitted_actions,
    reply_guidance, fulfillment, status, scheduling_open
  ) VALUES (
    p_campaign_id, v_new_version, p_name, p_audience, p_offer_label, p_offer_key,
    COALESCE(p_resources, '[]'::jsonb), p_manual_resource, p_personal_video_id,
    COALESCE(p_permitted_actions, '[]'::jsonb), p_reply_guidance, p_fulfillment,
    v_new_status, v_new_open
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('id', v_new_id, 'version', v_new_version, 'status', v_new_status, 'scheduling_open', v_new_open);
END;
$$;

REVOKE ALL ON FUNCTION public.acquisition_save_campaign_playbook(
  text, text, text, text, text, jsonb, text, uuid, jsonb, text, text
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.acquisition_save_campaign_playbook(
  text, text, text, text, text, jsonb, text, uuid, jsonb, text, text
) FROM anon;

REVOKE ALL ON FUNCTION public.acquisition_save_campaign_playbook(
  text, text, text, text, text, jsonb, text, uuid, jsonb, text, text
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.acquisition_save_campaign_playbook(
  text, text, text, text, text, jsonb, text, uuid, jsonb, text, text
) TO service_role;

COMMENT ON FUNCTION public.acquisition_save_campaign_playbook(
  text, text, text, text, text, jsonb, text, uuid, jsonb, text, text
) IS
  'Replaces a playbook version only when the new row is inserted. A paused or retired campaign stays closed. A failure leaves the previous version unchanged. Does not send email or change automation.';
