-- Phase 1: send_slot foundation for future two-moment SMS (morning + evening_checkin).
-- send_slot is outbound moment/purpose, NOT exact wall-clock send time.
-- Phase 1 production uses send_slot = 'morning' only; evening_checkin is reserved for future.
-- Future per-slot local schedules (e.g. morning 5–10 AM, evening_checkin 5–10 PM) are expected.

-- ---------------------------------------------------------------------------
-- sms_daily_draft_generations
-- ---------------------------------------------------------------------------
ALTER TABLE sms_daily_draft_generations
  ADD COLUMN send_slot TEXT NOT NULL DEFAULT 'morning';

ALTER TABLE sms_daily_draft_generations
  ADD CONSTRAINT sms_daily_draft_generations_send_slot_check
  CHECK (send_slot IN ('morning', 'evening_checkin'));

ALTER TABLE sms_daily_draft_generations
  DROP CONSTRAINT IF EXISTS sms_daily_draft_generations_user_day_gen_unique;

ALTER TABLE sms_daily_draft_generations
  ADD CONSTRAINT sms_daily_draft_generations_user_day_slot_gen_unique
  UNIQUE (clerk_user_id, draft_for_day_key, send_slot, generation_number);

DROP INDEX IF EXISTS idx_sms_daily_draft_generations_user_day_generated;

CREATE INDEX idx_sms_daily_draft_generations_user_day_slot_generated
  ON sms_daily_draft_generations (clerk_user_id, draft_for_day_key, send_slot, generated_at DESC);

COMMENT ON COLUMN sms_daily_draft_generations.send_slot IS
  'Outbound moment/purpose slot (morning = planning/accountability; evening_checkin = future truth check-in). '
  'Not wall-clock time — legacy smsTimePreference still controls send hour in Phase 1.';

-- ---------------------------------------------------------------------------
-- sms_daily_drafts
-- ---------------------------------------------------------------------------
ALTER TABLE sms_daily_drafts
  ADD COLUMN send_slot TEXT NOT NULL DEFAULT 'morning';

ALTER TABLE sms_daily_drafts
  ADD CONSTRAINT sms_daily_drafts_send_slot_check
  CHECK (send_slot IN ('morning', 'evening_checkin'));

ALTER TABLE sms_daily_drafts
  DROP CONSTRAINT IF EXISTS sms_daily_drafts_user_day_unique;

ALTER TABLE sms_daily_drafts
  ADD CONSTRAINT sms_daily_drafts_user_day_slot_unique
  UNIQUE (clerk_user_id, draft_for_day_key, send_slot);

DROP INDEX IF EXISTS idx_sms_daily_drafts_day_status;

CREATE INDEX idx_sms_daily_drafts_day_slot_status
  ON sms_daily_drafts (draft_for_day_key, send_slot, status);

COMMENT ON COLUMN sms_daily_drafts.send_slot IS
  'Outbound moment/purpose slot for the current send draft pointer. Phase 1: morning only.';

-- ---------------------------------------------------------------------------
-- sms_send_events (legacy table; unique index name confirmed in production)
-- ---------------------------------------------------------------------------
ALTER TABLE sms_send_events
  ADD COLUMN send_slot TEXT NOT NULL DEFAULT 'morning';

ALTER TABLE sms_send_events
  ADD CONSTRAINT sms_send_events_send_slot_check
  CHECK (send_slot IN ('morning', 'evening_checkin'));

DROP INDEX IF EXISTS sms_send_events_unique_user_day;

ALTER TABLE sms_send_events
  DROP CONSTRAINT IF EXISTS sms_send_events_clerk_user_id_day_key_key;

ALTER TABLE sms_send_events
  DROP CONSTRAINT IF EXISTS sms_send_events_user_day_unique;

DROP INDEX IF EXISTS sms_send_events_clerk_user_id_day_key_key;

DROP INDEX IF EXISTS sms_send_events_user_day_unique;

CREATE UNIQUE INDEX sms_send_events_user_day_slot_unique
  ON sms_send_events (clerk_user_id, day_key, send_slot);

COMMENT ON COLUMN sms_send_events.send_slot IS
  'Outbound moment/purpose slot for reservation/send dedupe. Phase 1: morning only. '
  'One row per (user, day, slot); future evening_checkin enables second daily SMS.';
