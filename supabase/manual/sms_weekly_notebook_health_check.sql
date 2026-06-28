-- Weekly / Pat Pause notebook health check (read-only).
-- Run in Supabase SQL Editor after Sunday noon sends.
-- Replace week_key and clerk_user_id filters as needed.

WITH bounds AS (
  SELECT
    date_trunc('week', now() AT TIME ZONE 'America/New_York')::date AS week_start_local
),
weekly_rows AS (
  SELECT
    w.clerk_user_id,
    w.status,
    COALESCE(to_jsonb(w)->>'message_sid', to_jsonb(w)#>>'{metadata,message_sid}', '') AS message_sid,
    COALESCE(to_jsonb(w)#>>'{metadata,weekly_v3_lane_used}', '') AS weekly_v3_lane_used,
    COALESCE(
      to_jsonb(w)#>>'{metadata,weekly_writer_invoked}',
      to_jsonb(w)#>>'{metadata,weekly_lane_metadata,weekly_writer_invoked}',
      to_jsonb(w)#>>'{metadata,relationship_packet_observability,weekly_writer_invoked}',
      ''
    ) AS weekly_writer_invoked,
    COALESCE(
      to_jsonb(w)#>>'{metadata,weekly_memory_packet_used}',
      to_jsonb(w)#>>'{metadata,weekly_lane_metadata,weekly_memory_packet_used}',
      ''
    ) AS weekly_memory_packet_used,
    COALESCE(
      to_jsonb(w)#>>'{metadata,weekly_memory_packet_build_failed}',
      to_jsonb(w)#>>'{metadata,weekly_lane_metadata,weekly_memory_packet_build_failed}',
      ''
    ) AS weekly_memory_packet_build_failed,
    COALESCE(
      to_jsonb(w)#>>'{metadata,weekly_thread_primary_fetch_strategy}',
      to_jsonb(w)#>>'{metadata,weekly_lane_metadata,weekly_thread_primary_fetch_strategy}',
      ''
    ) AS weekly_thread_primary_fetch_strategy,
    COALESCE(
      to_jsonb(w)#>>'{metadata,weekly_thread_primary_fetch_succeeded}',
      to_jsonb(w)#>>'{metadata,weekly_lane_metadata,weekly_thread_primary_fetch_succeeded}',
      ''
    ) AS weekly_thread_primary_fetch_succeeded,
    COALESCE(
      to_jsonb(w)#>>'{metadata,weekly_thread_fetch_error_count}',
      to_jsonb(w)#>>'{metadata,weekly_lane_metadata,weekly_thread_fetch_error_count}',
      ''
    ) AS weekly_thread_fetch_error_count,
    COALESCE(
      to_jsonb(w)#>>'{metadata,weekly_thread_schema_fallback_used}',
      to_jsonb(w)#>>'{metadata,weekly_lane_metadata,weekly_thread_schema_fallback_used}',
      ''
    ) AS weekly_thread_schema_fallback_used,
    COALESCE(
      to_jsonb(w)#>>'{metadata,weekly_thread_source_candidate_count}',
      to_jsonb(w)#>>'{metadata,weekly_lane_metadata,weekly_thread_source_candidate_count}',
      ''
    ) AS weekly_thread_source_candidate_count,
    COALESCE(
      to_jsonb(w)#>>'{metadata,weekly_thread_visible_send_candidate_count}',
      to_jsonb(w)#>>'{metadata,weekly_lane_metadata,weekly_thread_visible_send_candidate_count}',
      ''
    ) AS weekly_thread_visible_send_candidate_count,
    COALESCE(
      to_jsonb(w)#>>'{metadata,weekly_thread_message_count}',
      to_jsonb(w)#>>'{metadata,relationship_packet_observability,included_thread_message_count}',
      to_jsonb(w)#>>'{metadata,weekly_lane_metadata,weekly_thread_message_count}',
      ''
    ) AS weekly_thread_message_count,
    COALESCE(
      to_jsonb(w)#>>'{metadata,weekly_thread_fallback_used}',
      to_jsonb(w)#>>'{metadata,weekly_lane_metadata,weekly_thread_fallback_used}',
      ''
    ) AS weekly_thread_fallback_used,
    COALESCE(
      to_jsonb(w)#>>'{metadata,weekly_thread_recovered_source_rows}',
      to_jsonb(w)#>>'{metadata,weekly_lane_metadata,weekly_thread_recovered_source_rows}',
      ''
    ) AS weekly_thread_recovered_source_rows,
    COALESCE(
      to_jsonb(w)#>>'{metadata,weekly_thread_message_source_breakdown}',
      to_jsonb(w)#>>'{metadata,weekly_lane_metadata,weekly_thread_message_source_breakdown}',
      ''
    ) AS weekly_thread_message_source_breakdown,
    COALESCE(
      to_jsonb(w)#>>'{metadata,weekly_thread_exact_source_message_count}',
      to_jsonb(w)#>>'{metadata,weekly_lane_metadata,weekly_thread_exact_source_message_count}',
      ''
    ) AS weekly_thread_exact_source_message_count,
    COALESCE(
      to_jsonb(w)#>>'{metadata,weekly_thread_legacy_transcript_message_count}',
      to_jsonb(w)#>>'{metadata,weekly_lane_metadata,weekly_thread_legacy_transcript_message_count}',
      ''
    ) AS weekly_thread_legacy_transcript_message_count,
    COALESCE(
      to_jsonb(w)#>>'{metadata,weekly_thread_last_outbound_fallback_message_count}',
      to_jsonb(w)#>>'{metadata,weekly_lane_metadata,weekly_thread_last_outbound_fallback_message_count}',
      ''
    ) AS weekly_thread_last_outbound_fallback_message_count,
    COALESCE(
      to_jsonb(w)#>>'{metadata,weekly_thread_legacy_transcript_fallback_used}',
      to_jsonb(w)#>>'{metadata,weekly_lane_metadata,weekly_thread_legacy_transcript_fallback_used}',
      ''
    ) AS weekly_thread_legacy_transcript_fallback_used,
    COALESCE(
      to_jsonb(w)#>>'{metadata,weekly_thread_correct_notebook_verified}',
      to_jsonb(w)#>>'{metadata,weekly_lane_metadata,weekly_thread_correct_notebook_verified}',
      ''
    ) AS weekly_thread_correct_notebook_verified,
    COALESCE(
      to_jsonb(w)#>>'{metadata,weekly_thread_notebook_failure_reason}',
      to_jsonb(w)#>>'{metadata,weekly_lane_metadata,weekly_thread_notebook_failure_reason}',
      ''
    ) AS weekly_thread_notebook_failure_reason,
    COALESCE(
      to_jsonb(w)#>>'{metadata,weekly_thread_filtered_out_count}',
      to_jsonb(w)#>>'{metadata,weekly_lane_metadata,weekly_thread_filtered_out_count}',
      ''
    ) AS weekly_thread_filtered_out_count,
    COALESCE(
      to_jsonb(w)#>>'{metadata,weekly_thread_filtered_out_reason_top}',
      to_jsonb(w)#>>'{metadata,weekly_lane_metadata,weekly_thread_filtered_out_reason_top}',
      ''
    ) AS weekly_thread_filtered_out_reason_top,
    COALESCE(
      to_jsonb(w)#>>'{metadata,weekly_thread_source_tables_present}',
      to_jsonb(w)#>>'{metadata,weekly_lane_metadata,weekly_thread_source_tables_present}',
      ''
    ) AS weekly_thread_source_tables_present,
    COALESCE(
      to_jsonb(w)#>>'{metadata,relationship_packet_observability,included_thread_message_count}',
      to_jsonb(w)#>>'{metadata,weekly_lane_metadata,included_thread_message_count}',
      ''
    ) AS included_thread_message_count,
    LEFT(
      COALESCE(
        NULLIF(BTRIM(to_jsonb(w)->>'body'), ''),
        NULLIF(BTRIM(to_jsonb(w)->>'sms_body'), ''),
        NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,sms_body}'), ''),
        NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,north_star_gate,final_body}'), ''),
        NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,v3_candidate_body}'), ''),
        ''
      ),
      300
    ) AS body_preview
  FROM sms_weekly_send_events w
  CROSS JOIN bounds b
  WHERE w.week_key >= to_char(b.week_start_local, 'IYYY-"W"IW')
),
diagnosed AS (
  SELECT
    *,
    CASE
      WHEN weekly_thread_correct_notebook_verified ~* 'true' THEN 'correct_notebook_verified'
      WHEN NULLIF(BTRIM(weekly_thread_notebook_failure_reason), '') NOT IN ('', 'none')
        THEN weekly_thread_notebook_failure_reason
      WHEN weekly_memory_packet_build_failed ~* 'true' THEN 'memory_packet_build_failed'
      WHEN weekly_memory_packet_used ~* 'false' THEN 'memory_packet_not_used'
      WHEN NULLIF(weekly_thread_fetch_error_count, '')::int > 0 THEN 'fetch_error'
      WHEN weekly_thread_schema_fallback_used ~* 'true' THEN 'schema_fallback_used'
      WHEN weekly_thread_source_candidate_count = '0'
        AND NULLIF(weekly_thread_message_count, '')::int > 0
      THEN 'message_count_without_source_candidates'
      WHEN weekly_thread_source_candidate_count = '0' THEN 'no_source_candidates'
      WHEN weekly_thread_legacy_transcript_fallback_used ~* 'true' THEN 'legacy_transcript_fallback_used'
      WHEN weekly_thread_fallback_used ~* 'true' THEN 'last_outbound_or_packet_fallback_used'
      WHEN NULLIF(weekly_thread_source_candidate_count, '')::int > 0
        AND COALESCE(NULLIF(weekly_thread_exact_source_message_count, '')::int, 0) = 0
      THEN 'source_candidates_no_exact_messages'
      WHEN COALESCE(NULLIF(weekly_thread_exact_source_message_count, '')::int, 0) > 0
        AND COALESCE(NULLIF(weekly_thread_message_count, '')::int, 0) <= 1
      THEN 'exact_thread_too_thin'
      WHEN weekly_thread_primary_fetch_succeeded = ''
        AND weekly_thread_notebook_failure_reason = ''
      THEN 'telemetry_missing'
      ELSE 'unclassified_notebook_failure'
    END AS weekly_notebook_health
  FROM weekly_rows
)
SELECT *
FROM diagnosed
ORDER BY clerk_user_id;

-- Pass (known-history users with verified correct notebook):
--   weekly_thread_correct_notebook_verified ~* 'true'
--   weekly_notebook_health = 'correct_notebook_verified'
--
-- Fail (known-history users): weekly_notebook_health must always be a named reason.
--
-- P1 telemetry bug (not a normal failure state):
--   weekly_notebook_health = 'unclassified_notebook_failure'
--   Investigate missing weekly_thread_notebook_failure_reason on new sends.
