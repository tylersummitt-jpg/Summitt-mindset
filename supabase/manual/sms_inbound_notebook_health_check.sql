-- Inbound reply notebook health check (read-only).
-- Run in Supabase SQL Editor on recent inbound coach replies.
-- Joins sms_memory_signal turn telemetry (inbound_turn_telemetry) with coach jobs.

WITH bounds AS (
  SELECT
    (now() AT TIME ZONE 'America/New_York')::date - 7 AS day_start_local,
    (now() AT TIME ZONE 'America/New_York')::date + 1 AS day_end_local
),
telemetry_rows AS (
  SELECT
    ev.clerk_user_id,
    ev.payload_json->>'message_sid' AS message_sid,
    ev.payload_json AS telemetry_json,
    ev.occurred_at
  FROM v2_commitment_event ev
  CROSS JOIN bounds b
  WHERE ev.event_type = 'sms_memory_signal'
    AND ev.source = 'sms_inbound_coach'
    AND (ev.payload_json->>'inbound_turn_telemetry')::boolean IS TRUE
    AND ev.occurred_at >= b.day_start_local
    AND ev.occurred_at < b.day_end_local
),
inbound_rows AS (
  SELECT
    j.clerk_user_id,
    j.message_sid,
    j.status,
    LEFT(COALESCE(NULLIF(BTRIM(j.reply_body), ''), ''), 300) AS reply_body_preview,
    COALESCE(t.telemetry_json->>'inbound_thread_correct_notebook_verified', '') AS inbound_thread_correct_notebook_verified,
    COALESCE(t.telemetry_json->>'inbound_thread_notebook_failure_reason', '') AS inbound_thread_notebook_failure_reason,
    COALESCE(t.telemetry_json->>'inbound_context_packet_used', '') AS inbound_context_packet_used,
    COALESCE(t.telemetry_json->>'inbound_context_packet_build_failed', '') AS inbound_context_packet_build_failed,
    COALESCE(t.telemetry_json->>'inbound_thread_primary_fetch_succeeded', '') AS inbound_thread_primary_fetch_succeeded,
    COALESCE(t.telemetry_json->>'inbound_thread_fetch_error_count', '') AS inbound_thread_fetch_error_count,
    COALESCE(t.telemetry_json->>'inbound_thread_schema_fallback_used', '') AS inbound_thread_schema_fallback_used,
    COALESCE(t.telemetry_json->>'inbound_thread_source_candidate_count', '') AS inbound_thread_source_candidate_count,
    COALESCE(t.telemetry_json->>'inbound_thread_visible_send_candidate_count', '') AS inbound_thread_visible_send_candidate_count,
    COALESCE(t.telemetry_json->>'inbound_thread_exact_source_message_count', '') AS inbound_thread_exact_source_message_count,
    COALESCE(t.telemetry_json->>'inbound_thread_message_count', '') AS inbound_thread_message_count,
    COALESCE(t.telemetry_json->>'inbound_thread_fallback_used', '') AS inbound_thread_fallback_used,
    COALESCE(t.telemetry_json->>'inbound_thread_message_source_breakdown', '') AS inbound_thread_message_source_breakdown,
    COALESCE(t.telemetry_json->>'inbound_thread_legacy_transcript_fallback_used', '') AS inbound_thread_legacy_transcript_fallback_used,
    t.occurred_at AS telemetry_at
  FROM sms_inbound_coach_jobs j
  CROSS JOIN bounds b
  LEFT JOIN telemetry_rows t ON t.message_sid = j.message_sid
  WHERE j.updated_at >= b.day_start_local
    AND j.updated_at < b.day_end_local
    AND j.status IN ('sent', 'reply_ready', 'sending')
),
diagnosed AS (
  SELECT
    *,
    CASE
      WHEN inbound_thread_correct_notebook_verified ~* 'true' THEN 'correct_notebook_verified'
      WHEN NULLIF(BTRIM(inbound_thread_notebook_failure_reason), '') NOT IN ('', 'none')
        THEN inbound_thread_notebook_failure_reason
      WHEN inbound_context_packet_build_failed ~* 'true' THEN 'context_packet_build_failed'
      WHEN inbound_context_packet_used ~* 'false' THEN 'context_packet_not_used'
      WHEN NULLIF(inbound_thread_fetch_error_count, '')::int > 0 THEN 'fetch_error'
      WHEN inbound_thread_schema_fallback_used ~* 'true' THEN 'schema_fallback_used'
      WHEN inbound_thread_source_candidate_count = '0'
        AND NULLIF(inbound_thread_message_count, '')::int > 0
      THEN 'message_count_without_source_candidates'
      WHEN inbound_thread_source_candidate_count = '0' THEN 'no_source_candidates'
      WHEN inbound_thread_legacy_transcript_fallback_used ~* 'true' THEN 'legacy_transcript_fallback_used'
      WHEN inbound_thread_fallback_used ~* 'true' THEN 'last_outbound_or_packet_fallback_used'
      WHEN NULLIF(inbound_thread_source_candidate_count, '')::int > 0
        AND COALESCE(NULLIF(inbound_thread_exact_source_message_count, '')::int, 0) = 0
      THEN 'source_candidates_no_exact_messages'
      WHEN COALESCE(NULLIF(inbound_thread_exact_source_message_count, '')::int, 0) > 0
        AND COALESCE(NULLIF(inbound_thread_message_count, '')::int, 0) <= 1
      THEN 'exact_thread_too_thin'
      WHEN inbound_thread_primary_fetch_succeeded = ''
        AND inbound_thread_notebook_failure_reason = ''
      THEN 'telemetry_missing'
      ELSE 'unclassified_notebook_failure'
    END AS inbound_notebook_health
  FROM inbound_rows
)
SELECT *
FROM diagnosed
ORDER BY clerk_user_id, telemetry_at DESC NULLS LAST;

-- Pass (known-history users with verified correct notebook):
--   inbound_thread_correct_notebook_verified ~* 'true'
--   inbound_notebook_health = 'correct_notebook_verified'
--
-- Fail: inbound_notebook_health must be a named reason (not needs_review).
--
-- P1 telemetry bug (not a normal failure state):
--   inbound_notebook_health = 'unclassified_notebook_failure'
