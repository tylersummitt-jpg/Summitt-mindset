-- Nonmember recovery storage.
-- This migration does not send email, does not enroll anyone,
-- and does not change challenge, billing, Clerk, or SMS tables.
-- The inserted settings row keeps automation off.

CREATE TABLE public.recovery_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  automation_status TEXT NOT NULL DEFAULT 'off',
  enrollment_starts_at TIMESTAMPTZ NULL,
  daily_send_cap INTEGER NOT NULL DEFAULT 25,
  inbound_ready BOOLEAN NOT NULL DEFAULT false,
  suppression_check_ready BOOLEAN NOT NULL DEFAULT false,
  suppression_source TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL DEFAULT 'migration',
  CONSTRAINT recovery_settings_id_chk CHECK (id = 'default'),
  CONSTRAINT recovery_settings_status_chk CHECK (
    automation_status IN ('off', 'pilot', 'active', 'paused')
  ),
  CONSTRAINT recovery_settings_cap_chk CHECK (daily_send_cap BETWEEN 1 AND 100),
  CONSTRAINT recovery_settings_suppression_source_chk CHECK (char_length(suppression_source) <= 240),
  CONSTRAINT recovery_settings_suppression_attestation_chk CHECK (
    suppression_check_ready = false OR char_length(btrim(suppression_source)) > 0
  )
);

CREATE TABLE public.recovery_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL UNIQUE,
  email_normalized TEXT NOT NULL,
  assignment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  stop_reason TEXT NULL,
  account_created_at TIMESTAMPTZ NOT NULL,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recovery_enrollments_assignment_chk CHECK (assignment IN ('control', 'recovery')),
  CONSTRAINT recovery_enrollments_status_chk CHECK (status IN ('active', 'stopped')),
  CONSTRAINT recovery_enrollments_clerk_chk CHECK (char_length(btrim(clerk_user_id)) > 0),
  CONSTRAINT recovery_enrollments_email_chk CHECK (
    char_length(email_normalized) BETWEEN 6 AND 254
    AND position('@' in email_normalized) > 1
  )
);

CREATE TABLE public.recovery_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES public.recovery_enrollments (id) ON DELETE RESTRICT,
  step INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_message_id TEXT NULL,
  token_hash TEXT NULL UNIQUE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ NULL,
  claim_until TIMESTAMPTZ NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT recovery_messages_step_chk CHECK (step IN (1, 2, 3)),
  CONSTRAINT recovery_messages_status_chk CHECK (
    status IN (
      'scheduled',
      'claimed',
      'accepted',
      'delivered',
      'failed',
      'suppressed',
      'canceled',
      'uncertain'
    )
  ),
  CONSTRAINT recovery_messages_attempt_chk CHECK (attempt_count BETWEEN 0 AND 2),
  UNIQUE (enrollment_id, step)
);

CREATE TABLE public.recovery_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_normalized TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  token_hash TEXT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recovery_suppressions_reason_chk CHECK (
    reason IN ('unsubscribe', 'complaint', 'bounce', 'provider')
  ),
  CONSTRAINT recovery_suppressions_email_chk CHECK (
    char_length(email_normalized) BETWEEN 6 AND 254
    AND position('@' in email_normalized) > 1
  )
);

CREATE TABLE public.recovery_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id TEXT NOT NULL UNIQUE,
  enrollment_id UUID NULL REFERENCES public.recovery_enrollments (id) ON DELETE RESTRICT,
  message_step INTEGER NULL,
  received_at TIMESTAMPTZ NOT NULL,
  first_name TEXT NULL,
  preview TEXT NOT NULL,
  classification TEXT NOT NULL,
  status TEXT NOT NULL,
  in_reply_to TEXT NULL,
  handled_at TIMESTAMPTZ NULL,
  CONSTRAINT recovery_replies_class_chk CHECK (
    classification IN ('human', 'auto', 'bounce', 'unmatched')
  ),
  CONSTRAINT recovery_replies_status_chk CHECK (
    status IN ('needs_reply', 'handled', 'ignored')
  ),
  CONSTRAINT recovery_replies_preview_chk CHECK (char_length(preview) <= 140)
);

CREATE INDEX recovery_messages_due_idx
  ON public.recovery_messages (status, scheduled_at);

CREATE INDEX recovery_replies_attention_idx
  ON public.recovery_replies (status, received_at DESC);

INSERT INTO public.recovery_settings (id, automation_status, inbound_ready, suppression_check_ready)
VALUES ('default', 'off', false, false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.recovery_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_replies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.recovery_settings FROM anon, authenticated, PUBLIC, service_role;
REVOKE ALL ON TABLE public.recovery_enrollments FROM anon, authenticated, PUBLIC, service_role;
REVOKE ALL ON TABLE public.recovery_messages FROM anon, authenticated, PUBLIC, service_role;
REVOKE ALL ON TABLE public.recovery_suppressions FROM anon, authenticated, PUBLIC, service_role;
REVOKE ALL ON TABLE public.recovery_replies FROM anon, authenticated, PUBLIC, service_role;

GRANT SELECT, UPDATE ON TABLE public.recovery_settings TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.recovery_enrollments TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.recovery_messages TO service_role;
GRANT SELECT, INSERT ON TABLE public.recovery_suppressions TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.recovery_replies TO service_role;

COMMENT ON TABLE public.recovery_settings IS
  'One recovery switch. Default is off. Deploying this table does not send email.';
COMMENT ON COLUMN public.recovery_settings.suppression_source IS
  'Operator note of which opt-out sources were checked. Empty means the check is not done. An empty suppression table is not that check.';
COMMENT ON TABLE public.recovery_suppressions IS
  'Marketing recovery opt-outs only. Not SMS STOP and not challenge unsubscribe. Rows are not deleted.';
COMMENT ON TABLE public.recovery_replies IS
  'Inbound recovery replies for Tyler. Service role only. No public access.';
