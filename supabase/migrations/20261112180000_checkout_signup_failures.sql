-- Proposed only. Do not apply from the app, and do not run this against production
-- until a human reviews it. checkout_browser_intents already exists.
-- Confirm its id column is uuid before applying the foreign key.
--
-- One row per distinct known technical failure. Repeating the same step and
-- code does not add another row. A different code is kept. No message,
-- cookie, token, or provider body is stored.
-- Deleting a checkout intent removes only these diagnostic rows.

BEGIN;

CREATE TABLE public.checkout_signup_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_intent_id uuid NOT NULL
    REFERENCES public.checkout_browser_intents (id) ON DELETE CASCADE,
  step text NOT NULL,
  error_code text NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checkout_signup_failures_step_chk CHECK (
    step IN ('prepare', 'activate', 'confirm', 'link', 'hold')
  ),
  CONSTRAINT checkout_signup_failures_code_chk CHECK (
    error_code IN (
      'clerk_create_failed',
      'clerk_lookup_failed',
      'clerk_ticket_failed',
      'missing_clerk',
      'intent_load_failed',
      'intent_update_failed',
      'missing_stripe',
      'stripe_clear_hold_failed'
    )
  ),
  CONSTRAINT checkout_signup_failures_once_uq
    UNIQUE (checkout_intent_id, step, error_code)
);

COMMENT ON TABLE public.checkout_signup_failures IS
  'Distinct known signup failures for one checkout intent. This does not authorize activation, linking, or hold release.';

ALTER TABLE public.checkout_signup_failures ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.checkout_signup_failures FROM anon;
REVOKE ALL ON TABLE public.checkout_signup_failures FROM authenticated;
REVOKE ALL ON TABLE public.checkout_signup_failures FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE public.checkout_signup_failures TO service_role;

COMMIT;
