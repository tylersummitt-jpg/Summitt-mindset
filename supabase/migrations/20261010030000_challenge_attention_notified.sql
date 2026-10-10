-- Null means a terminal challenge attention state still needs its internal alert.
-- The send-result function does not write this column, so bookkeeping cannot clear it.
-- Set it only after the alert is accepted.

ALTER TABLE public.challenge_participants
  ADD COLUMN IF NOT EXISTS attention_notified_at timestamptz;

COMMENT ON COLUMN public.challenge_participants.attention_notified_at IS
  'Set after the internal attention alert is accepted. Null means the next challenge cron should retry the alert.';
