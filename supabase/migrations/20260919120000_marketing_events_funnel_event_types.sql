-- Widen marketing_events.event_type CHECK only.
-- Additive. Preserves rows, indexes, RLS, grants, visitor_id NOT NULL.
-- Does not add columns or unique indexes.

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
      'trial_created',
      'identity_completed',
      'goal_completed',
      'sms_consent_completed',
      'setup_completed',
      'first_reply_received'
    )
  );
