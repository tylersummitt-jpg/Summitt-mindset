-- Meta Conversions API idempotency ledger (StartTrial / Subscribe).
-- Additive only. Does not modify Stripe webhook, Apple, SMS, marketing, or entitlement tables.
-- Access: server-side service-role only (Next.js webhook helper).
-- Direct anon/authenticated table access is intentionally revoked.
-- No client RLS policies are created.
--
-- Rollback (before production rows exist):
--   DROP TABLE IF EXISTS public.meta_conversion_events;

CREATE TABLE public.meta_conversion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL,
  meta_event_id TEXT NOT NULL,
  event_time INTEGER NOT NULL,
  value NUMERIC NULL,
  currency TEXT NULL,
  external_id_hash TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,

  CONSTRAINT meta_conversion_events_event_name_chk CHECK (
    event_name IN ('StartTrial', 'Subscribe')
  ),
  CONSTRAINT meta_conversion_events_subscription_id_nonempty_chk CHECK (
    length(trim(stripe_subscription_id)) > 0
  ),
  CONSTRAINT meta_conversion_events_meta_event_id_nonempty_chk CHECK (
    length(trim(meta_event_id)) > 0
  ),
  CONSTRAINT meta_conversion_events_currency_chk CHECK (
    currency IS NULL OR currency IN ('USD')
  )
);

COMMENT ON TABLE public.meta_conversion_events IS
  'First-writer-wins Meta CAPI conversion claims. One StartTrial and one Subscribe per Stripe subscription. Service-role / server routes only. No contact identifiers, SMS, goals, or raw Clerk IDs.';

COMMENT ON COLUMN public.meta_conversion_events.external_id_hash IS
  'SHA-256 hex of Clerk user id for CAPI user_data.external_id. Never store the raw Clerk id here.';

COMMENT ON COLUMN public.meta_conversion_events.value IS
  'Subscribe only: invoice.amount_paid / 100 captured at first claim so pending retries keep the original amount.';

COMMENT ON COLUMN public.meta_conversion_events.sent_at IS
  'Set after Meta Graph API accepts the event. Null means claimed/pending and may be retried.';

CREATE UNIQUE INDEX meta_conversion_events_event_sub_uq
  ON public.meta_conversion_events (event_name, stripe_subscription_id);

CREATE UNIQUE INDEX meta_conversion_events_meta_event_id_uq
  ON public.meta_conversion_events (meta_event_id);

ALTER TABLE public.meta_conversion_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.meta_conversion_events FROM anon;
REVOKE ALL ON TABLE public.meta_conversion_events FROM authenticated;
REVOKE ALL ON TABLE public.meta_conversion_events FROM PUBLIC;
REVOKE ALL ON TABLE public.meta_conversion_events FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meta_conversion_events TO service_role;
