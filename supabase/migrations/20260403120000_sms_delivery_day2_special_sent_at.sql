-- One-time guard for the program Day 2 freeform SMS special (Layer B).
-- NULL = never sent; set to timestamptz after the special is successfully delivered.

ALTER TABLE sms_delivery_state
  ADD COLUMN IF NOT EXISTS day2_special_sent_at TIMESTAMPTZ NULL;
