-- Proposed only. Do not apply from the app, and do not run this against production
-- until a human reviews it. checkout_browser_intents already exists in production;
-- this repository has no CREATE TABLE for it, so this migration only adds columns.
--
-- One typed Google click id for a later Data Manager upload. Not a Meta match
-- field. Not copied into Stripe metadata, marketing_events, or marketing_attribution.
-- Nullable. No backfill. Service role already reaches this table; no new grants
-- or RLS policies. Does not replace purge_app_data_for_account_deletion.
--
-- Account deletion nulls both columns through clearCheckoutMatchFieldsForClerkUser.
-- The existing hourly checkout-match cleanup nulls them after an abandoned
-- binding expires, or seven days after stripe_trial_end_at. A Clerk Meta copy
-- does not clear them.

BEGIN;

ALTER TABLE public.checkout_browser_intents
  ADD COLUMN IF NOT EXISTS google_click_id_type TEXT NULL,
  ADD COLUMN IF NOT EXISTS google_click_id TEXT NULL;

ALTER TABLE public.checkout_browser_intents
  DROP CONSTRAINT IF EXISTS checkout_browser_intents_google_click_id_pair_chk;

ALTER TABLE public.checkout_browser_intents
  ADD CONSTRAINT checkout_browser_intents_google_click_id_pair_chk CHECK (
    (
      google_click_id_type IS NULL
      AND google_click_id IS NULL
    )
    OR (
      google_click_id_type IN ('gclid', 'gbraid', 'wbraid')
      AND google_click_id IS NOT NULL
      AND length(trim(google_click_id)) > 0
      AND length(google_click_id) <= 512
    )
  );

COMMENT ON COLUMN public.checkout_browser_intents.google_click_id_type IS
  'gclid, gbraid, or wbraid. Sensitive attribution. Not for admin or customer display. Not a Meta field.';

COMMENT ON COLUMN public.checkout_browser_intents.google_click_id IS
  'One Google click id paired with google_click_id_type. Sensitive. Do not log. Cleared on account deletion and after trial_end plus seven days.';

COMMIT;
