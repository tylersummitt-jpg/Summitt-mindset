-- Approved reusable facts for the acquisition email interpreter.
-- Installing this table does not change campaigns, settings, messages, or sends.
-- A manual answer stays personal until Tyler sets acquisition_email_answers.knowledge_entry_id.

ALTER TABLE public.acquisition_messages
  DROP CONSTRAINT acquisition_messages_error_chk;

ALTER TABLE public.acquisition_messages
  ADD CONSTRAINT acquisition_messages_error_chk
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
      'no_provider_id',
      'knowledge_unreadable'
    ));

CREATE TABLE public.acquisition_email_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic TEXT NOT NULL,
  statement TEXT NOT NULL,
  category TEXT NOT NULL,
  scope TEXT NOT NULL,
  campaign_id TEXT NULL,
  offer_key TEXT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  source_request_id UUID NULL,
  supersedes_id UUID NULL,
  approved_by TEXT NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL,
  retired_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT acquisition_email_knowledge_topic_chk
    CHECK (topic ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  CONSTRAINT acquisition_email_knowledge_statement_chk
    CHECK (char_length(statement) BETWEEN 1 AND 2000),
  CONSTRAINT acquisition_email_knowledge_category_chk
    CHECK (category IN (
      'membership',
      'offer',
      'pat_biography',
      'tyler_biography',
      'product',
      'approved_answer'
    )),
  CONSTRAINT acquisition_email_knowledge_scope_chk
    CHECK (
      (scope = 'general' AND campaign_id IS NULL AND offer_key IS NULL)
      OR (scope = 'campaign' AND campaign_id IS NOT NULL AND offer_key IS NULL AND char_length(campaign_id) BETWEEN 1 AND 80)
      OR (scope = 'offer' AND offer_key IS NOT NULL AND campaign_id IS NULL AND offer_key ~ '^[a-z0-9_]{1,64}$')
    ),
  CONSTRAINT acquisition_email_knowledge_status_chk
    CHECK (
      (status = 'active' AND retired_at IS NULL)
      OR (status = 'retired' AND retired_at IS NOT NULL)
    ),
  CONSTRAINT acquisition_email_knowledge_approver_chk
    CHECK (approved_by = 'tyler'),
  CONSTRAINT acquisition_email_knowledge_source_fk
    FOREIGN KEY (source_request_id) REFERENCES public.acquisition_email_answers (id) ON DELETE RESTRICT,
  CONSTRAINT acquisition_email_knowledge_supersedes_fk
    FOREIGN KEY (supersedes_id) REFERENCES public.acquisition_email_knowledge (id) ON DELETE RESTRICT,
  CONSTRAINT acquisition_email_knowledge_not_self_chk
    CHECK (supersedes_id IS NULL OR supersedes_id <> id)
);

CREATE UNIQUE INDEX acquisition_email_knowledge_source_uq
  ON public.acquisition_email_knowledge (source_request_id)
  WHERE source_request_id IS NOT NULL;

CREATE INDEX acquisition_email_knowledge_active_idx
  ON public.acquisition_email_knowledge (scope, campaign_id, offer_key, approved_at DESC)
  WHERE status = 'active';

ALTER TABLE public.acquisition_email_knowledge ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.acquisition_email_knowledge FROM anon, authenticated, PUBLIC, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.acquisition_email_knowledge TO service_role;

COMMENT ON TABLE public.acquisition_email_knowledge IS
  'Tyler-approved facts the acquisition interpreter may use. Retired and conflicting rows are not sent to the model as answers. A personal refund is not reusable policy.';

ALTER TABLE public.acquisition_email_answers
  ADD CONSTRAINT acquisition_email_answers_knowledge_fk
    FOREIGN KEY (knowledge_entry_id) REFERENCES public.acquisition_email_knowledge (id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.acquisition_email_answers.knowledge_entry_id IS
  'Set only when Tyler explicitly saves a sent answer as reusable knowledge. A one-off reply leaves this null.';
