-- Already applied live. Repo history only.
-- Git push / Vercel do not execute this migration.
-- Mirrors the production marketing_events check plus
-- marketing_events_homepage_video_milestone_uq.
-- Do not run this file against production again.

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
      'first_reply_received',
      'homepage_video_reached',
      'homepage_video_started',
      'homepage_video_50',
      'homepage_video_completed'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS marketing_events_homepage_video_milestone_uq
  ON public.marketing_events (
    visitor_id,
    event_type,
    (metadata->>'vimeo_video_id')
  )
  WHERE event_type IN (
    'homepage_video_reached',
    'homepage_video_started',
    'homepage_video_50',
    'homepage_video_completed'
  )
  AND (metadata->>'vimeo_video_id') IS NOT NULL;
