-- Proposed only. Do not apply from the app, and do not run this against production
-- until a human reviews it.
--
-- Append-only onboarding flight recorder. A missing row means the event was
-- not recorded. It does not mean the member left. Rows do not grant access,
-- change onboarding state, or prove a successful Identity, Goal, SMS, or
-- completion write. Those successes stay in their existing tables.
-- No payload column. No names, identity text, goal text, phone numbers,
-- cookies, tokens, IP addresses, or raw exception messages.

BEGIN;

CREATE TABLE public.onboarding_journey_diagnostics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id text NOT NULL,
  step text NOT NULL,
  outcome text NOT NULL,
  error_code text NOT NULL DEFAULT 'none',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  journey_id text NOT NULL,
  attempt_id text NOT NULL,
  client_shell text NOT NULL,
  device_class text NOT NULL,
  browser_family text NOT NULL,
  source text NOT NULL,
  idempotency_key text NOT NULL,
  CONSTRAINT onboarding_journey_diagnostics_clerk_chk CHECK (
    length(btrim(clerk_user_id)) BETWEEN 1 AND 128
    AND clerk_user_id !~ '[[:space:]]'
  ),
  CONSTRAINT onboarding_journey_diagnostics_step_chk CHECK (
    step IN ('identity', 'goal', 'texts', 'complete', 'film_room')
  ),
  CONSTRAINT onboarding_journey_diagnostics_outcome_chk CHECK (
    outcome IN (
      'step_reached',
      'client_initialized',
      'submission_attempted',
      'validation_blocked',
      'request_received',
      'save_failed',
      'client_error',
      'step_advanced',
      'completion_attempted',
      'completion_failed'
    )
  ),
  CONSTRAINT onboarding_journey_diagnostics_error_chk CHECK (
    error_code IN (
      'none',
      'missing_name',
      'missing_anchor',
      'weak_anchor',
      'invalid_input',
      'missing_focus',
      'invalid_title',
      'invalid_behavior',
      'missing_identity',
      'missing_goal',
      'missing_review',
      'invalid_phone',
      'missing_consent',
      'phone_in_use',
      'unauthorized',
      'forbidden',
      'conflict',
      'persistence',
      'server',
      'request_failed',
      'render_failed',
      'account_deletion'
    )
  ),
  CONSTRAINT onboarding_journey_diagnostics_shell_chk CHECK (
    client_shell IN ('browser', 'in_app_browser', 'ios_app', 'android_app', 'unknown')
  ),
  CONSTRAINT onboarding_journey_diagnostics_device_chk CHECK (
    device_class IN ('desktop', 'phone', 'tablet', 'unknown')
  ),
  CONSTRAINT onboarding_journey_diagnostics_browser_chk CHECK (
    browser_family IN ('chrome', 'safari', 'firefox', 'edge', 'other', 'none')
  ),
  CONSTRAINT onboarding_journey_diagnostics_source_chk CHECK (
    source IN ('server', 'client')
  ),
  CONSTRAINT onboarding_journey_diagnostics_id_len_chk CHECK (
    length(journey_id) BETWEEN 1 AND 64
    AND length(attempt_id) BETWEEN 1 AND 64
    AND length(idempotency_key) BETWEEN 1 AND 200
  ),
  CONSTRAINT onboarding_journey_diagnostics_idempotency_uq UNIQUE (idempotency_key)
);

COMMENT ON TABLE public.onboarding_journey_diagnostics IS
  'Bounded onboarding diagnostic stream. Duplicate delivery of the same attempt collapses on idempotency_key. A different attempt is a new row. This table does not authorize membership or mark onboarding complete.';

CREATE INDEX onboarding_journey_diagnostics_clerk_recorded_idx
  ON public.onboarding_journey_diagnostics (clerk_user_id, recorded_at DESC);

ALTER TABLE public.onboarding_journey_diagnostics ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.onboarding_journey_diagnostics FROM anon;
REVOKE ALL ON TABLE public.onboarding_journey_diagnostics FROM authenticated;
REVOKE ALL ON TABLE public.onboarding_journey_diagnostics FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE public.onboarding_journey_diagnostics TO service_role;

COMMIT;
