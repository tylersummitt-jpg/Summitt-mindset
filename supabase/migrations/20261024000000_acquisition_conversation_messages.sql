-- Durable acquisition conversation messages.
-- Git push does not run this file. This file does not send email.
-- Full reply text stays out of acquisition_events.metadata (2,000 byte cap).
-- conversation_interpretation and conversation_sending default off.

ALTER TABLE public.acquisition_settings
  ADD COLUMN conversation_interpretation TEXT NOT NULL DEFAULT 'off',
  ADD COLUMN conversation_sending TEXT NOT NULL DEFAULT 'off',
  ADD COLUMN conversation_pilot_campaigns JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.acquisition_settings
  ADD CONSTRAINT acquisition_settings_conversation_interpretation_chk
  CHECK (conversation_interpretation IN ('off', 'pilot'));

ALTER TABLE public.acquisition_settings
  ADD CONSTRAINT acquisition_settings_conversation_sending_chk
  CHECK (conversation_sending IN ('off', 'on'));

ALTER TABLE public.acquisition_settings
  ADD CONSTRAINT acquisition_settings_conversation_campaigns_chk
  CHECK (
    jsonb_typeof(conversation_pilot_campaigns) = 'array'
    AND pg_column_size(conversation_pilot_campaigns) <= 2000
  );

CREATE TABLE public.acquisition_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL,
  journey_id UUID NULL,
  direction TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  reply_to_provider_message_id TEXT NULL,
  campaign_id TEXT NULL,
  sender_account TEXT NULL,
  lead_email TEXT NOT NULL,
  subject TEXT NULL,
  body_text TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'stored',
  processing_error TEXT NULL,
  reply_block TEXT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  claimed_at TIMESTAMPTZ NULL,
  claim_until TIMESTAMPTZ NULL,
  ai_outcome TEXT NULL,
  ai_reason TEXT NULL,
  draft_subject TEXT NULL,
  draft_body TEXT NULL,
  effect_applied_at TIMESTAMPTZ NULL,
  provider_status_code INTEGER NULL,
  provider_response_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT acquisition_messages_direction_chk
    CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT acquisition_messages_provider_chk
    CHECK (provider IN ('instantly')),
  CONSTRAINT acquisition_messages_provider_message_chk
    CHECK (char_length(provider_message_id) BETWEEN 1 AND 180),
  CONSTRAINT acquisition_messages_reply_target_chk
    CHECK (
      reply_to_provider_message_id IS NULL
      OR char_length(reply_to_provider_message_id) BETWEEN 1 AND 80
    ),
  CONSTRAINT acquisition_messages_campaign_chk
    CHECK (campaign_id IS NULL OR char_length(campaign_id) BETWEEN 1 AND 80),
  CONSTRAINT acquisition_messages_sender_chk
    CHECK (sender_account IS NULL OR char_length(sender_account) BETWEEN 3 AND 254),
  CONSTRAINT acquisition_messages_lead_chk
    CHECK (
      char_length(lead_email) BETWEEN 6 AND 254
      AND position('@' in lead_email) > 1
    ),
  CONSTRAINT acquisition_messages_subject_chk
    CHECK (subject IS NULL OR char_length(subject) BETWEEN 1 AND 300),
  CONSTRAINT acquisition_messages_body_chk
    CHECK (char_length(body_text) <= 20000),
  CONSTRAINT acquisition_messages_status_chk
    CHECK (processing_status IN (
      'stored',
      'pending',
      'processing',
      'interpreted',
      'failed',
      'blocked',
      'uncertain',
      'sent'
    )),
  CONSTRAINT acquisition_messages_error_chk
    CHECK (processing_error IS NULL OR processing_error IN (
      'missing_body',
      'body_exceeds_cap',
      'model_failed',
      'model_malformed',
      'openai_unavailable',
      'eligibility_stop',
      'suppression_unknown',
      'fulfillment_unproven',
      'draft_rejected',
      'effect_unconfirmed',
      'missing_credentials',
      'missing_reply_target',
      'missing_account',
      'missing_subject',
      'ineligible',
      'unauthorized',
      'payment_required',
      'not_found',
      'rate_limited',
      'provider_error',
      'timeout_or_network',
      'unreadable_response',
      'no_provider_id'
    )),
  CONSTRAINT acquisition_messages_reply_block_chk
    CHECK (reply_block IS NULL OR reply_block IN (
      'missing_reply_target',
      'missing_account',
      'missing_subject'
    )),
  CONSTRAINT acquisition_messages_attempt_chk
    CHECK (attempt_count BETWEEN 0 AND 2),
  CONSTRAINT acquisition_messages_outcome_chk
    CHECK (ai_outcome IS NULL OR ai_outcome IN (
      'accept_offer',
      'ask_question',
      'referral',
      'offer_decline',
      'unsubscribe',
      'complaint',
      'ambiguous'
    )),
  CONSTRAINT acquisition_messages_reason_chk
    CHECK (ai_reason IS NULL OR char_length(ai_reason) <= 240),
  CONSTRAINT acquisition_messages_draft_subject_chk
    CHECK (draft_subject IS NULL OR char_length(draft_subject) BETWEEN 1 AND 180),
  CONSTRAINT acquisition_messages_draft_body_chk
    CHECK (draft_body IS NULL OR char_length(draft_body) BETWEEN 1 AND 2000),
  CONSTRAINT acquisition_messages_provider_response_chk
    CHECK (provider_response_id IS NULL OR char_length(provider_response_id) BETWEEN 1 AND 80),
  CONSTRAINT acquisition_messages_journey_person_fk
    FOREIGN KEY (journey_id, person_id)
    REFERENCES public.acquisition_journeys (id, person_id)
    MATCH SIMPLE
    ON DELETE RESTRICT,
  CONSTRAINT acquisition_messages_person_fk
    FOREIGN KEY (person_id)
    REFERENCES public.acquisition_people (id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX acquisition_messages_provider_message_uq
  ON public.acquisition_messages (provider, direction, provider_message_id);

CREATE UNIQUE INDEX acquisition_messages_provider_response_uq
  ON public.acquisition_messages (provider_response_id)
  WHERE provider_response_id IS NOT NULL;

CREATE INDEX acquisition_messages_person_idx
  ON public.acquisition_messages (person_id, occurred_at DESC);

CREATE INDEX acquisition_messages_status_idx
  ON public.acquisition_messages (processing_status, claim_until);

ALTER TABLE public.acquisition_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.acquisition_messages FROM anon, authenticated, PUBLIC, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.acquisition_messages TO service_role;

COMMENT ON TABLE public.acquisition_messages IS
  'Inbound and outbound acquisition conversation text. Event metadata stays a short preview. Trial and paid events on the person are not journey causation.';
