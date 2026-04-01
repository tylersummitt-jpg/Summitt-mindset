-- Last outbound SMS context per user (one row per clerk_user_id, upserted by app after successful sends).
-- Additive only: no changes to existing tables; no foreign keys.

CREATE TABLE sms_last_outbound_context (
  clerk_user_id TEXT PRIMARY KEY,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message_kind TEXT NOT NULL,
  full_body TEXT NOT NULL,
  question_position INT NULL,
  time_of_day TEXT NULL,
  twilio_message_sid TEXT NULL,
  delivery_snapshot JSONB NULL,
  CONSTRAINT sms_last_outbound_context_message_kind_chk
    CHECK (
      message_kind IN (
        'question',
        'quote',
        'coach',
        'nudge',
        'weekly',
        'transactional'
      )
    )
);

CREATE INDEX idx_sms_last_outbound_context_sent_at
  ON sms_last_outbound_context (sent_at DESC);

COMMENT ON TABLE sms_last_outbound_context IS
  'Latest successful outbound SMS per user; overwritten on each qualifying send.';

COMMENT ON COLUMN sms_last_outbound_context.message_kind IS
  'question | quote | coach | nudge | weekly | transactional';

COMMENT ON COLUMN sms_last_outbound_context.time_of_day IS
  'morning | evening when applicable; otherwise NULL';
