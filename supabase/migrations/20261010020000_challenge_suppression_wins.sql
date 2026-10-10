-- Send-result bookkeeping must not clear an unsubscribe.
-- Re-enrollment is the only update that may set suppressed_at back to null,
-- and it does not call this function.
--
-- Rollback is manual. Do not automate it.
-- 1. Pause the challenge cron before deploying an older application.
-- 2. Wait until every send_claim_until is in the past (the claim lasts 5 minutes).
-- 3. Do not clear suppressed_at. Never run an update that sets it back to null.
-- 4. The old cron ignores idempotency keys and selects next_send_at <= now.
--    Before that cron runs, set next_send_at and next_retry_at to null on rows
--    whose current lesson is still uncertain:
--    attempt_idempotency_key IS NOT NULL OR send_state IN ('claimed', 'unknown').
--    Leave accepted lessons that are already scheduled for a later day alone.
-- 5. Prefer a forward fix when the old application cannot honor the new state.

CREATE OR REPLACE FUNCTION public.apply_challenge_send_bookkeeping(
  p_id text,
  p_expected_day integer,
  p_expected_attempt_count integer,
  p_expected_claim_token text,
  p_patch jsonb
)
RETURNS SETOF public.challenge_participants
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Column references on the right-hand side are the pre-update row.
  -- A suppression that committed after the application read still wins.
  RETURN QUERY
  UPDATE public.challenge_participants AS c
  SET
    challenge_day = COALESCE((p_patch->>'challenge_day')::integer, c.challenge_day),
    completed = COALESCE((p_patch->>'completed')::boolean, c.completed),
    suppressed_at = COALESCE(c.suppressed_at, (p_patch->>'suppressed_at')::timestamptz),
    next_send_at = CASE
      WHEN c.suppressed_at IS NOT NULL OR NULLIF(p_patch->>'suppressed_at', '') IS NOT NULL THEN NULL
      ELSE (p_patch->>'next_send_at')::timestamptz
    END,
    next_retry_at = CASE
      WHEN c.suppressed_at IS NOT NULL OR NULLIF(p_patch->>'suppressed_at', '') IS NOT NULL THEN NULL
      ELSE (p_patch->>'next_retry_at')::timestamptz
    END,
    send_state = CASE
      WHEN c.suppressed_at IS NOT NULL OR NULLIF(p_patch->>'suppressed_at', '') IS NOT NULL THEN 'suppressed'
      ELSE COALESCE(NULLIF(p_patch->>'send_state', ''), c.send_state)
    END,
    send_attention = NULLIF(p_patch->>'send_attention', ''),
    attempt_idempotency_key = NULLIF(p_patch->>'attempt_idempotency_key', ''),
    attempt_key_created_at = (p_patch->>'attempt_key_created_at')::timestamptz,
    attempt_count = COALESCE((p_patch->>'attempt_count')::integer, c.attempt_count),
    last_send_error = NULLIF(left(p_patch->>'last_send_error', 500), ''),
    last_send_attempt_at = (p_patch->>'last_send_attempt_at')::timestamptz,
    last_sent_at = COALESCE((p_patch->>'last_sent_at')::timestamptz, c.last_sent_at),
    last_accepted_day = COALESCE((p_patch->>'last_accepted_day')::integer, c.last_accepted_day),
    last_provider_message_id = COALESCE(NULLIF(p_patch->>'last_provider_message_id', ''), c.last_provider_message_id),
    last_accepted_at = COALESCE((p_patch->>'last_accepted_at')::timestamptz, c.last_accepted_at),
    send_claim_token = NULLIF(p_patch->>'send_claim_token', ''),
    send_claim_until = (p_patch->>'send_claim_until')::timestamptz,
    unsubscribe_token = COALESCE(NULLIF(p_patch->>'unsubscribe_token', ''), c.unsubscribe_token),
    reliable_send_tracking = COALESCE((p_patch->>'reliable_send_tracking')::boolean, c.reliable_send_tracking),
    send_tracking_cutover_at = COALESCE((p_patch->>'send_tracking_cutover_at')::timestamptz, c.send_tracking_cutover_at),
    reenrolled_at = COALESCE((p_patch->>'reenrolled_at')::timestamptz, c.reenrolled_at)
  WHERE c.id::text = p_id
    AND c.challenge_day = p_expected_day
    AND c.attempt_count = p_expected_attempt_count
    AND c.send_claim_token IS NOT DISTINCT FROM p_expected_claim_token
  RETURNING *;
END;
$$;

COMMENT ON FUNCTION public.apply_challenge_send_bookkeeping(text, integer, integer, text, jsonb) IS
  'Writes one challenge send result. An existing suppressed_at is never cleared. Re-enrollment is a separate update.';

REVOKE ALL ON FUNCTION public.apply_challenge_send_bookkeeping(text, integer, integer, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_challenge_send_bookkeeping(text, integer, integer, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.apply_challenge_send_bookkeeping(text, integer, integer, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_challenge_send_bookkeeping(text, integer, integer, text, jsonb) TO service_role;
