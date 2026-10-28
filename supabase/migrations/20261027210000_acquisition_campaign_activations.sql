-- One row per campaign is the activation registry.
-- This file copies the old JSON snapshot. It does not send email, does not
-- change global automation, and does not update journeys, events, actions, or playbooks.
-- Apply this before the application deploy that reads the table.
-- Leave conversation_pilot_campaigns in place as the snapshot this migration copied.
-- The application must not write that column after this migration.

CREATE TABLE public.acquisition_campaign_activations (
  campaign_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  activated_at TIMESTAMPTZ NULL,
  last_activated_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT acquisition_campaign_activations_id_chk
    CHECK (campaign_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  CONSTRAINT acquisition_campaign_activations_state_chk
    CHECK (state IN ('inactive', 'active', 'paused', 'finished')),
  CONSTRAINT acquisition_campaign_activations_gate_chk
    CHECK (
      (state = 'active' AND activated_at IS NOT NULL)
      OR (state <> 'active' AND activated_at IS NULL)
    )
);

ALTER TABLE public.acquisition_campaign_activations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.acquisition_campaign_activations FROM anon, authenticated, PUBLIC, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.acquisition_campaign_activations TO service_role;

COMMENT ON TABLE public.acquisition_campaign_activations IS
  'The only post-reply activation registry. Inactive bare ids stay closed. Active is the only state with a live timestamp. Pausing or finishing nulls that timestamp and keeps the row. This table does not send email.';

CREATE FUNCTION public.acquisition_activation_timestamp(value text)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF value IS NULL OR value !~ '^\d{4}-\d{2}-\d{2}T' THEN
    RETURN NULL;
  END IF;
  RETURN value::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

INSERT INTO public.acquisition_campaign_activations (campaign_id, state, activated_at, last_activated_at, updated_at)
SELECT
  parsed.campaign_id,
  CASE
    WHEN parsed.activated_at IS NOT NULL THEN 'active'
    WHEN parsed.kind = 'string' THEN 'inactive'
    WHEN retired.campaign_id IS NOT NULL THEN 'finished'
    ELSE 'paused'
  END,
  parsed.activated_at,
  parsed.activated_at,
  now()
FROM (
  SELECT
    CASE
      WHEN jsonb_typeof(elem) = 'string' THEN btrim(elem #>> '{}')
      WHEN jsonb_typeof(elem) = 'object' THEN btrim(elem->>'id')
      ELSE NULL
    END AS campaign_id,
    CASE
      WHEN jsonb_typeof(elem) = 'object' THEN public.acquisition_activation_timestamp(elem->>'activatedAt')
      ELSE NULL
    END AS activated_at,
    jsonb_typeof(elem) AS kind
  FROM public.acquisition_settings AS settings
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(settings.conversation_pilot_campaigns) = 'array' THEN settings.conversation_pilot_campaigns
      ELSE '[]'::jsonb
    END
  ) AS elem
  WHERE settings.id = 'default'
) AS parsed
LEFT JOIN (
  SELECT campaign_id
  FROM public.acquisition_campaign_playbooks AS playbooks
  WHERE status = 'retired'
    AND version = (
      SELECT max(latest.version)
      FROM public.acquisition_campaign_playbooks AS latest
      WHERE latest.campaign_id = playbooks.campaign_id
    )
) AS retired ON retired.campaign_id = parsed.campaign_id
WHERE parsed.campaign_id ~ '^[A-Za-z0-9_-]{1,80}$'
ON CONFLICT (campaign_id) DO NOTHING;

DROP FUNCTION public.acquisition_activation_timestamp(text);
