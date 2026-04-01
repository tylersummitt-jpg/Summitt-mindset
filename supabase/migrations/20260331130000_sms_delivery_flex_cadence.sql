-- Rolling 7-slot cadence for Flex SMS (indexes 0–6; pattern defined in application code).

ALTER TABLE sms_delivery_state
  ADD COLUMN IF NOT EXISTS flex_cadence_index INTEGER NOT NULL DEFAULT 0;
