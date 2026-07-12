-- Add weekly_review send_slot for Weekly TTO drafts/generations.
-- send_slot remains outbound moment/purpose, NOT wall-clock send time.
-- Weekly send still uses sms_weekly_send_events after a later cutover; this migration
-- does NOT expand sms_send_events (weekly v1 does not use that table).

ALTER TABLE sms_daily_draft_generations
  DROP CONSTRAINT IF EXISTS sms_daily_draft_generations_send_slot_check;

ALTER TABLE sms_daily_draft_generations
  ADD CONSTRAINT sms_daily_draft_generations_send_slot_check
  CHECK (send_slot IN ('morning', 'evening_checkin', 'weekly_review'));

ALTER TABLE sms_daily_drafts
  DROP CONSTRAINT IF EXISTS sms_daily_drafts_send_slot_check;

ALTER TABLE sms_daily_drafts
  ADD CONSTRAINT sms_daily_drafts_send_slot_check
  CHECK (send_slot IN ('morning', 'evening_checkin', 'weekly_review'));

COMMENT ON COLUMN sms_daily_draft_generations.send_slot IS
  'Outbound moment/purpose slot (morning = planning/accountability; evening_checkin = truth check-in; weekly_review = Weekly TTO draft). '
  'Not wall-clock send time.';

COMMENT ON COLUMN sms_daily_drafts.send_slot IS
  'Outbound moment/purpose slot (morning = planning/accountability; evening_checkin = truth check-in; weekly_review = Weekly TTO draft). '
  'Not wall-clock send time.';
