-- Tyler Text Overview: immutable machine generation history + current send draft pointer.
-- Phase 1 schema only. Server/service-role access via supabaseServer; no client policies.

-- ---------------------------------------------------------------------------
-- Table 1: sms_daily_draft_generations (append-only machine output + writer notebook)
-- ---------------------------------------------------------------------------
CREATE TABLE sms_daily_draft_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  draft_for_day_key TEXT NOT NULL,
  generation_number INTEGER NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  generation_reason TEXT NOT NULL
    CHECK (generation_reason IN (
      'noon_batch',
      'inbound_after_generation',
      'evening_sweep',
      'pre_send_stale_refresh',
      'live_send_fallback',
      'manual_regenerate'
    )),

  commitment_id TEXT NULL,

  machine_draft_body TEXT NULL,
  machine_should_send BOOLEAN NOT NULL DEFAULT false,
  machine_no_send_reason TEXT NULL,

  writer_openai_messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  writer_prompt_path TEXT NULL,
  writer_notebook_snapshot JSONB NULL,
  notebook_hash TEXT NULL,

  notebook_verdict TEXT NOT NULL DEFAULT 'not_applicable'
    CHECK (notebook_verdict IN ('verified', 'failed', 'not_applicable')),
  notebook_verdict_reason TEXT NOT NULL DEFAULT 'writer_not_invoked',

  notebook_source_candidate_count INTEGER NULL,
  notebook_exact_source_message_count INTEGER NULL,
  notebook_thread_message_count INTEGER NULL,
  notebook_filtered_out_reason_top TEXT NULL,

  route_kind TEXT NULL,
  generation_metadata JSONB NULL,

  last_inbound_at_at_generation TIMESTAMPTZ NULL,
  last_outbound_at_at_generation TIMESTAMPTZ NULL,
  timezone_snapshot TEXT NULL,
  send_pref_snapshot TEXT NULL,

  machine_body_hash TEXT NULL,

  superseded_by_generation_id UUID NULL
    REFERENCES sms_daily_draft_generations (id),
  superseded_at TIMESTAMPTZ NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sms_daily_draft_generations_user_day_gen_unique
    UNIQUE (clerk_user_id, draft_for_day_key, generation_number)
);

CREATE INDEX idx_sms_daily_draft_generations_user_day_generated
  ON sms_daily_draft_generations (clerk_user_id, draft_for_day_key, generated_at DESC);

CREATE INDEX idx_sms_daily_draft_generations_day_reason
  ON sms_daily_draft_generations (draft_for_day_key, generation_reason);

COMMENT ON TABLE sms_daily_draft_generations IS
  'Immutable Tyler Text Overview machine generation history. '
  'Stores autonomous lane output and exact OpenAI writer messages. '
  'Tyler edits must never mutate machine_draft_body or writer notebook fields.';

ALTER TABLE sms_daily_draft_generations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE sms_daily_draft_generations FROM anon;
REVOKE ALL ON TABLE sms_daily_draft_generations FROM authenticated;
REVOKE ALL ON TABLE sms_daily_draft_generations FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Table 2: sms_daily_drafts (mutable current send pointer per user/day)
-- ---------------------------------------------------------------------------
CREATE TABLE sms_daily_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  draft_for_day_key TEXT NOT NULL,

  current_generation_id UUID NOT NULL
    REFERENCES sms_daily_draft_generations (id),

  current_body_to_send TEXT NULL,
  current_body_source TEXT NOT NULL DEFAULT 'machine'
    CHECK (current_body_source IN ('machine', 'tyler_edit', 'live_fallback')),

  edited_by_tyler BOOLEAN NOT NULL DEFAULT false,
  edited_at TIMESTAMPTZ NULL,
  edit_distance_chars INTEGER NULL,

  machine_body_hash TEXT NULL,
  current_body_hash TEXT NULL,

  status TEXT NOT NULL DEFAULT 'current'
    CHECK (status IN ('current', 'sent', 'skipped', 'superseded')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  sent_at TIMESTAMPTZ NULL,
  source_sms_send_event_id TEXT NULL,
  twilio_message_sid TEXT NULL,
  final_body_sent TEXT NULL,

  CONSTRAINT sms_daily_drafts_user_day_unique
    UNIQUE (clerk_user_id, draft_for_day_key)
);

CREATE INDEX idx_sms_daily_drafts_current_generation
  ON sms_daily_drafts (current_generation_id);

CREATE INDEX idx_sms_daily_drafts_day_status
  ON sms_daily_drafts (draft_for_day_key, status);

CREATE INDEX idx_sms_daily_drafts_source_send_event
  ON sms_daily_drafts (source_sms_send_event_id)
  WHERE source_sms_send_event_id IS NOT NULL;

COMMENT ON TABLE sms_daily_drafts IS
  'Tyler Text Overview current send draft per user/day. '
  'Tyler edits update current_body_to_send only; machine history lives in sms_daily_draft_generations.';

ALTER TABLE sms_daily_drafts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE sms_daily_drafts FROM anon;
REVOKE ALL ON TABLE sms_daily_drafts FROM authenticated;
REVOKE ALL ON TABLE sms_daily_drafts FROM PUBLIC;
