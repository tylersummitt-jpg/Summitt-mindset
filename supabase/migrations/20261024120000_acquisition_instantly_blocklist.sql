-- Local only. Git push does not run this file. Do not execute until reviewed.
-- instantly_blocklist defaults off. Applying this file does not call Instantly.
-- Rows are stop intent and confirmation. This file does not delete people, events, or journeys.

ALTER TABLE public.acquisition_settings
  ADD COLUMN instantly_blocklist TEXT NOT NULL DEFAULT 'off';

ALTER TABLE public.acquisition_settings
  ADD CONSTRAINT acquisition_settings_instantly_blocklist_chk
  CHECK (instantly_blocklist IN ('off', 'on'));

CREATE TABLE public.acquisition_instantly_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NULL,
  email_normalized TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  source_event_id TEXT NOT NULL,
  provider_entry_id TEXT NULL,
  provider_confirmed_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  claim_until TIMESTAMPTZ NULL,
  next_attempt_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT acquisition_instantly_blocks_email_chk CHECK (
    char_length(email_normalized) BETWEEN 6 AND 254
    AND position('@' in email_normalized) > 1
  ),
  CONSTRAINT acquisition_instantly_blocks_reason_chk CHECK (
    reason IN ('trial_started', 'paid_member', 'unsubscribe', 'complaint', 'bounce')
  ),
  CONSTRAINT acquisition_instantly_blocks_status_chk CHECK (
    status IN ('pending', 'confirmed', 'failed', 'uncertain')
  ),
  CONSTRAINT acquisition_instantly_blocks_source_chk CHECK (
    char_length(source_event_id) BETWEEN 1 AND 180
  ),
  CONSTRAINT acquisition_instantly_blocks_provider_entry_chk CHECK (
    provider_entry_id IS NULL OR char_length(provider_entry_id) BETWEEN 1 AND 80
  ),
  CONSTRAINT acquisition_instantly_blocks_error_chk CHECK (
    last_error IS NULL OR char_length(last_error) BETWEEN 1 AND 80
  ),
  CONSTRAINT acquisition_instantly_blocks_evidence_chk CHECK (
    jsonb_typeof(evidence) = 'array'
    AND pg_column_size(evidence) <= 4000
  ),
  CONSTRAINT acquisition_instantly_blocks_attempt_chk CHECK (attempt_count >= 0),
  CONSTRAINT acquisition_instantly_blocks_person_fk
    FOREIGN KEY (person_id)
    REFERENCES public.acquisition_people (id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX acquisition_instantly_blocks_email_uq
  ON public.acquisition_instantly_blocks (email_normalized);

CREATE UNIQUE INDEX acquisition_instantly_blocks_source_uq
  ON public.acquisition_instantly_blocks (source_event_id);

CREATE INDEX acquisition_instantly_blocks_due_idx
  ON public.acquisition_instantly_blocks (status, next_attempt_at);

ALTER TABLE public.acquisition_instantly_blocks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.acquisition_instantly_blocks FROM anon, authenticated, PUBLIC, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.acquisition_instantly_blocks TO service_role;

COMMENT ON TABLE public.acquisition_instantly_blocks IS
  'One Instantly blocklist intent per acquisition email. Confirmation is a provider entry id. A failed row stays until that confirmation. Rows are not deleted and are not an unblock.';

-- Durable keyset for the hourly reconciliation. Null email means start at the first row.
-- Generation increases only when a pass wraps. A failed read does not change these values.
-- Applying this file does not call Instantly.

ALTER TABLE public.acquisition_settings
  ADD COLUMN instantly_reconcile_people_email TEXT NULL,
  ADD COLUMN instantly_reconcile_people_gen INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN instantly_reconcile_suppression_email TEXT NULL,
  ADD COLUMN instantly_reconcile_suppression_gen INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.acquisition_settings
  ADD CONSTRAINT acquisition_settings_reconcile_people_email_chk CHECK (
    instantly_reconcile_people_email IS NULL
    OR (
      char_length(instantly_reconcile_people_email) BETWEEN 6 AND 254
      AND position('@' in instantly_reconcile_people_email) > 1
    )
  ),
  ADD CONSTRAINT acquisition_settings_reconcile_people_gen_chk CHECK (
    instantly_reconcile_people_gen >= 0
  ),
  ADD CONSTRAINT acquisition_settings_reconcile_suppression_email_chk CHECK (
    instantly_reconcile_suppression_email IS NULL
    OR (
      char_length(instantly_reconcile_suppression_email) BETWEEN 6 AND 254
      AND position('@' in instantly_reconcile_suppression_email) > 1
    )
  ),
  ADD CONSTRAINT acquisition_settings_reconcile_suppression_gen_chk CHECK (
    instantly_reconcile_suppression_gen >= 0
  );

COMMENT ON COLUMN public.acquisition_settings.instantly_reconcile_people_email IS
  'Last qualifying acquisition email resolved by hourly stop-intent reconciliation. Null starts at the beginning.';

COMMENT ON COLUMN public.acquisition_settings.instantly_reconcile_suppression_email IS
  'Last suppression email resolved by hourly stop-intent reconciliation. Null starts at the beginning.';
