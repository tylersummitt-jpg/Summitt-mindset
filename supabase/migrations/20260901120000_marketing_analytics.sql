-- First-party marketing analytics (admin Subscriber Growth Dashboard).
-- Additive only. Does not modify Stripe, Apple, SMS, onboarding, or entitlement tables.
-- Access: server-side service-role only (Clerk-authenticated Next.js routes).
-- Direct anon/authenticated table access is intentionally revoked.
-- No client RLS policies are created.
--
-- Rollback (before production rows exist):
--   DROP TABLE IF EXISTS public.ad_spend;
--   DROP TABLE IF EXISTS public.marketing_attribution;
--   DROP TABLE IF EXISTS public.marketing_events;

-- ---------------------------------------------------------------------------
-- 1) marketing_events — acquisition instrumentation only (no billing copies)
-- ---------------------------------------------------------------------------

CREATE TABLE public.marketing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type TEXT NOT NULL,
  visitor_id UUID NOT NULL,
  clerk_user_id TEXT NULL,
  path TEXT NULL,
  utm_source TEXT NULL,
  utm_medium TEXT NULL,
  utm_campaign TEXT NULL,
  utm_content TEXT NULL,
  source_normalized TEXT NULL,
  is_paid_acquisition BOOLEAN NOT NULL DEFAULT FALSE,
  referrer_host TEXT NULL,
  metadata JSONB NULL,

  CONSTRAINT marketing_events_event_type_chk CHECK (
    event_type IN ('page_viewed', 'trial_cta_clicked', 'account_created')
  ),
  CONSTRAINT marketing_events_source_normalized_chk CHECK (
    source_normalized IS NULL OR source_normalized IN (
      'direct',
      'organic_social',
      'meta',
      'google',
      'referral'
    )
  ),
  CONSTRAINT marketing_events_clerk_user_id_nonempty_chk CHECK (
    clerk_user_id IS NULL OR length(trim(clerk_user_id)) > 0
  )
);

COMMENT ON TABLE public.marketing_events IS
  'First-party marketing acquisition events for the admin growth dashboard. '
  'No names, emails, phone numbers, SMS bodies, goals, or IP addresses. '
  'clerk_user_id is an internal linkage key only. Service-role / server routes only.';

COMMENT ON COLUMN public.marketing_events.metadata IS
  'Tight allowlist only (cta_surface). Never store name, email, phone, SMS, goals, or IPs.';

CREATE INDEX marketing_events_occurred_at_idx
  ON public.marketing_events (occurred_at);

CREATE INDEX marketing_events_type_occurred_idx
  ON public.marketing_events (event_type, occurred_at);

CREATE INDEX marketing_events_visitor_occurred_idx
  ON public.marketing_events (visitor_id, occurred_at);

CREATE INDEX marketing_events_clerk_type_idx
  ON public.marketing_events (clerk_user_id, event_type);

CREATE UNIQUE INDEX marketing_events_account_created_clerk_uq
  ON public.marketing_events (clerk_user_id)
  WHERE event_type = 'account_created' AND clerk_user_id IS NOT NULL;

ALTER TABLE public.marketing_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.marketing_events FROM anon;
REVOKE ALL ON TABLE public.marketing_events FROM authenticated;
REVOKE ALL ON TABLE public.marketing_events FROM PUBLIC;
REVOKE ALL ON TABLE public.marketing_events FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.marketing_events TO service_role;

-- ---------------------------------------------------------------------------
-- 2) marketing_attribution — immutable first-touch per Clerk user
-- ---------------------------------------------------------------------------

CREATE TABLE public.marketing_attribution (
  clerk_user_id TEXT PRIMARY KEY,
  visitor_id UUID NOT NULL,
  first_touch_at TIMESTAMPTZ NOT NULL,
  source_normalized TEXT NOT NULL,
  is_paid_acquisition BOOLEAN NOT NULL,
  source_detail TEXT NULL,
  utm_source TEXT NULL,
  utm_medium TEXT NULL,
  utm_campaign TEXT NULL,
  utm_content TEXT NULL,
  referrer_host TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT marketing_attribution_clerk_user_id_nonempty_chk CHECK (
    length(trim(clerk_user_id)) > 0
  ),
  CONSTRAINT marketing_attribution_source_normalized_chk CHECK (
    source_normalized IN (
      'direct',
      'organic_social',
      'meta',
      'google',
      'referral'
    )
  ),
  CONSTRAINT marketing_attribution_source_detail_chk CHECK (
    source_detail IS NULL OR source_detail = 'coach'
  )
);

COMMENT ON TABLE public.marketing_attribution IS
  'Immutable first-touch acquisition per Clerk user. Insert ON CONFLICT DO NOTHING. '
  'clerk_user_id is an internal linkage key only. '
  'No names, emails, phone numbers, SMS bodies, goals, or IP addresses. '
  'Service-role / server routes only. Do not copy into Clerk public metadata.';

CREATE INDEX marketing_attribution_visitor_id_idx
  ON public.marketing_attribution (visitor_id);

CREATE INDEX marketing_attribution_source_idx
  ON public.marketing_attribution (source_normalized, is_paid_acquisition);

ALTER TABLE public.marketing_attribution ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.marketing_attribution FROM anon;
REVOKE ALL ON TABLE public.marketing_attribution FROM authenticated;
REVOKE ALL ON TABLE public.marketing_attribution FROM PUBLIC;
REVOKE ALL ON TABLE public.marketing_attribution FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.marketing_attribution TO service_role;

-- ---------------------------------------------------------------------------
-- 3) ad_spend — daily manual Meta/Google spend
-- ---------------------------------------------------------------------------

CREATE TABLE public.ad_spend (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spend_date DATE NOT NULL,
  source_normalized TEXT NOT NULL,
  utm_campaign TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ad_spend_source_normalized_chk CHECK (
    source_normalized IN ('meta', 'google')
  ),
  CONSTRAINT ad_spend_amount_positive_chk CHECK (amount_cents > 0),
  CONSTRAINT ad_spend_currency_chk CHECK (currency = 'usd')
);

COMMENT ON TABLE public.ad_spend IS
  'Manual daily advertising spend for blended period CPS. Meta and Google only. '
  'Service-role / server routes only.';

CREATE UNIQUE INDEX ad_spend_day_source_campaign_uq
  ON public.ad_spend (
    spend_date,
    source_normalized,
    utm_campaign
  );

CREATE INDEX ad_spend_spend_date_idx
  ON public.ad_spend (spend_date);

ALTER TABLE public.ad_spend ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ad_spend FROM anon;
REVOKE ALL ON TABLE public.ad_spend FROM authenticated;
REVOKE ALL ON TABLE public.ad_spend FROM PUBLIC;
REVOKE ALL ON TABLE public.ad_spend FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ad_spend TO service_role;
