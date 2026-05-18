-- M2B: durable SMS thread memory projection per active commitment (coach/user thread state).
-- Written on successful coach outbound (daily V3 + inbound coach reply); inbound answer updates in M2B-3.

CREATE TABLE v2_commitment_sms_thread_memory (
  commitment_id UUID PRIMARY KEY REFERENCES v2_commitment (id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  projection_version INTEGER NOT NULL DEFAULT 1,
  last_outbound_full_body TEXT NULL,
  last_outbound_sent_at TIMESTAMPTZ NULL,
  last_outbound_source TEXT NULL,
  last_outbound_message_sid TEXT NULL,
  last_inbound_full_body TEXT NULL,
  last_inbound_at TIMESTAMPTZ NULL,
  last_inbound_message_sid TEXT NULL,
  last_5_coach_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_5_user_answers JSONB NOT NULL DEFAULT '[]'::jsonb,
  open_question_text TEXT NULL,
  open_question_asked_at TIMESTAMPTZ NULL,
  open_question_expected_answer_type TEXT NULL,
  open_question_source_message_sid TEXT NULL,
  open_question_answer_text TEXT NULL,
  open_question_answered_at TIMESTAMPTZ NULL,
  open_question_pending BOOLEAN NOT NULL DEFAULT false,
  do_not_repeat_phrases JSONB NOT NULL DEFAULT '[]'::jsonb,
  recent_frustration_corrections JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_live_thread_summary TEXT NULL,
  last_recomputed_from_spine_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_v2_commitment_sms_thread_memory_clerk
  ON v2_commitment_sms_thread_memory (clerk_user_id);

CREATE INDEX idx_v2_commitment_sms_thread_memory_updated
  ON v2_commitment_sms_thread_memory (updated_at DESC);

CREATE INDEX idx_v2_commitment_sms_thread_memory_open_question_pending
  ON v2_commitment_sms_thread_memory (commitment_id)
  WHERE open_question_pending = true;

CREATE INDEX idx_v2_commitment_sms_thread_memory_last_outbound_sent
  ON v2_commitment_sms_thread_memory (last_outbound_sent_at DESC);

COMMENT ON TABLE v2_commitment_sms_thread_memory IS
  'Durable SMS relationship thread projection: last outbound/inbound, open question, anti-repeat hints.';

-- Server-only: no client policies; app uses service role (supabaseServer).
ALTER TABLE v2_commitment_sms_thread_memory ENABLE ROW LEVEL SECURITY;

-- M2A packet read scale: clerk_user_id + time ordering on SMS tables.
CREATE INDEX IF NOT EXISTS idx_sms_inbound_coach_jobs_clerk_updated
  ON sms_inbound_coach_jobs (clerk_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_send_events_clerk_created
  ON sms_send_events (clerk_user_id, created_at DESC);

-- sms_inbound_messages is used with created_at in app code (retention rollups); not defined in repo migrations.
-- Add index only when column exists (safe for environments that already have the table).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sms_inbound_messages'
      AND column_name = 'created_at'
  ) THEN
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS idx_sms_inbound_messages_clerk_created
      ON sms_inbound_messages (clerk_user_id, created_at DESC)
    $idx$;
  END IF;
END $$;
