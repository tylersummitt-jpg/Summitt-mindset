-- Canonical acquisition person, event ledger, and warm-email outbox.
-- Git push does not run this file. Do not execute until reviewed.
-- The settings row is OFF. Applying this file does not send email.

CREATE TABLE public.acquisition_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  automation_status TEXT NOT NULL DEFAULT 'off',
  video_delay_hours INTEGER NOT NULL DEFAULT 24,
  trial_followup_delay_hours INTEGER NOT NULL DEFAULT 72,
  daily_send_cap INTEGER NOT NULL DEFAULT 25,
  evergreen_personal_video_id UUID NULL,
  campaign_assets JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT acquisition_settings_id_chk CHECK (id = 'default'),
  CONSTRAINT acquisition_settings_status_chk CHECK (
    automation_status IN ('off', 'pilot', 'active', 'paused')
  ),
  CONSTRAINT acquisition_settings_video_delay_chk CHECK (video_delay_hours BETWEEN 1 AND 168),
  CONSTRAINT acquisition_settings_followup_delay_chk CHECK (trial_followup_delay_hours BETWEEN 1 AND 336),
  CONSTRAINT acquisition_settings_cap_chk CHECK (daily_send_cap BETWEEN 1 AND 100)
);

CREATE TABLE public.acquisition_people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_normalized TEXT NOT NULL UNIQUE,
  first_name TEXT NULL,
  last_name TEXT NULL,
  acquisition_source TEXT NULL,
  source_campaign TEXT NULL,
  source_provider TEXT NULL,
  source_sender TEXT NULL,
  sport TEXT NULL,
  role TEXT NULL,
  geography TEXT NULL,
  requested_asset TEXT NULL,
  lifecycle_state TEXT NOT NULL,
  next_action_type TEXT NULL,
  next_action_at TIMESTAMPTZ NULL,
  close_reason TEXT NULL,
  clerk_user_id TEXT NULL,
  stripe_customer_id TEXT NULL,
  stripe_subscription_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT acquisition_people_email_chk CHECK (
    char_length(email_normalized) BETWEEN 6 AND 254
    AND position('@' in email_normalized) > 1
  ),
  CONSTRAINT acquisition_people_lifecycle_chk CHECK (
    lifecycle_state IN (
      'cold_active',
      'cold_no_response',
      'reply_needs_review',
      'asset_requested',
      'asset_sent',
      'warm_video_sent',
      'trial_invited',
      'trial_started',
      'paid_member',
      'not_interested',
      'unsubscribed',
      'suppressed',
      'trial_expired'
    )
  ),
  CONSTRAINT acquisition_people_asset_chk CHECK (
    requested_asset IS NULL OR requested_asset IN ('definite_dozen', 'playbook')
  ),
  CONSTRAINT acquisition_people_next_chk CHECK (
    next_action_type IS NULL OR next_action_type IN (
      'send_asset',
      'send_video',
      'send_trial_followup'
    )
  ),
  CONSTRAINT acquisition_people_close_chk CHECK (
    close_reason IS NULL OR char_length(close_reason) <= 40
  )
);

CREATE UNIQUE INDEX acquisition_people_clerk_uq
  ON public.acquisition_people (clerk_user_id)
  WHERE clerk_user_id IS NOT NULL;

CREATE UNIQUE INDEX acquisition_people_subscription_uq
  ON public.acquisition_people (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE INDEX acquisition_people_lifecycle_idx
  ON public.acquisition_people (lifecycle_state);

CREATE TABLE public.acquisition_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NULL REFERENCES public.acquisition_people (id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  provider_event_id TEXT NULL,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  campaign_id TEXT NULL,
  sender TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT acquisition_events_provider_chk CHECK (
    provider IN ('instantly', 'resend', 'personal_video', 'checkout', 'stripe', 'system')
  ),
  CONSTRAINT acquisition_events_type_chk CHECK (char_length(event_type) BETWEEN 1 AND 80),
  CONSTRAINT acquisition_events_metadata_chk CHECK (pg_column_size(metadata) <= 2000)
);

CREATE UNIQUE INDEX acquisition_events_provider_event_uq
  ON public.acquisition_events (provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE INDEX acquisition_events_person_idx
  ON public.acquisition_events (person_id, occurred_at DESC);

CREATE TABLE public.acquisition_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES public.acquisition_people (id) ON DELETE RESTRICT,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  idempotency_key TEXT NOT NULL UNIQUE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ NULL,
  claim_until TIMESTAMPTZ NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  provider_message_id TEXT NULL,
  delivered_at TIMESTAMPTZ NULL,
  token_hash TEXT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT acquisition_actions_type_chk CHECK (
    action_type IN ('send_asset', 'send_video', 'send_trial_followup')
  ),
  CONSTRAINT acquisition_actions_status_chk CHECK (
    status IN (
      'scheduled',
      'claimed',
      'accepted',
      'delivered',
      'failed',
      'suppressed',
      'canceled',
      'uncertain',
      'blocked'
    )
  ),
  CONSTRAINT acquisition_actions_attempt_chk CHECK (attempt_count BETWEEN 0 AND 2),
  UNIQUE (person_id, action_type)
);

CREATE INDEX acquisition_actions_due_idx
  ON public.acquisition_actions (status, scheduled_at);

CREATE TABLE public.acquisition_video_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES public.acquisition_people (id) ON DELETE RESTRICT,
  personal_video_id UUID NOT NULL REFERENCES public.personal_videos (id) ON DELETE RESTRICT,
  public_token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT acquisition_video_token_chk CHECK (
    public_token ~ '^[A-Za-z0-9_-]{32,80}$'
  ),
  UNIQUE (person_id, personal_video_id)
);

CREATE TABLE public.acquisition_sender_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_email TEXT NOT NULL UNIQUE,
  sender_account_id TEXT NULL,
  connection_status TEXT NOT NULL,
  detail TEXT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT acquisition_sender_source_chk CHECK (
    source IN ('instantly_webhook', 'instantly_api')
  ),
  CONSTRAINT acquisition_sender_status_chk CHECK (char_length(connection_status) BETWEEN 1 AND 40),
  CONSTRAINT acquisition_sender_detail_chk CHECK (detail IS NULL OR char_length(detail) <= 180)
);

CREATE INDEX acquisition_sender_observed_idx
  ON public.acquisition_sender_signals (observed_at DESC);

INSERT INTO public.acquisition_settings (id, automation_status)
VALUES ('default', 'off')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.acquisition_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acquisition_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acquisition_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acquisition_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acquisition_video_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acquisition_sender_signals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.acquisition_settings FROM anon, authenticated, PUBLIC, service_role;
REVOKE ALL ON TABLE public.acquisition_people FROM anon, authenticated, PUBLIC, service_role;
REVOKE ALL ON TABLE public.acquisition_events FROM anon, authenticated, PUBLIC, service_role;
REVOKE ALL ON TABLE public.acquisition_actions FROM anon, authenticated, PUBLIC, service_role;
REVOKE ALL ON TABLE public.acquisition_video_recipients FROM anon, authenticated, PUBLIC, service_role;
REVOKE ALL ON TABLE public.acquisition_sender_signals FROM anon, authenticated, PUBLIC, service_role;

GRANT SELECT, UPDATE ON TABLE public.acquisition_settings TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.acquisition_people TO service_role;
GRANT SELECT, INSERT ON TABLE public.acquisition_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.acquisition_actions TO service_role;
GRANT SELECT, INSERT ON TABLE public.acquisition_video_recipients TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.acquisition_sender_signals TO service_role;

COMMENT ON TABLE public.acquisition_people IS
  'One acquisition person per normalized email, before and after signup. Stripe subscription status is not stored here.';
COMMENT ON TABLE public.acquisition_events IS
  'Append-only acquisition ledger. Provider payloads are reduced to ids, timestamps, and a short preview.';
COMMENT ON TABLE public.acquisition_actions IS
  'Warm acquisition outbox only. Not a general job queue. Default automation is off, so due rows are not sent.';
COMMENT ON TABLE public.acquisition_settings IS
  'One acquisition switch. Default is off. Deploying this table does not send email.';
COMMENT ON TABLE public.acquisition_video_recipients IS
  'One opaque token per person per existing personal video. The Vimeo id stays on personal_videos.';
COMMENT ON TABLE public.acquisition_sender_signals IS
  'Raw Instantly account signals. No healthy, watch, or paused threshold is derived here.';
