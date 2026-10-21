-- Proposed only. Do not apply from the app, and do not run this against production
-- until a human reviews it. checkout_browser_intents already exists in production.
--
-- IP-derived country captured when checkout begins, used only to decide whether
-- a later Google Ads conversion upload is eligible. Not a Meta match field.
-- Not copied into Stripe metadata. Nullable. No backfill. No new grants or RLS.
-- Does not replace purge_app_data_for_account_deletion.
--
-- Account deletion nulls the column through clearCheckoutMatchFieldsForClerkUser.
-- The hourly Meta and Google click-id cleanups do not null it, so it remains
-- available at trial start and at the first successful payment.
-- Deploy the app only after this column exists: account deletion names it and
-- fails closed when the write fails.

BEGIN;

ALTER TABLE public.checkout_browser_intents
  ADD COLUMN IF NOT EXISTS request_country TEXT NULL;

ALTER TABLE public.checkout_browser_intents
  DROP CONSTRAINT IF EXISTS checkout_browser_intents_request_country_chk;

ALTER TABLE public.checkout_browser_intents
  ADD CONSTRAINT checkout_browser_intents_request_country_chk CHECK (
    request_country IS NULL
    OR request_country ~ '^[A-Z]{2}$'
  );

COMMENT ON COLUMN public.checkout_browser_intents.request_country IS
  'ISO country from the Vercel edge at checkout start. Eligibility for a future Google Ads upload. Not for admin or customer display. Cleared on account deletion.';

COMMIT;
