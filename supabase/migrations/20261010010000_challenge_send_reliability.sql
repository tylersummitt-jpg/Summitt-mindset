-- Challenge send reliability and unsubscribe.
-- Additive only. Does not update, delete, or restart existing participant rows.
-- Does not backfill provider message ids or treat earlier lessons as delivered.
--
-- reliable_send_tracking defaults to false. Existing rows stay false, so a
-- historical Day 1 row is not auto-retried (the original outcome is unknown).
-- New enrollments set the flag and send_tracking_cutover_at in application code.
-- send_state default 'legacy' means "not provider-confirmed," not "delivered."

ALTER TABLE public.challenge_participants
  ADD COLUMN IF NOT EXISTS suppressed_at timestamptz NULL;

ALTER TABLE public.challenge_participants
  ADD COLUMN IF NOT EXISTS unsubscribe_token text NULL;

ALTER TABLE public.challenge_participants
  ADD COLUMN IF NOT EXISTS reliable_send_tracking boolean NOT NULL DEFAULT false;

ALTER TABLE public.challenge_participants
  ADD COLUMN IF NOT EXISTS send_tracking_cutover_at timestamptz NULL;

ALTER TABLE public.challenge_participants
  ADD COLUMN IF NOT EXISTS send_state text NOT NULL DEFAULT 'legacy';

ALTER TABLE public.challenge_participants
  ADD COLUMN IF NOT EXISTS send_attention text NULL;

ALTER TABLE public.challenge_participants
  ADD COLUMN IF NOT EXISTS attempt_idempotency_key text NULL;

ALTER TABLE public.challenge_participants
  ADD COLUMN IF NOT EXISTS attempt_key_created_at timestamptz NULL;

ALTER TABLE public.challenge_participants
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.challenge_participants
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz NULL;

ALTER TABLE public.challenge_participants
  ADD COLUMN IF NOT EXISTS last_send_error text NULL;

ALTER TABLE public.challenge_participants
  ADD COLUMN IF NOT EXISTS last_send_attempt_at timestamptz NULL;

ALTER TABLE public.challenge_participants
  ADD COLUMN IF NOT EXISTS last_accepted_day integer NULL;

ALTER TABLE public.challenge_participants
  ADD COLUMN IF NOT EXISTS last_provider_message_id text NULL;

ALTER TABLE public.challenge_participants
  ADD COLUMN IF NOT EXISTS last_accepted_at timestamptz NULL;

ALTER TABLE public.challenge_participants
  ADD COLUMN IF NOT EXISTS send_claim_token text NULL;

ALTER TABLE public.challenge_participants
  ADD COLUMN IF NOT EXISTS send_claim_until timestamptz NULL;

ALTER TABLE public.challenge_participants
  ADD COLUMN IF NOT EXISTS reenrolled_at timestamptz NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'challenge_participants_send_state_chk'
  ) THEN
    ALTER TABLE public.challenge_participants
      ADD CONSTRAINT challenge_participants_send_state_chk
      CHECK (
        send_state IN (
          'legacy',
          'pending',
          'claimed',
          'accepted',
          'provider_rejected',
          'temporary_failure',
          'permanent_failure',
          'unknown',
          'suppressed'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'challenge_participants_send_attention_chk'
  ) THEN
    ALTER TABLE public.challenge_participants
      ADD CONSTRAINT challenge_participants_send_attention_chk
      CHECK (
        send_attention IS NULL
        OR send_attention IN (
          'provider_rejected',
          'permanent_failure',
          'unknown_expired',
          'retry_exhausted',
          'idempotency_conflict',
          'sequence_inconsistent'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'challenge_participants_attempt_count_chk'
  ) THEN
    ALTER TABLE public.challenge_participants
      ADD CONSTRAINT challenge_participants_attempt_count_chk
      CHECK (attempt_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'challenge_participants_last_accepted_day_chk'
  ) THEN
    ALTER TABLE public.challenge_participants
      ADD CONSTRAINT challenge_participants_last_accepted_day_chk
      CHECK (last_accepted_day IS NULL OR (last_accepted_day >= 1 AND last_accepted_day <= 7));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS challenge_participants_unsubscribe_token_uidx
  ON public.challenge_participants (unsubscribe_token)
  WHERE unsubscribe_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS challenge_participants_due_send_idx
  ON public.challenge_participants (next_send_at)
  WHERE completed = false AND suppressed_at IS NULL AND send_attention IS NULL;

COMMENT ON COLUMN public.challenge_participants.reliable_send_tracking IS
  'True only for enrollments created after challenge send tracking. Default false. Not a delivery confirmation.';

COMMENT ON COLUMN public.challenge_participants.send_tracking_cutover_at IS
  'Set on new enrollments to the tracking cutover instant. NULL on preexisting rows. Not backfilled.';

COMMENT ON COLUMN public.challenge_participants.last_provider_message_id IS
  'Resend message id for the last lesson this process confirmed accepted. Not inbox delivery. Not backfilled.';

COMMENT ON COLUMN public.challenge_participants.attempt_idempotency_key IS
  'Resend Idempotency-Key for the in-flight lesson. Reused when the outcome is unknown. Cleared after a known rejection or acceptance.';

-- Case-insensitive exact lookup. Does not insert or update.
CREATE OR REPLACE FUNCTION public.find_challenge_participants_by_email(p_email text)
RETURNS SETOF public.challenge_participants
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT *
  FROM public.challenge_participants
  WHERE lower(btrim(email)) = lower(btrim(p_email))
  ORDER BY started_at ASC NULLS LAST
  LIMIT 5;
$$;

REVOKE ALL ON FUNCTION public.find_challenge_participants_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_challenge_participants_by_email(text) FROM anon;
REVOKE ALL ON FUNCTION public.find_challenge_participants_by_email(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.find_challenge_participants_by_email(text) TO service_role;
