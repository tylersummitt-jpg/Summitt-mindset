-- Build #5 checkout tracking.
-- Additive. Does not change Stripe, Apple, Clerk, SMS, prices, or trial length.
-- Allows the existing checkout_opened event to be stored once per Checkout
-- Session, adds checkout_creation_failed, and allows a missing visitor id
-- so an unattributed attempt is not dropped.
-- Git push does not run this file. Do not execute until reviewed.
--
-- Read-only inspection if production has drifted:
-- SELECT pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conname = 'marketing_events_event_type_chk';
--
-- SELECT column_name, is_nullable, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'marketing_events'
--   AND column_name = 'visitor_id';

ALTER TABLE public.marketing_events
  DROP CONSTRAINT IF EXISTS marketing_events_event_type_chk;

ALTER TABLE public.marketing_events
  ADD CONSTRAINT marketing_events_event_type_chk CHECK (
    event_type IN (
      'page_viewed',
      'trial_cta_clicked',
      'account_created',
      'plan_selected',
      'auth_completed',
      'checkout_opened',
      'checkout_creation_failed',
      'trial_created',
      'identity_completed',
      'goal_completed',
      'sms_consent_completed',
      'setup_completed',
      'first_reply_received',
      'homepage_video_reached',
      'homepage_video_started',
      'homepage_video_50',
      'homepage_video_completed'
    )
  );

ALTER TABLE public.marketing_events
  ALTER COLUMN visitor_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS marketing_events_checkout_opened_session_uq
  ON public.marketing_events ((metadata->>'checkout_session_id'))
  WHERE event_type = 'checkout_opened'
    AND coalesce(metadata->>'checkout_session_id', '') <> '';
