-- Personal video analytics.
-- Already applied in production on 2026-10-14. Safe to re-run.
-- Adds a manual sent time and three marketing event names.
-- Does not add a table, email column, or recipient.

BEGIN;

ALTER TABLE public.personal_videos
  ADD COLUMN IF NOT EXISTS link_sent_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.personal_videos.link_sent_at IS
  'When the link was manually marked sent. Null means not sent. Not a recipient or an email address.';

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
      'homepage_video_completed',
      'personal_video_visited',
      'personal_video_played',
      'personal_video_cta_clicked'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS marketing_events_personal_video_milestone_uq
  ON public.marketing_events (
    visitor_id,
    event_type,
    (metadata->>'personal_video_id')
  )
  WHERE event_type IN (
    'personal_video_visited',
    'personal_video_played',
    'personal_video_cta_clicked'
  )
  AND visitor_id IS NOT NULL
  AND (metadata->>'personal_video_id') IS NOT NULL;

COMMIT;
