-- Proposed only. Do not apply from the app, and do not run this against production
-- until a human reviews it. checkout_browser_intents already exists in production.
--
-- One nullable queue marker. Automatic preparation skips a row once this is set.
-- It is not Clerk provisioning, authentication, entitlement, cancellation, or
-- activation-hold release. No default, no backfill, no new constraint, index,
-- grant, trigger, or RLS change.

BEGIN;

ALTER TABLE public.checkout_browser_intents
  ADD COLUMN prepare_closed_at timestamptz NULL;

COMMENT ON COLUMN public.checkout_browser_intents.prepare_closed_at IS
  'Automatic account preparation is closed for this checkout. This does not represent Clerk provisioning, authentication, entitlement, cancellation, or activation-hold release.';

COMMIT;
