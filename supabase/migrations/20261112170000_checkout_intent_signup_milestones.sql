-- Proposed only. Do not apply from the app, and do not run this against production
-- until a human reviews it. checkout_browser_intents already exists in production.
--
-- Three nullable milestone timestamps. A null value means the event was not
-- recorded. It does not mean the customer left or that a screen was displayed.
-- No default, no backfill, no new constraint, index, grant, trigger, or RLS change.

BEGIN;

ALTER TABLE public.checkout_browser_intents
  ADD COLUMN sign_in_client_reached_at timestamptz NULL,
  ADD COLUMN auth_observed_at timestamptz NULL,
  ADD COLUMN onboarding_reached_at timestamptz NULL;

COMMENT ON COLUMN public.checkout_browser_intents.sign_in_client_reached_at IS
  'The sign-in page JavaScript called our server, and the existing binding cookie resolved to this checkout. This does not prove the screen was displayed or a credential was submitted.';

COMMENT ON COLUMN public.checkout_browser_intents.auth_observed_at IS
  'A server entry point observed a verified Clerk user while the existing binding cookie resolved to this checkout. This does not link the user or the subscription.';

COMMENT ON COLUMN public.checkout_browser_intents.onboarding_reached_at IS
  'The onboarding identity handler continued toward rendering for the Clerk user already stored on this checkout. This does not prove the browser displayed the page or that identity was saved.';

COMMIT;
