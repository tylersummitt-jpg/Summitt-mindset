-- Email questions the interpreter cannot answer from verified facts.
-- One row per inbound message. knowledge_entry_id is reserved for a later
-- approved-knowledge row and is not written by this migration.

ALTER TABLE public.acquisition_messages
  DROP CONSTRAINT acquisition_messages_outcome_chk;

ALTER TABLE public.acquisition_messages
  ADD CONSTRAINT acquisition_messages_outcome_chk
  CHECK (ai_outcome IS NULL OR ai_outcome IN (
    'accept_offer',
    'ask_question',
    'referral',
    'offer_decline',
    'unsubscribe',
    'complaint',
    'ambiguous',
    'needs_human'
  ));

CREATE TABLE public.acquisition_email_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_message_id UUID NOT NULL,
  person_id UUID NOT NULL,
  journey_id UUID NULL,
  campaign_id TEXT NULL,
  missing_reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ NULL,
  notification_status TEXT NOT NULL DEFAULT 'pending',
  notification_attempts INTEGER NOT NULL DEFAULT 0,
  notification_error TEXT NULL,
  notified_at TIMESTAMPTZ NULL,
  approved_subject TEXT NULL,
  approved_body TEXT NULL,
  claim_until TIMESTAMPTZ NULL,
  provider_status_code INTEGER NULL,
  provider_response_id TEXT NULL,
  send_error TEXT NULL,
  knowledge_entry_id UUID NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT acquisition_email_answers_inbound_uq UNIQUE (inbound_message_id),
  CONSTRAINT acquisition_email_answers_inbound_fk
    FOREIGN KEY (inbound_message_id) REFERENCES public.acquisition_messages (id) ON DELETE RESTRICT,
  CONSTRAINT acquisition_email_answers_person_fk
    FOREIGN KEY (person_id) REFERENCES public.acquisition_people (id) ON DELETE RESTRICT,
  CONSTRAINT acquisition_email_answers_journey_fk
    FOREIGN KEY (journey_id, person_id) REFERENCES public.acquisition_journeys (id, person_id) ON DELETE RESTRICT,
  CONSTRAINT acquisition_email_answers_campaign_chk
    CHECK (campaign_id IS NULL OR char_length(campaign_id) BETWEEN 1 AND 80),
  CONSTRAINT acquisition_email_answers_reason_chk
    CHECK (char_length(missing_reason) BETWEEN 1 AND 240),
  CONSTRAINT acquisition_email_answers_status_chk
    CHECK (status IN ('open', 'sending', 'sent', 'blocked', 'uncertain', 'failed', 'cancelled')),
  CONSTRAINT acquisition_email_answers_notification_chk
    CHECK (notification_status IN ('pending', 'notifying', 'sent', 'failed')),
  CONSTRAINT acquisition_email_answers_attempts_chk
    CHECK (notification_attempts BETWEEN 0 AND 3),
  CONSTRAINT acquisition_email_answers_subject_chk
    CHECK (approved_subject IS NULL OR char_length(approved_subject) BETWEEN 1 AND 180),
  CONSTRAINT acquisition_email_answers_body_chk
    CHECK (approved_body IS NULL OR char_length(approved_body) BETWEEN 1 AND 2000),
  CONSTRAINT acquisition_email_answers_provider_chk
    CHECK (provider_response_id IS NULL OR char_length(provider_response_id) BETWEEN 1 AND 80),
  CONSTRAINT acquisition_email_answers_error_chk
    CHECK (notification_error IS NULL OR char_length(notification_error) <= 240),
  CONSTRAINT acquisition_email_answers_send_error_chk
    CHECK (send_error IS NULL OR char_length(send_error) <= 80)
);

CREATE INDEX acquisition_email_answers_open_idx
  ON public.acquisition_email_answers (status, notification_status, created_at);

CREATE INDEX acquisition_email_answers_journey_idx
  ON public.acquisition_email_answers (journey_id, status);

ALTER TABLE public.acquisition_email_answers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.acquisition_email_answers FROM anon, authenticated, PUBLIC, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.acquisition_email_answers TO service_role;

COMMENT ON TABLE public.acquisition_email_answers IS
  'Owner review for one inbound acquisition question. knowledge_entry_id stays null until a later phase attaches approved knowledge. A personal answer is not general policy.';

COMMENT ON COLUMN public.acquisition_email_answers.knowledge_entry_id IS
  'Reserved for a future approved-knowledge row. This phase does not set it.';

-- Gaps only. The hourly repair reads at most a few of these rows.
-- Installing this view does not change existing acquisition, SMS, Stripe, or Coach Pat rows.
CREATE VIEW public.acquisition_email_answer_gaps
WITH (security_invoker = true) AS
SELECT
  m.id,
  m.person_id,
  m.journey_id,
  m.campaign_id,
  m.ai_outcome,
  m.ai_reason,
  m.processing_error,
  m.created_at
FROM public.acquisition_messages m
WHERE m.direction = 'inbound'
  AND m.processing_status = 'interpreted'
  AND (
    m.ai_outcome = 'needs_human'
    OR (m.ai_outcome = 'ask_question' AND m.processing_error = 'draft_rejected')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.acquisition_email_answers a
    WHERE a.inbound_message_id = m.id
  );

REVOKE ALL ON TABLE public.acquisition_email_answer_gaps FROM anon, authenticated, PUBLIC;

GRANT SELECT ON TABLE public.acquisition_email_answer_gaps TO service_role;

COMMENT ON VIEW public.acquisition_email_answer_gaps IS
  'Interpreted inbound questions that do not yet have an acquisition_email_answers row. Read by the hourly repair. Not a second conversation engine.';
