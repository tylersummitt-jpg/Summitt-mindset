-- Daily bucket + silent-cycle counter for Daily → Flex transition (state only; flex send mix unchanged).

ALTER TABLE sms_delivery_state
  ADD COLUMN IF NOT EXISTS daily_nonresponse_cycle_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sms_delivery_state
  ADD COLUMN IF NOT EXISTS sms_bucket TEXT NOT NULL DEFAULT 'daily';

ALTER TABLE sms_delivery_state
  DROP CONSTRAINT IF EXISTS sms_delivery_state_sms_bucket_chk;

ALTER TABLE sms_delivery_state
  ADD CONSTRAINT sms_delivery_state_sms_bucket_chk
  CHECK (sms_bucket IN ('daily', 'flex'));
