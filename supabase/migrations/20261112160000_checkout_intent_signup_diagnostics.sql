-- Proposed only. Do not apply from the app, and do not run this against production
-- until a human reviews it. checkout_browser_intents already exists in production.
--
-- Six nullable diagnostic timestamps. A null value means the event was not
-- recorded. It does not mean the customer left. No default, no backfill, no
-- new constraint, index, grant, trigger, or RLS change.

BEGIN;

ALTER TABLE public.checkout_browser_intents
  ADD COLUMN return_seen_at timestamptz NULL,
  ADD COLUMN return_unbound_at timestamptz NULL,
  ADD COLUMN activate_retry_at timestamptz NULL,
  ADD COLUMN sign_in_redirected_at timestamptz NULL,
  ADD COLUMN link_retry_at timestamptz NULL,
  ADD COLUMN hold_release_retry_at timestamptz NULL;

COMMENT ON COLUMN public.checkout_browser_intents.return_seen_at IS
  'The return route handler resolved this intent from the binding cookie and continued toward the return response. It does not prove the browser received or displayed the page, and it does not mean activation succeeded.';

COMMENT ON COLUMN public.checkout_browser_intents.return_unbound_at IS
  'The checkout return page was requested with a Checkout Session id and without an accepted binding cookie. This does not identify a customer or authorize activation.';

COMMENT ON COLUMN public.checkout_browser_intents.activate_retry_at IS
  'The bound checkout activate handler returned retry. A later success does not clear this timestamp.';

COMMENT ON COLUMN public.checkout_browser_intents.sign_in_redirected_at IS
  'The checkout continue page issued an HTTP redirect to sign-in. This does not mean the sign-in page loaded or a credential was submitted.';

COMMENT ON COLUMN public.checkout_browser_intents.link_retry_at IS
  'The authenticated checkout link handler returned retry. This does not cancel the subscription or remove the sign-in requirement.';

COMMENT ON COLUMN public.checkout_browser_intents.hold_release_retry_at IS
  'Activation-hold completion returned retry and that attempt did not release the hold. A preserved cancellation is not this event.';

COMMIT;
