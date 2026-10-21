-- Proposed only. Do not apply from the app, and do not run this against production
-- until a human reviews it.
--
-- Idempotency ledger for Google Ads Data Manager ingestion.
-- One trial upload and one first-payment upload per Stripe subscription.
-- Does not alter Stripe tables, checkout intents, the Meta ledger,
-- or purge_app_data_for_account_deletion.
--
-- google_request_id is the ingestion request id Google returns after it
-- accepts the HTTP request. It is not proof the event was processed or
-- attributed. Account deletion nulls the click id through the app.
-- Deploy the app only after this table exists: account deletion names it
-- and fails closed when the write fails.

BEGIN;

CREATE TABLE IF NOT EXISTS public.google_ads_conversion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_kind TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  event_time INTEGER NOT NULL,
  value NUMERIC NULL,
  currency TEXT NULL,
  google_click_id_type TEXT NULL,
  google_click_id TEXT NULL,
  request_country TEXT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  google_request_id TEXT NULL,
  accepted_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT google_ads_conversion_events_kind_chk CHECK (
    event_kind IN ('trial_started', 'first_payment')
  ),
  CONSTRAINT google_ads_conversion_events_subscription_chk CHECK (
    length(trim(stripe_subscription_id)) > 0
  ),
  CONSTRAINT google_ads_conversion_events_transaction_chk CHECK (
    (
      event_kind = 'trial_started'
      AND transaction_id = 'start_trial:' || stripe_subscription_id
    )
    OR (
      event_kind = 'first_payment'
      AND transaction_id = 'subscribe:' || stripe_subscription_id
    )
  ),
  CONSTRAINT google_ads_conversion_events_value_chk CHECK (
    (
      event_kind = 'trial_started'
      AND value IS NULL
      AND currency IS NULL
    )
    OR (
      event_kind = 'first_payment'
      AND value > 0
      AND currency = 'USD'
    )
  ),
  CONSTRAINT google_ads_conversion_events_status_chk CHECK (
    (
      status = 'pending'
      AND request_country = 'US'
      AND google_request_id IS NULL
      AND accepted_at IS NULL
      AND google_click_id_type IN ('gclid', 'wbraid', 'gbraid')
      AND google_click_id ~ '^[A-Za-z0-9._~-]+$'
      AND char_length(google_click_id) BETWEEN 1 AND 512
    )
    OR (
      status = 'ingestion_accepted'
      AND request_country = 'US'
      AND google_request_id IS NOT NULL
      AND length(trim(google_request_id)) > 0
      AND accepted_at IS NOT NULL
      AND (
        (
          google_click_id IS NULL
          AND google_click_id_type IS NULL
        )
        OR (
          google_click_id_type IN ('gclid', 'wbraid', 'gbraid')
          AND google_click_id ~ '^[A-Za-z0-9._~-]+$'
          AND char_length(google_click_id) BETWEEN 1 AND 512
        )
      )
    )
    OR (
      status = 'suppressed'
      AND request_country IS NULL
      AND google_click_id IS NULL
      AND google_click_id_type IS NULL
      AND google_request_id IS NULL
      AND accepted_at IS NULL
    )
  )
);

COMMENT ON TABLE public.google_ads_conversion_events IS
  'Google Ads Data Manager ingestion claims. One trial and one first payment per Stripe subscription. ingestion_accepted means Google returned a requestId. It does not mean the conversion was processed or attributed. Service-role only. No name, email, phone, IP, or coaching content.';

COMMENT ON COLUMN public.google_ads_conversion_events.google_request_id IS
  'Data Manager ingest requestId after HTTP acceptance. Not an attribution id.';

COMMENT ON COLUMN public.google_ads_conversion_events.status IS
  'pending: claimed locally. ingestion_accepted: Google accepted the ingest request. suppressed: do not upload. Never means processed or attributed.';

CREATE UNIQUE INDEX IF NOT EXISTS google_ads_conversion_events_kind_sub_uq
  ON public.google_ads_conversion_events (event_kind, stripe_subscription_id);

CREATE UNIQUE INDEX IF NOT EXISTS google_ads_conversion_events_transaction_uq
  ON public.google_ads_conversion_events (transaction_id);

CREATE INDEX IF NOT EXISTS google_ads_conversion_events_pending_idx
  ON public.google_ads_conversion_events (created_at)
  WHERE status = 'pending';

ALTER TABLE public.google_ads_conversion_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.google_ads_conversion_events FROM anon;
REVOKE ALL ON TABLE public.google_ads_conversion_events FROM authenticated;
REVOKE ALL ON TABLE public.google_ads_conversion_events FROM PUBLIC;
REVOKE ALL ON TABLE public.google_ads_conversion_events FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.google_ads_conversion_events TO service_role;

COMMIT;
