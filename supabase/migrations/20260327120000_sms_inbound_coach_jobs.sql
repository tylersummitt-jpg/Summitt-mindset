-- Async processing for Twilio inbound coach replies (durability + retries).
-- One row per Twilio MessageSid.

CREATE TABLE sms_inbound_coach_jobs (
  message_sid TEXT PRIMARY KEY,
  clerk_user_id TEXT NOT NULL,
  from_phone TEXT NOT NULL,
  raw_body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reply_body TEXT NULL,
  sent_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  outbound_message_sid TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sms_inbound_coach_jobs_status
  ON sms_inbound_coach_jobs (status);

CREATE INDEX idx_sms_inbound_coach_jobs_next_retry
  ON sms_inbound_coach_jobs (next_retry_at);
