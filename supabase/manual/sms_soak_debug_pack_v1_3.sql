-- =============================================================================
-- SMS SOAK DEBUG PACK v1.3 (read-only)
-- =============================================================================
-- CHANGE THESE DATES BEFORE RUNNING A NEW SOAK.
--
-- Post-deploy default window (Queries 2–16):
--   2026-06-17 00:00 ET → 2026-06-20 00:00 ET (exclusive end)
-- Query 1 weekly timeline uses wider window (see Query 1 bounds).
--
-- Run each query ONE AT A TIME in Supabase SQL editor. SELECT-only.
-- Export CSVs per query comment. If no rows: note "Query X: no rows."
--
-- v1.3 improvements over user 15-query pack + v1.2:
--   - Expanded daily body coalesce (daily_v3_lane, v3_brain, body_preview, final_body)
--   - accepted/sending/message_sid/note='sent_to_twilio' visible classification
--   - Explicit eligible_coaching_row denominator (excludes legitimate skips)
--   - Slice 1 telemetry: daily_zero_question_mode_active, high_repeat_risk, etc.
--   - Slice 2 telemetry: memory_repeat_repair_skipped_*, repeat_repair_attempted
--   - Query 16 post-deploy scorecard with decision columns
--
-- Guide: src/sms-review-place/SMS_SOAK_DEBUG_SQL_GUIDE.md
-- Prior pack preserved: supabase/manual/sms_soak_debug_pack.sql (v1.2)
-- =============================================================================


-- =============================================================================
-- QUERY 1 — weekly_thread_timeline_all_users
-- Purpose: See actual user/coach threads across daily, weekly, inbound, coach replies.
-- Export as Q1_weekly_thread_timeline_all_users.csv
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-10 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end
),
inbound_messages AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz
    ) AS event_at,
    'user_inbound'::text AS event_source,
    COALESCE(to_jsonb(m)->>'clerk_user_id', to_jsonb(m)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(m)->>'message_sid', to_jsonb(m)#>>'{metadata,message_sid}') AS message_sid,
    LEFT(COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''),
      NULLIF(BTRIM(to_jsonb(m)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(m)->>'message_body'), ''),
      NULLIF(BTRIM(to_jsonb(m)#>>'{metadata,raw_body}'), ''),
      ''
    ), 1200) AS body_preview,
    NULL::text AS status,
    NULL::text AS route_kind,
    NULL::text AS daily_zero_question_mode_active,
    NULL::text AS memory_repeat_repair_skipped_zero_question_mode,
    NULL::text AS no_send_reason,
    to_jsonb(m) AS raw_json
  FROM sms_inbound_messages m
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz
    ) < b.window_end
),
inbound_replies AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) AS event_at,
    'coach_inbound_reply'::text AS event_source,
    COALESCE(to_jsonb(j)->>'clerk_user_id', to_jsonb(j)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(j)->>'outbound_message_sid', to_jsonb(j)->>'message_sid') AS message_sid,
    LEFT(COALESCE(
      NULLIF(BTRIM(to_jsonb(j)->>'reply_body'), ''),
      NULLIF(BTRIM(to_jsonb(j)#>>'{metadata,reply_body}'), ''),
      ''
    ), 1200) AS body_preview,
    to_jsonb(j)->>'status' AS status,
    COALESCE(to_jsonb(j)#>>'{metadata,route_purpose}', to_jsonb(j)#>>'{metadata,branch_name}', '') AS route_kind,
    NULL::text AS daily_zero_question_mode_active,
    NULL::text AS memory_repeat_repair_skipped_zero_question_mode,
    COALESCE(to_jsonb(j)->>'no_send_reason', to_jsonb(j)#>>'{metadata,no_send_reason}', to_jsonb(j)->>'last_error', '') AS no_send_reason,
    to_jsonb(j) AS raw_json
  FROM sms_inbound_coach_jobs j
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
daily_outbound AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) AS event_at,
    'coach_daily_outbound'::text AS event_source,
    COALESCE(to_jsonb(s)->>'clerk_user_id', to_jsonb(s)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(s)->>'message_sid', to_jsonb(s)->>'outbound_message_sid', to_jsonb(s)#>>'{metadata,message_sid}') AS message_sid,
    LEFT(COALESCE(
      NULLIF(BTRIM(to_jsonb(s)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,north_star_visible_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_voice_gate,final_voice_gate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,body}'), ''),
      ''
    ), 1200) AS body_preview,
    COALESCE(to_jsonb(s)->>'status', to_jsonb(s)#>>'{metadata,status}', '') AS status,
    COALESCE(
      to_jsonb(s)#>>'{metadata,route_kind}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,route_kind}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_route_kind}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_daily_conversation_intent}',
      ''
    ) AS route_kind,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,v3_brain,daily_zero_question_mode_active}',
      ''
    ) AS daily_zero_question_mode_active,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_repair_skipped_zero_question_mode}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_repair_skipped_zero_question_mode}',
      ''
    ) AS memory_repeat_repair_skipped_zero_question_mode,
    COALESCE(
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      to_jsonb(s)#>>'{metadata,skip_source}',
      ''
    ) AS no_send_reason,
    to_jsonb(s) AS raw_json
  FROM sms_send_events s
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
weekly_outbound AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) AS event_at,
    'coach_weekly_outbound'::text AS event_source,
    COALESCE(to_jsonb(w)->>'clerk_user_id', to_jsonb(w)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(w)->>'message_sid', to_jsonb(w)->>'outbound_message_sid', to_jsonb(w)#>>'{metadata,message_sid}') AS message_sid,
    LEFT(COALESCE(
      NULLIF(BTRIM(to_jsonb(w)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,body_preview}'), ''),
      ''
    ), 1200) AS body_preview,
    COALESCE(to_jsonb(w)->>'status', to_jsonb(w)#>>'{metadata,status}', '') AS status,
    'weekly'::text AS route_kind,
    NULL::text AS daily_zero_question_mode_active,
    NULL::text AS memory_repeat_repair_skipped_zero_question_mode,
    COALESCE(to_jsonb(w)->>'no_send_reason', to_jsonb(w)#>>'{metadata,no_send_reason}', '') AS no_send_reason,
    to_jsonb(w) AS raw_json
  FROM sms_weekly_send_events w
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
thread_events AS (
  SELECT * FROM inbound_messages
  UNION ALL SELECT * FROM inbound_replies
  UNION ALL SELECT * FROM daily_outbound
  UNION ALL SELECT * FROM weekly_outbound
)
SELECT
  (event_at AT TIME ZONE 'America/New_York')::date AS local_day,
  event_at,
  clerk_user_id,
  event_source,
  status,
  route_kind,
  daily_zero_question_mode_active,
  memory_repeat_repair_skipped_zero_question_mode,
  no_send_reason,
  message_sid,
  body_preview,
  raw_json
FROM thread_events
WHERE event_at IS NOT NULL
ORDER BY clerk_user_id, event_at;


-- =============================================================================
-- QUERY 2 — sms_health_rollup
-- Purpose: Daily SMS health, eligible denominator, visible sends, eligible no-sends.
-- Export as Q2_sms_health_rollup.csv
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end
),
send_base AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(s)->>'clerk_user_id', to_jsonb(s)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(s)->>'status', to_jsonb(s)#>>'{metadata,status}', '') AS status,
    COALESCE(to_jsonb(s)->>'message_sid', to_jsonb(s)->>'outbound_message_sid', to_jsonb(s)#>>'{metadata,message_sid}', '') AS message_sid,
    COALESCE(to_jsonb(s)#>>'{metadata,note}', '') AS note,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_daily_conversation_intent}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_conversation_intent}',
      ''
    ) AS daily_conversation_intent,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_move_type}',
      to_jsonb(s)#>>'{metadata,strategy_card_move_type}',
      ''
    ) AS strategy_card_move_type,
    COALESCE(
      to_jsonb(s)#>>'{metadata,route_kind}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,route_kind}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_route_kind}',
      ''
    ) AS route_kind,
    COALESCE(
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      to_jsonb(s)->>'no_send_reason',
      ''
    ) AS no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,skip_source}',
      to_jsonb(s)#>>'{metadata,voice_send_decision,skip_source}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,skip_source}',
      ''
    ) AS skip_source,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_zero_question_required}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,strategy_card_zero_question_required}',
      to_jsonb(s)#>>'{metadata,strategy_card_zero_question_required}',
      ''
    ) AS strategy_card_zero_question_required,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_high_repeat_risk}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,strategy_card_high_repeat_risk}',
      to_jsonb(s)#>>'{metadata,strategy_card_high_repeat_risk}',
      ''
    ) AS strategy_card_high_repeat_risk,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,v3_brain,daily_zero_question_mode_active}',
      ''
    ) AS daily_zero_question_mode_active,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_repair_skipped_zero_question_mode}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_repair_skipped_zero_question_mode}',
      ''
    ) AS memory_repeat_repair_skipped_zero_question_mode,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,north_star_visible_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_voice_gate,final_voice_gate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,body}'), ''),
      ''
    ) AS body_preview,
    to_jsonb(s) AS raw_json
  FROM sms_send_events s
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
classified AS (
  SELECT
    *,
    CASE
      WHEN no_send_reason ~* '(not.*v2|not_fully_on_v2|no_active_commitment|stopped|unsubscribed|duplicate|tapback|compliance|safety|crisis|invalid_phone|outside_send_window|skipped_not_time|skipped_active_inbound_thread)'
        OR skip_source ~* '(not.*v2|not_fully_on_v2|no_active_commitment|duplicate|tapback|compliance|safety|crisis|active_inbound_thread|outside_send_window)'
      THEN false
      ELSE true
    END AS eligible_coaching_row,
    CASE
      WHEN body_preview <> ''
       AND (
         status ~* '(sent|delivered|queued|success|accepted|sending)'
         OR message_sid <> ''
         OR note = 'sent_to_twilio'
       )
       AND no_send_reason = ''
       AND skip_source = ''
      THEN true
      WHEN body_preview <> ''
       AND (
         status ~* '(sent|delivered|queued|success|accepted|sending)'
         OR message_sid <> ''
         OR note = 'sent_to_twilio'
       )
       AND no_send_reason !~* '(blocked|no_send|stale|memory|freshness|missing|required|compliance|safety|duplicate|tapback|not_fully_on_v2|no_active_commitment|outside_send_window)'
       AND skip_source = ''
      THEN true
      ELSE false
    END AS visible_sent
  FROM send_base
)
SELECT
  (event_at AT TIME ZONE 'America/New_York')::date AS local_day,
  route_kind,
  daily_conversation_intent,
  strategy_card_move_type,
  no_send_reason,
  skip_source,
  strategy_card_zero_question_required,
  strategy_card_high_repeat_risk,
  daily_zero_question_mode_active,
  memory_repeat_repair_skipped_zero_question_mode,
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE eligible_coaching_row) AS eligible_rows,
  COUNT(*) FILTER (WHERE eligible_coaching_row AND visible_sent) AS eligible_visible_sends,
  COUNT(*) FILTER (WHERE eligible_coaching_row AND NOT visible_sent) AS eligible_no_sends,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE eligible_coaching_row AND NOT visible_sent)
    / NULLIF(COUNT(*) FILTER (WHERE eligible_coaching_row), 0),
    1
  ) AS eligible_no_send_rate_pct,
  ARRAY_AGG(LEFT(body_preview, 180) ORDER BY event_at DESC) FILTER (WHERE body_preview <> '') AS example_bodies
FROM classified
GROUP BY
  (event_at AT TIME ZONE 'America/New_York')::date,
  route_kind,
  daily_conversation_intent,
  strategy_card_move_type,
  no_send_reason,
  skip_source,
  strategy_card_zero_question_required,
  strategy_card_high_repeat_risk,
  daily_zero_question_mode_active,
  memory_repeat_repair_skipped_zero_question_mode
ORDER BY local_day DESC, eligible_rows DESC, eligible_no_sends DESC;


-- =============================================================================
-- QUERY 3 — eligible_no_send_details
-- Purpose: Every eligible no-send with lane stage, bodies, Slice 1/2 telemetry.
-- Export as Q3_eligible_no_send_details.csv
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end
),
send_rows AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(s)->>'clerk_user_id', to_jsonb(s)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(s)->>'message_sid', to_jsonb(s)->>'outbound_message_sid', to_jsonb(s)#>>'{metadata,message_sid}') AS message_sid,
    COALESCE(to_jsonb(s)->>'status', to_jsonb(s)#>>'{metadata,status}', '') AS status,
    COALESCE(to_jsonb(s)->>'message_sid', to_jsonb(s)->>'outbound_message_sid', to_jsonb(s)#>>'{metadata,message_sid}', '') AS msg_sid,
    COALESCE(to_jsonb(s)#>>'{metadata,note}', '') AS note,
    COALESCE(
      to_jsonb(s)#>>'{metadata,route_kind}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,route_kind}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_route_kind}',
      ''
    ) AS route_kind,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_daily_conversation_intent}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_conversation_intent}',
      ''
    ) AS daily_conversation_intent,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_move_type}',
      to_jsonb(s)#>>'{metadata,strategy_card_move_type}',
      ''
    ) AS strategy_card_move_type,
    COALESCE(
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      to_jsonb(s)->>'no_send_reason',
      ''
    ) AS no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,skip_source}',
      to_jsonb(s)#>>'{metadata,voice_send_decision,skip_source}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,skip_source}',
      ''
    ) AS skip_source,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,lane_stage}',
      to_jsonb(s)#>>'{metadata,lane_stage}',
      ''
    ) AS lane_stage,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_zero_question_required}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,strategy_card_zero_question_required}',
      to_jsonb(s)#>>'{metadata,strategy_card_zero_question_required}',
      ''
    ) AS strategy_card_zero_question_required,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_high_repeat_risk}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,strategy_card_high_repeat_risk}',
      to_jsonb(s)#>>'{metadata,strategy_card_high_repeat_risk}',
      ''
    ) AS strategy_card_high_repeat_risk,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,v3_brain,daily_zero_question_mode_active}',
      ''
    ) AS daily_zero_question_mode_active,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,v3_candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,v3_candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_candidate_body}'), ''),
      ''
    ) AS candidate_body,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_original_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,memory_repeat_original_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,memory_repeat_original_body_preview}'), ''),
      ''
    ) AS memory_original_body_preview,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_repaired_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,memory_repeat_repaired_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_repaired_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,memory_repeat_repaired_body_preview}'), ''),
      ''
    ) AS memory_repaired_body_preview,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,thread_freshness_repaired_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,thread_freshness_repaired_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,thread_freshness_repaired_body_preview}'), ''),
      ''
    ) AS thread_freshness_repaired_body_preview,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,stale_guard_repair_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,stale_guard_repair_body_preview}'), ''),
      ''
    ) AS stale_repaired_body_preview,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_lane_stale_ask_phrase}',
      to_jsonb(s)#>>'{metadata,daily_lane_stale_ask_phrase}',
      to_jsonb(s)#>>'{metadata,daily_post_fvg_stale_ask_phrase}',
      ''
    ) AS stale_phrase,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,repeated_phrases}',
      to_jsonb(s)#>>'{metadata,repeated_phrases}',
      ''
    ) AS repeated_phrases,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_repair_skipped_zero_question_mode}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_repair_skipped_zero_question_mode}',
      ''
    ) AS memory_repeat_repair_skipped_zero_question_mode,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_repair_skipped_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_repair_skipped_reason}',
      ''
    ) AS memory_repeat_repair_skipped_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_no_send_reason}',
      ''
    ) AS memory_repeat_no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,repeat_repair_attempted}',
      to_jsonb(s)#>>'{metadata,v3_brain,repeat_repair_attempted}',
      ''
    ) AS repeat_repair_attempted,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,thread_freshness_repair_succeeded}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,thread_freshness_repair_succeeded}',
      ''
    ) AS thread_freshness_repair_succeeded,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,thread_freshness_violation_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,thread_freshness_violation_reason}',
      ''
    ) AS thread_freshness_violation_reason,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,north_star_visible_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_voice_gate,final_voice_gate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,body}'), ''),
      ''
    ) AS body_preview,
    to_jsonb(s) AS raw_json
  FROM sms_send_events s
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
classified AS (
  SELECT
    *,
    CASE
      WHEN no_send_reason ~* '(not.*v2|not_fully_on_v2|no_active_commitment|stopped|unsubscribed|duplicate|tapback|compliance|safety|crisis|invalid_phone|outside_send_window|skipped_not_time|skipped_active_inbound_thread)'
        OR skip_source ~* '(not.*v2|not_fully_on_v2|no_active_commitment|duplicate|tapback|compliance|safety|crisis|active_inbound_thread|outside_send_window)'
      THEN false
      ELSE true
    END AS eligible_coaching_row,
    CASE
      WHEN body_preview <> ''
       AND (
         status ~* '(sent|delivered|queued|success|accepted|sending)'
         OR msg_sid <> ''
         OR note = 'sent_to_twilio'
       )
       AND no_send_reason = ''
       AND skip_source = ''
      THEN true
      WHEN body_preview <> ''
       AND (
         status ~* '(sent|delivered|queued|success|accepted|sending)'
         OR msg_sid <> ''
         OR note = 'sent_to_twilio'
       )
       AND no_send_reason !~* '(blocked|no_send|stale|memory|freshness|missing|required|compliance|safety|duplicate|tapback|not_fully_on_v2|no_active_commitment|outside_send_window)'
       AND skip_source = ''
      THEN true
      ELSE false
    END AS visible_sent
  FROM send_rows
)
SELECT
  (event_at AT TIME ZONE 'America/New_York')::date AS local_day,
  event_at,
  clerk_user_id,
  message_sid,
  route_kind,
  daily_conversation_intent,
  strategy_card_move_type,
  status,
  no_send_reason,
  skip_source,
  lane_stage,
  strategy_card_zero_question_required,
  strategy_card_high_repeat_risk,
  daily_zero_question_mode_active,
  LEFT(candidate_body, 1000) AS candidate_body,
  LEFT(memory_original_body_preview, 1000) AS memory_original_body_preview,
  LEFT(memory_repaired_body_preview, 1000) AS memory_repaired_body_preview,
  LEFT(thread_freshness_repaired_body_preview, 1000) AS thread_freshness_repaired_body_preview,
  LEFT(stale_repaired_body_preview, 1000) AS stale_repaired_body_preview,
  stale_phrase,
  repeated_phrases,
  memory_repeat_repair_skipped_zero_question_mode,
  memory_repeat_repair_skipped_reason,
  memory_repeat_no_send_reason,
  repeat_repair_attempted,
  thread_freshness_repair_succeeded,
  thread_freshness_violation_reason,
  raw_json
FROM classified
WHERE eligible_coaching_row
  AND (
    NOT visible_sent
    OR no_send_reason <> ''
    OR skip_source <> ''
    OR lane_stage ~* '(failed|blocked|no_send)'
  )
ORDER BY event_at DESC;


-- =============================================================================
-- QUERY 4 — visible_sms_bodies
-- Purpose: Every visible daily/weekly/inbound SMS body.
-- Export as Q4_visible_sms_bodies.csv
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end
),
daily AS (
  SELECT
    'daily_outbound'::text AS source_table,
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(s)->>'clerk_user_id', to_jsonb(s)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(s)->>'status', '') AS status,
    COALESCE(to_jsonb(s)->>'message_sid', to_jsonb(s)->>'outbound_message_sid', to_jsonb(s)#>>'{metadata,message_sid}', '') AS message_sid,
    COALESCE(to_jsonb(s)#>>'{metadata,note}', '') AS note,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_daily_conversation_intent}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_conversation_intent}',
      ''
    ) AS intent_or_branch,
    COALESCE(
      to_jsonb(s)#>>'{metadata,route_kind}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,route_kind}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_route_kind}',
      ''
    ) AS route_kind,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_zero_question_required}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,strategy_card_zero_question_required}',
      to_jsonb(s)#>>'{metadata,strategy_card_zero_question_required}',
      ''
    ) AS strategy_card_zero_question_required,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_high_repeat_risk}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,strategy_card_high_repeat_risk}',
      to_jsonb(s)#>>'{metadata,strategy_card_high_repeat_risk}',
      ''
    ) AS strategy_card_high_repeat_risk,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,v3_brain,daily_zero_question_mode_active}',
      ''
    ) AS daily_zero_question_mode_active,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_repair_skipped_zero_question_mode}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_repair_skipped_zero_question_mode}',
      ''
    ) AS memory_repeat_repair_skipped_zero_question_mode,
    COALESCE(
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      ''
    ) AS no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,skip_source}',
      to_jsonb(s)#>>'{metadata,voice_send_decision,skip_source}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,skip_source}',
      ''
    ) AS skip_source,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,north_star_visible_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_voice_gate,final_voice_gate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,body}'), ''),
      ''
    ) AS body_preview,
    to_jsonb(s) AS raw_json
  FROM sms_send_events s
),
weekly AS (
  SELECT
    'weekly_outbound'::text AS source_table,
    COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(w)->>'clerk_user_id', to_jsonb(w)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(w)->>'status', '') AS status,
    COALESCE(to_jsonb(w)->>'message_sid', to_jsonb(w)->>'outbound_message_sid', to_jsonb(w)#>>'{metadata,message_sid}', '') AS message_sid,
    ''::text AS note,
    'weekly'::text AS intent_or_branch,
    'weekly'::text AS route_kind,
    ''::text AS strategy_card_zero_question_required,
    ''::text AS strategy_card_high_repeat_risk,
    ''::text AS daily_zero_question_mode_active,
    ''::text AS memory_repeat_repair_skipped_zero_question_mode,
    COALESCE(to_jsonb(w)->>'no_send_reason', to_jsonb(w)#>>'{metadata,no_send_reason}', '') AS no_send_reason,
    ''::text AS skip_source,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(w)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,body_preview}'), ''),
      ''
    ) AS body_preview,
    to_jsonb(w) AS raw_json
  FROM sms_weekly_send_events w
),
inbound_replies AS (
  SELECT
    'inbound_reply'::text AS source_table,
    COALESCE(
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(j)->>'clerk_user_id', to_jsonb(j)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(j)->>'status', '') AS status,
    COALESCE(to_jsonb(j)->>'outbound_message_sid', to_jsonb(j)->>'message_sid', '') AS message_sid,
    ''::text AS note,
    COALESCE(to_jsonb(j)#>>'{metadata,route_purpose}', to_jsonb(j)#>>'{metadata,branch_name}', '') AS intent_or_branch,
    COALESCE(to_jsonb(j)#>>'{metadata,route_purpose}', to_jsonb(j)#>>'{metadata,branch_name}', '') AS route_kind,
    ''::text AS strategy_card_zero_question_required,
    ''::text AS strategy_card_high_repeat_risk,
    ''::text AS daily_zero_question_mode_active,
    ''::text AS memory_repeat_repair_skipped_zero_question_mode,
    COALESCE(to_jsonb(j)->>'no_send_reason', to_jsonb(j)#>>'{metadata,no_send_reason}', to_jsonb(j)->>'last_error', '') AS no_send_reason,
    ''::text AS skip_source,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(j)->>'reply_body'), ''),
      NULLIF(BTRIM(to_jsonb(j)#>>'{metadata,reply_body}'), ''),
      ''
    ) AS body_preview,
    to_jsonb(j) AS raw_json
  FROM sms_inbound_coach_jobs j
),
all_rows AS (
  SELECT * FROM daily
  UNION ALL SELECT * FROM weekly
  UNION ALL SELECT * FROM inbound_replies
),
classified AS (
  SELECT
    r.*,
    CASE
      WHEN r.body_preview <> ''
       AND (
         r.source_table = 'inbound_reply'
         AND r.status ~* 'sent'
         AND r.message_sid <> ''
       )
      THEN true
      WHEN r.body_preview <> ''
       AND (
         r.status ~* '(sent|delivered|queued|success|accepted|sending)'
         OR r.message_sid <> ''
         OR r.note = 'sent_to_twilio'
       )
       AND r.no_send_reason = ''
       AND r.skip_source = ''
      THEN true
      WHEN r.body_preview <> ''
       AND (
         r.status ~* '(sent|delivered|queued|success|accepted|sending)'
         OR r.message_sid <> ''
         OR r.note = 'sent_to_twilio'
       )
       AND r.no_send_reason !~* '(blocked|no_send|stale|memory|freshness|missing|required|compliance|safety|duplicate|tapback|not_fully_on_v2|no_active_commitment|outside_send_window)'
       AND r.skip_source = ''
      THEN true
      ELSE false
    END AS visible_sent
  FROM all_rows r
)
SELECT
  (event_at AT TIME ZONE 'America/New_York')::date AS local_day,
  event_at,
  source_table,
  clerk_user_id,
  status,
  intent_or_branch,
  route_kind,
  strategy_card_zero_question_required,
  strategy_card_high_repeat_risk,
  daily_zero_question_mode_active,
  memory_repeat_repair_skipped_zero_question_mode,
  body_preview,
  raw_json
FROM classified c
CROSS JOIN bounds b
WHERE event_at >= b.window_start
  AND event_at < b.window_end
  AND visible_sent
  AND body_preview <> ''
ORDER BY event_at DESC;


-- =============================================================================
-- QUERY 5 — daily_c1_intent_and_no_send_rollup
-- Purpose: C1 intent distribution, sends/no-sends by intent, zero-question flags.
-- Export as Q5_daily_c1_intent_and_no_send_rollup.csv
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end
),
rows AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(s)->>'status', '') AS status,
    COALESCE(to_jsonb(s)->>'message_sid', to_jsonb(s)->>'outbound_message_sid', to_jsonb(s)#>>'{metadata,message_sid}', '') AS message_sid,
    COALESCE(to_jsonb(s)#>>'{metadata,note}', '') AS note,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_daily_conversation_intent}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_conversation_intent}',
      ''
    ) AS daily_conversation_intent,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_move_type}',
      to_jsonb(s)#>>'{metadata,strategy_card_move_type}',
      ''
    ) AS strategy_card_move_type,
    COALESCE(
      to_jsonb(s)#>>'{metadata,route_kind}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,route_kind}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_route_kind}',
      ''
    ) AS route_kind,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_zero_question_required}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,strategy_card_zero_question_required}',
      to_jsonb(s)#>>'{metadata,strategy_card_zero_question_required}',
      ''
    ) AS strategy_card_zero_question_required,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_high_repeat_risk}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,strategy_card_high_repeat_risk}',
      to_jsonb(s)#>>'{metadata,strategy_card_high_repeat_risk}',
      ''
    ) AS strategy_card_high_repeat_risk,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,v3_brain,daily_zero_question_mode_active}',
      ''
    ) AS daily_zero_question_mode_active,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_repair_skipped_zero_question_mode}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_repair_skipped_zero_question_mode}',
      ''
    ) AS memory_repeat_repair_skipped_zero_question_mode,
    COALESCE(
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      to_jsonb(s)->>'no_send_reason',
      ''
    ) AS no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,skip_source}',
      to_jsonb(s)#>>'{metadata,voice_send_decision,skip_source}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,skip_source}',
      ''
    ) AS skip_source,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,north_star_visible_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_voice_gate,final_voice_gate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,body}'), ''),
      ''
    ) AS body_preview
  FROM sms_send_events s
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
classified AS (
  SELECT
    *,
    CASE
      WHEN no_send_reason ~* '(not.*v2|not_fully_on_v2|no_active_commitment|stopped|unsubscribed|duplicate|tapback|compliance|safety|crisis|invalid_phone|outside_send_window|skipped_not_time|skipped_active_inbound_thread)'
        OR skip_source ~* '(not.*v2|not_fully_on_v2|no_active_commitment|duplicate|tapback|compliance|safety|crisis|active_inbound_thread|outside_send_window)'
      THEN false
      ELSE true
    END AS eligible_coaching_row,
    CASE
      WHEN body_preview <> ''
       AND (
         status ~* '(sent|delivered|queued|success|accepted|sending)'
         OR message_sid <> ''
         OR note = 'sent_to_twilio'
       )
       AND no_send_reason = ''
       AND skip_source = ''
      THEN true
      WHEN body_preview <> ''
       AND (
         status ~* '(sent|delivered|queued|success|accepted|sending)'
         OR message_sid <> ''
         OR note = 'sent_to_twilio'
       )
       AND no_send_reason !~* '(blocked|no_send|stale|memory|freshness|missing|required|compliance|safety|duplicate|tapback|not_fully_on_v2|no_active_commitment|outside_send_window)'
       AND skip_source = ''
      THEN true
      ELSE false
    END AS visible_sent
  FROM rows
)
SELECT
  (event_at AT TIME ZONE 'America/New_York')::date AS local_day,
  daily_conversation_intent,
  strategy_card_move_type,
  route_kind,
  strategy_card_zero_question_required,
  strategy_card_high_repeat_risk,
  daily_zero_question_mode_active,
  memory_repeat_repair_skipped_zero_question_mode,
  no_send_reason,
  skip_source,
  COUNT(*) AS rows,
  COUNT(*) FILTER (WHERE eligible_coaching_row) AS eligible_rows,
  COUNT(*) FILTER (WHERE visible_sent) AS visible_sends,
  COUNT(*) FILTER (WHERE eligible_coaching_row AND NOT visible_sent) AS eligible_no_sends,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE eligible_coaching_row AND NOT visible_sent)
    / NULLIF(COUNT(*) FILTER (WHERE eligible_coaching_row), 0),
    1
  ) AS eligible_no_send_rate_pct,
  ARRAY_AGG(LEFT(body_preview, 180) ORDER BY event_at DESC) FILTER (WHERE body_preview <> '') AS examples
FROM classified
GROUP BY
  (event_at AT TIME ZONE 'America/New_York')::date,
  daily_conversation_intent,
  strategy_card_move_type,
  route_kind,
  strategy_card_zero_question_required,
  strategy_card_high_repeat_risk,
  daily_zero_question_mode_active,
  memory_repeat_repair_skipped_zero_question_mode,
  no_send_reason,
  skip_source
ORDER BY local_day DESC, rows DESC;



-- =============================================================================
-- QUERY 6 — memory_repeat_diagnostics
-- Purpose: Memory anti-repeat no-sends, repairs, Slice 2 skip telemetry.
-- Export as Q6_memory_repeat_diagnostics.csv
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end
),
rows AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(s)->>'clerk_user_id', to_jsonb(s)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_daily_conversation_intent}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_conversation_intent}',
      ''
    ) AS daily_conversation_intent,
    COALESCE(
      to_jsonb(s)#>>'{metadata,route_kind}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,route_kind}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_route_kind}',
      ''
    ) AS route_kind,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,lane_stage}',
      to_jsonb(s)#>>'{metadata,lane_stage}',
      ''
    ) AS lane_stage,
    COALESCE(
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      to_jsonb(s)->>'no_send_reason',
      ''
    ) AS no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_zero_question_required}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,strategy_card_zero_question_required}',
      to_jsonb(s)#>>'{metadata,strategy_card_zero_question_required}',
      ''
    ) AS strategy_card_zero_question_required,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_high_repeat_risk}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,strategy_card_high_repeat_risk}',
      to_jsonb(s)#>>'{metadata,strategy_card_high_repeat_risk}',
      ''
    ) AS strategy_card_high_repeat_risk,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,v3_brain,daily_zero_question_mode_active}',
      ''
    ) AS daily_zero_question_mode_active,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_guard_attempted}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_guard_attempted}',
      ''
    ) AS memory_repeat_guard_attempted,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_guard_succeeded}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_guard_succeeded}',
      ''
    ) AS memory_repeat_guard_succeeded,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_no_send_reason}',
      ''
    ) AS memory_repeat_no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_repair_skipped_zero_question_mode}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_repair_skipped_zero_question_mode}',
      ''
    ) AS memory_repeat_repair_skipped_zero_question_mode,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_repair_skipped_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_repair_skipped_reason}',
      ''
    ) AS memory_repeat_repair_skipped_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,repeat_repair_attempted}',
      to_jsonb(s)#>>'{metadata,v3_brain,repeat_repair_attempted}',
      ''
    ) AS repeat_repair_attempted,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,v3_candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,v3_candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_candidate_body}'), ''),
      ''
    ) AS candidate_body,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_original_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,memory_repeat_original_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,memory_repeat_original_body_preview}'), ''),
      ''
    ) AS memory_original_body_preview,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_repaired_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,memory_repeat_repaired_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_repaired_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,memory_repeat_repaired_body_preview}'), ''),
      ''
    ) AS memory_repaired_body_preview,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,thread_freshness_repaired_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,thread_freshness_repaired_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,thread_freshness_repaired_body_preview}'), ''),
      ''
    ) AS thread_freshness_repaired_body_preview,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,north_star_visible_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_voice_gate,final_voice_gate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,body}'), ''),
      ''
    ) AS final_visible_body,
    to_jsonb(s) AS raw_json
  FROM sms_send_events s
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) < b.window_end
)
SELECT
  (event_at AT TIME ZONE 'America/New_York')::date AS local_day,
  event_at,
  clerk_user_id,
  daily_conversation_intent,
  route_kind,
  lane_stage,
  no_send_reason,
  strategy_card_zero_question_required,
  strategy_card_high_repeat_risk,
  daily_zero_question_mode_active,
  memory_repeat_guard_attempted,
  memory_repeat_guard_succeeded,
  memory_repeat_no_send_reason,
  memory_repeat_repair_skipped_zero_question_mode,
  memory_repeat_repair_skipped_reason,
  repeat_repair_attempted,
  LEFT(candidate_body, 1000) AS candidate_body,
  LEFT(memory_original_body_preview, 1000) AS memory_original_body_preview,
  LEFT(memory_repaired_body_preview, 1000) AS memory_repaired_body_preview,
  LEFT(thread_freshness_repaired_body_preview, 1000) AS thread_freshness_repaired_body_preview,
  LEFT(final_visible_body, 1000) AS final_visible_body,
  (candidate_body ~* '\?|\b(tell me|let me know|reply with|what|how|why|when|did you|do you|will you|can you)\b') AS candidate_question_shape,
  (memory_repaired_body_preview ~* '\?|\b(tell me|let me know|reply with|what|how|why|when|did you|do you|will you|can you)\b') AS memory_repaired_question_shape,
  (final_visible_body ~* '\?|\b(tell me|let me know|reply with|what|how|why|when|did you|do you|will you|can you)\b') AS final_question_shape,
  CASE
    WHEN memory_repeat_repair_skipped_zero_question_mode ~* 'true' THEN 'slice2_repair_skipped_zero_question'
    WHEN memory_repeat_no_send_reason = 'repair_disabled_zero_question_mode' THEN 'slice2_direct_no_send'
    WHEN memory_repaired_body_preview <> '' THEN 'memory_repair_attempted'
    WHEN no_send_reason ~* 'memory|repeat' OR lane_stage ~* 'memory|repeat' THEN 'memory_repeat_blocked'
    ELSE 'manual_review'
  END AS diagnostic,
  raw_json
FROM rows
WHERE memory_repeat_guard_attempted ~* 'true'
   OR memory_repeat_guard_succeeded ~* 'true'
   OR memory_repeat_no_send_reason <> ''
   OR memory_repaired_body_preview <> ''
   OR memory_repeat_repair_skipped_zero_question_mode ~* 'true'
   OR memory_repeat_repair_skipped_reason = 'repair_disabled_zero_question_mode'
   OR no_send_reason ~* 'memory|repeat|thread_memory'
   OR lane_stage ~* 'memory|repeat'
ORDER BY event_at DESC;


-- =============================================================================
-- QUERY 7 — stale_thread_freshness_diagnostics
-- Purpose: Stale ask and thread freshness no-send clusters.
-- Export as Q7_stale_thread_freshness_diagnostics.csv
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end
),
rows AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(s)->>'clerk_user_id', to_jsonb(s)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(
      to_jsonb(s)#>>'{metadata,route_kind}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,route_kind}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_route_kind}',
      ''
    ) AS route_kind,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_daily_conversation_intent}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_conversation_intent}',
      ''
    ) AS daily_conversation_intent,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,lane_stage}',
      to_jsonb(s)#>>'{metadata,lane_stage}',
      ''
    ) AS lane_stage,
    COALESCE(
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      to_jsonb(s)->>'no_send_reason',
      ''
    ) AS no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_zero_question_required}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,strategy_card_zero_question_required}',
      to_jsonb(s)#>>'{metadata,strategy_card_zero_question_required}',
      ''
    ) AS strategy_card_zero_question_required,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_high_repeat_risk}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,strategy_card_high_repeat_risk}',
      to_jsonb(s)#>>'{metadata,strategy_card_high_repeat_risk}',
      ''
    ) AS strategy_card_high_repeat_risk,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,v3_brain,daily_zero_question_mode_active}',
      ''
    ) AS daily_zero_question_mode_active,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_lane_stale_ask_phrase}',
      to_jsonb(s)#>>'{metadata,daily_lane_stale_ask_phrase}',
      to_jsonb(s)#>>'{metadata,daily_post_fvg_stale_ask_phrase}',
      ''
    ) AS stale_phrase,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,repeated_phrases}',
      to_jsonb(s)#>>'{metadata,repeated_phrases}',
      ''
    ) AS repeated_phrases,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,thread_freshness_repair_succeeded}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,thread_freshness_repair_succeeded}',
      ''
    ) AS thread_freshness_repair_succeeded,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,thread_freshness_violation_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,thread_freshness_violation_reason}',
      ''
    ) AS thread_freshness_violation_reason,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,v3_candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,v3_candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_candidate_body}'), ''),
      ''
    ) AS candidate_body,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_repaired_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,memory_repeat_repaired_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,memory_repeat_repaired_body_preview}'), ''),
      ''
    ) AS memory_repaired_body_preview,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,thread_freshness_repaired_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,thread_freshness_repaired_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,thread_freshness_repaired_body_preview}'), ''),
      ''
    ) AS thread_freshness_repaired_body_preview,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,north_star_visible_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_voice_gate,final_voice_gate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,body}'), ''),
      ''
    ) AS final_visible_body,
    to_jsonb(s) AS raw_json
  FROM sms_send_events s
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) < b.window_end
)
SELECT
  (event_at AT TIME ZONE 'America/New_York')::date AS local_day,
  event_at,
  clerk_user_id,
  route_kind,
  daily_conversation_intent,
  lane_stage,
  no_send_reason,
  strategy_card_zero_question_required,
  strategy_card_high_repeat_risk,
  daily_zero_question_mode_active,
  stale_phrase,
  repeated_phrases,
  thread_freshness_repair_succeeded,
  thread_freshness_violation_reason,
  LEFT(candidate_body, 1000) AS candidate_body,
  LEFT(memory_repaired_body_preview, 1000) AS memory_repaired_body_preview,
  LEFT(thread_freshness_repaired_body_preview, 1000) AS thread_freshness_repaired_body_preview,
  LEFT(final_visible_body, 1000) AS final_visible_body,
  CASE
    WHEN no_send_reason ~* 'stale' OR stale_phrase <> '' THEN 'stale_ask_block'
    WHEN no_send_reason ~* 'freshness' OR thread_freshness_violation_reason <> '' THEN 'thread_freshness_block'
    ELSE 'manual_review'
  END AS diagnostic,
  raw_json
FROM rows
WHERE no_send_reason ~* 'stale|freshness'
   OR lane_stage ~* 'stale|freshness'
   OR stale_phrase <> ''
   OR thread_freshness_violation_reason <> ''
ORDER BY event_at DESC;


-- =============================================================================
-- QUERY 8 — zero_question_compliance
-- Purpose: Visible sends in zero-question / high-repeat mode with question shapes.
-- Export as Q8_zero_question_compliance.csv
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end
),
rows AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(s)->>'clerk_user_id', to_jsonb(s)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(s)->>'status', '') AS status,
    COALESCE(to_jsonb(s)->>'message_sid', to_jsonb(s)->>'outbound_message_sid', to_jsonb(s)#>>'{metadata,message_sid}', '') AS message_sid,
    COALESCE(to_jsonb(s)#>>'{metadata,note}', '') AS note,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_daily_conversation_intent}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_conversation_intent}',
      ''
    ) AS daily_conversation_intent,
    COALESCE(
      to_jsonb(s)#>>'{metadata,route_kind}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,route_kind}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_route_kind}',
      ''
    ) AS route_kind,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_zero_question_required}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,strategy_card_zero_question_required}',
      to_jsonb(s)#>>'{metadata,strategy_card_zero_question_required}',
      ''
    ) AS strategy_card_zero_question_required,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_high_repeat_risk}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,strategy_card_high_repeat_risk}',
      to_jsonb(s)#>>'{metadata,strategy_card_high_repeat_risk}',
      ''
    ) AS strategy_card_high_repeat_risk,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,v3_brain,daily_zero_question_mode_active}',
      ''
    ) AS daily_zero_question_mode_active,
    COALESCE(
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      ''
    ) AS no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,skip_source}',
      to_jsonb(s)#>>'{metadata,voice_send_decision,skip_source}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,skip_source}',
      ''
    ) AS skip_source,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,north_star_visible_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_voice_gate,final_voice_gate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,body}'), ''),
      ''
    ) AS body_preview,
    to_jsonb(s) AS raw_json
  FROM sms_send_events s
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
classified AS (
  SELECT
    *,
    CASE
      WHEN body_preview <> ''
       AND (
         status ~* '(sent|delivered|queued|success|accepted|sending)'
         OR message_sid <> ''
         OR note = 'sent_to_twilio'
       )
       AND no_send_reason = ''
       AND skip_source = ''
      THEN true
      WHEN body_preview <> ''
       AND (
         status ~* '(sent|delivered|queued|success|accepted|sending)'
         OR message_sid <> ''
         OR note = 'sent_to_twilio'
       )
       AND no_send_reason !~* '(blocked|no_send|stale|memory|freshness|missing|required|compliance|safety|duplicate|tapback|not_fully_on_v2|no_active_commitment|outside_send_window)'
       AND skip_source = ''
      THEN true
      ELSE false
    END AS visible_sent
  FROM rows
)
SELECT
  (event_at AT TIME ZONE 'America/New_York')::date AS local_day,
  event_at,
  clerk_user_id,
  status,
  daily_conversation_intent,
  route_kind,
  strategy_card_zero_question_required,
  strategy_card_high_repeat_risk,
  daily_zero_question_mode_active,
  body_preview,
  CASE
    WHEN body_preview LIKE '%?%' THEN 'question_mark_violation'
    WHEN body_preview ~* '\b(tell me|let me know|reply with|name the blocker|choose one|send me)\b' THEN 'hidden_question_command'
    WHEN body_preview ~* '\b(what|how|why|when|did you|do you|will you|can you)\b' THEN 'question_cousin_review'
    WHEN body_preview ~* '\b(first step|next step|what evidence|what proof|what got in the way|did it happen|how did it go)\b' THEN 'question_cousin_review'
    ELSE 'ok_no_question_shape'
  END AS zero_question_compliance,
  raw_json
FROM classified
WHERE visible_sent
  AND body_preview <> ''
  AND (
    strategy_card_zero_question_required ~* 'true'
    OR strategy_card_high_repeat_risk ~* 'true'
    OR daily_zero_question_mode_active ~* 'true'
  )
ORDER BY event_at DESC;


-- =============================================================================
-- QUERY 9 — hidden_question_cousin_scan
-- Purpose: All visible SMS with hidden question commands (daily, weekly, inbound).
-- Export as Q9_hidden_question_cousin_scan.csv
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end
),
visible AS (
  SELECT
    'daily'::text AS source_table,
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(s)->>'clerk_user_id', to_jsonb(s)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_daily_conversation_intent}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_conversation_intent}',
      ''
    ) AS intent,
    COALESCE(to_jsonb(s)->>'status', '') AS status,
    COALESCE(to_jsonb(s)->>'message_sid', to_jsonb(s)->>'outbound_message_sid', to_jsonb(s)#>>'{metadata,message_sid}', '') AS message_sid,
    COALESCE(to_jsonb(s)#>>'{metadata,note}', '') AS note,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_zero_question_required}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,strategy_card_zero_question_required}',
      ''
    ) AS strategy_card_zero_question_required,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_zero_question_mode_active}',
      ''
    ) AS daily_zero_question_mode_active,
    COALESCE(
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      ''
    ) AS no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,skip_source}',
      to_jsonb(s)#>>'{metadata,voice_send_decision,skip_source}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,skip_source}',
      ''
    ) AS skip_source,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,north_star_visible_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_voice_gate,final_voice_gate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,body}'), ''),
      ''
    ) AS body_preview,
    to_jsonb(s) AS raw_json
  FROM sms_send_events s
  UNION ALL
  SELECT
    'weekly'::text,
    COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ),
    COALESCE(to_jsonb(w)->>'clerk_user_id', to_jsonb(w)#>>'{metadata,clerk_user_id}'),
    'weekly',
    COALESCE(to_jsonb(w)->>'status', ''),
    COALESCE(to_jsonb(w)->>'message_sid', to_jsonb(w)->>'outbound_message_sid', to_jsonb(w)#>>'{metadata,message_sid}', ''),
    '',
    '', '',
    COALESCE(to_jsonb(w)->>'no_send_reason', to_jsonb(w)#>>'{metadata,no_send_reason}', ''),
    '',
    COALESCE(
      NULLIF(BTRIM(to_jsonb(w)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,body}'), ''),
      ''
    ),
    to_jsonb(w)
  FROM sms_weekly_send_events w
  UNION ALL
  SELECT
    'inbound_reply'::text,
    COALESCE(
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ),
    COALESCE(to_jsonb(j)->>'clerk_user_id', to_jsonb(j)#>>'{metadata,clerk_user_id}'),
    COALESCE(to_jsonb(j)#>>'{metadata,route_purpose}', to_jsonb(j)#>>'{metadata,branch_name}', ''),
    COALESCE(to_jsonb(j)->>'status', ''),
    COALESCE(to_jsonb(j)->>'outbound_message_sid', to_jsonb(j)->>'message_sid', ''),
    '',
    '', '',
    COALESCE(to_jsonb(j)->>'no_send_reason', to_jsonb(j)#>>'{metadata,no_send_reason}', ''),
    '',
    COALESCE(
      NULLIF(BTRIM(to_jsonb(j)->>'reply_body'), ''),
      NULLIF(BTRIM(to_jsonb(j)#>>'{metadata,reply_body}'), ''),
      ''
    ),
    to_jsonb(j)
  FROM sms_inbound_coach_jobs j
),
classified AS (
  SELECT
    v.*,
    CASE
      WHEN v.source_table = 'inbound_reply'
       AND v.body_preview <> ''
       AND v.status ~* 'sent'
       AND v.message_sid <> ''
      THEN true
      WHEN v.body_preview <> ''
       AND (
         v.status ~* '(sent|delivered|queued|success|accepted|sending)'
         OR v.message_sid <> ''
         OR v.note = 'sent_to_twilio'
       )
       AND v.no_send_reason = ''
       AND v.skip_source = ''
      THEN true
      WHEN v.body_preview <> ''
       AND (
         v.status ~* '(sent|delivered|queued|success|accepted|sending)'
         OR v.message_sid <> ''
         OR v.note = 'sent_to_twilio'
       )
       AND v.no_send_reason !~* '(blocked|no_send|stale|memory|freshness|missing|required|compliance|safety|duplicate|tapback)'
       AND v.skip_source = ''
      THEN true
      ELSE false
    END AS visible_sent
  FROM visible v
)
SELECT
  (event_at AT TIME ZONE 'America/New_York')::date AS local_day,
  event_at,
  source_table,
  clerk_user_id,
  intent,
  body_preview,
  CASE
    WHEN body_preview ~* '\btell me\b' THEN 'tell_me'
    WHEN body_preview ~* '\blet me know\b' THEN 'let_me_know'
    WHEN body_preview ~* '\breply with\b' THEN 'reply_with'
    WHEN body_preview ~* '\bname the blocker\b' THEN 'name_the_blocker'
    WHEN body_preview ~* '\bchoose one\b' THEN 'choose_one'
    WHEN body_preview ~* '\bsend me\b' THEN 'send_me'
    WHEN body_preview ~* '\bwhat(''s| is)\b' THEN 'what_is'
    WHEN body_preview ~* '\bhow\b' THEN 'how'
    WHEN body_preview ~* '\bwhy\b' THEN 'why'
    WHEN body_preview ~* '\bwhen\b' THEN 'when'
    WHEN body_preview ~* '\?' THEN 'question_mark'
    ELSE 'manual_review'
  END AS hidden_question_family,
  strategy_card_zero_question_required,
  daily_zero_question_mode_active,
  raw_json
FROM classified c
CROSS JOIN bounds b
WHERE event_at >= b.window_start
  AND event_at < b.window_end
  AND visible_sent
  AND body_preview ~* '\b(tell me|let me know|reply with|name the blocker|choose one|send me|what''s|what is|how|why|when|did you|do you|will you|can you|first step|next step|what evidence|what proof|what got in the way|did it happen|how did it go)\b|\?'
ORDER BY event_at DESC;


-- =============================================================================
-- QUERY 10 — robot_language_scan
-- Purpose: Recommit/menu/checklist/robot/internal language in visible SMS.
-- Export as Q10_robot_language_scan.csv
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end
),
visible AS (
  SELECT
    'daily'::text AS source_table,
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(s)->>'clerk_user_id', to_jsonb(s)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(s)->>'status', '') AS status,
    COALESCE(to_jsonb(s)->>'message_sid', to_jsonb(s)->>'outbound_message_sid', to_jsonb(s)#>>'{metadata,message_sid}', '') AS message_sid,
    COALESCE(to_jsonb(s)#>>'{metadata,note}', '') AS note,
    COALESCE(
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      ''
    ) AS no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,skip_source}',
      to_jsonb(s)#>>'{metadata,voice_send_decision,skip_source}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,skip_source}',
      ''
    ) AS skip_source,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,body}'), ''),
      ''
    ) AS body_preview,
    to_jsonb(s) AS raw_json
  FROM sms_send_events s
  UNION ALL
  SELECT
    'weekly'::text,
    COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ),
    COALESCE(to_jsonb(w)->>'clerk_user_id', to_jsonb(w)#>>'{metadata,clerk_user_id}'),
    COALESCE(to_jsonb(w)->>'status', ''),
    COALESCE(to_jsonb(w)->>'message_sid', to_jsonb(w)->>'outbound_message_sid', to_jsonb(w)#>>'{metadata,message_sid}', ''),
    '',
    COALESCE(to_jsonb(w)->>'no_send_reason', to_jsonb(w)#>>'{metadata,no_send_reason}', ''),
    '',
    COALESCE(
      NULLIF(BTRIM(to_jsonb(w)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,body}'), ''),
      ''
    ),
    to_jsonb(w)
  FROM sms_weekly_send_events w
  UNION ALL
  SELECT
    'inbound_reply'::text,
    COALESCE(
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ),
    COALESCE(to_jsonb(j)->>'clerk_user_id', to_jsonb(j)#>>'{metadata,clerk_user_id}'),
    COALESCE(to_jsonb(j)->>'status', ''),
    COALESCE(to_jsonb(j)->>'outbound_message_sid', to_jsonb(j)->>'message_sid', ''),
    '',
    COALESCE(to_jsonb(j)->>'no_send_reason', to_jsonb(j)#>>'{metadata,no_send_reason}', ''),
    '',
    COALESCE(
      NULLIF(BTRIM(to_jsonb(j)->>'reply_body'), ''),
      NULLIF(BTRIM(to_jsonb(j)#>>'{metadata,reply_body}'), ''),
      ''
    ),
    to_jsonb(j)
  FROM sms_inbound_coach_jobs j
),
classified AS (
  SELECT
    v.*,
    CASE
      WHEN v.source_table = 'inbound_reply'
       AND v.body_preview <> ''
       AND v.status ~* 'sent'
       AND v.message_sid <> ''
      THEN true
      WHEN v.body_preview <> ''
       AND (
         v.status ~* '(sent|delivered|queued|success|accepted|sending)'
         OR v.message_sid <> ''
         OR v.note = 'sent_to_twilio'
       )
       AND v.no_send_reason = ''
       AND v.skip_source = ''
      THEN true
      WHEN v.body_preview <> ''
       AND (
         v.status ~* '(sent|delivered|queued|success|accepted|sending)'
         OR v.message_sid <> ''
         OR v.note = 'sent_to_twilio'
       )
       AND v.no_send_reason !~* '(blocked|no_send|stale|memory|freshness|missing|required|compliance|safety|duplicate|tapback)'
       AND v.skip_source = ''
      THEN true
      ELSE false
    END AS visible_sent
  FROM visible v
)
SELECT
  (event_at AT TIME ZONE 'America/New_York')::date AS local_day,
  event_at,
  source_table,
  clerk_user_id,
  body_preview,
  CASE
    WHEN body_preview ~* '(recommit|would you like to recommit|same line for a week|hold you to the same line)' THEN 'recommit_robot'
    WHEN body_preview ~* '(reply yes|reply no|reply stop|reply help|text yes|text no)' THEN 'menu_reply_language'
    WHEN body_preview ~* '(did you hit|did you do|did you complete).{0,30}(goal|commitment|today)' THEN 'daily_checkbox_language'
    WHEN body_preview ~* '(streak|badge|scoreboard|xp|points)' THEN 'gamified_language'
    WHEN body_preview ~* '(as an ai|i am an ai|strategy card|relationship packet|internal|template|fallback|accountability bot)' THEN 'internal_language'
    WHEN body_preview ~* '(what can you tell me about|press|menu|checkbox|habit tracker)' THEN 'robotic_question'
    ELSE 'manual_review'
  END AS robot_family,
  raw_json
FROM classified c
CROSS JOIN bounds b
WHERE event_at >= b.window_start
  AND event_at < b.window_end
  AND visible_sent
  AND body_preview ~* '(recommit|same line|reply yes|reply no|text yes|text no|did you hit|did you do|did you complete|streak|badge|scoreboard|xp|points|as an ai|strategy card|relationship packet|internal|template|fallback|accountability bot|what can you tell me about|press|menu|checkbox|habit tracker|would you like to recommit)'
ORDER BY event_at DESC;


-- =============================================================================
-- QUERY 11 — weekly_sms_audit
-- Purpose: Weekly body, miss count language, recommit/gamified/guard issues.
-- Export as Q11_weekly_sms_audit.csv
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end
),
weekly AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(w)->>'clerk_user_id', to_jsonb(w)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(w)->>'status', '') AS status,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(w)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,body_preview}'), ''),
      ''
    ) AS body_preview,
    COALESCE(to_jsonb(w)#>>'{metadata,no_send_reason}', to_jsonb(w)->>'no_send_reason', '') AS no_send_reason,
    COALESCE(to_jsonb(w)#>>'{metadata,v2_weekly_proof_pack,raw_user_no_count}', to_jsonb(w)#>>'{metadata,raw_user_no_count}', '') AS raw_user_no_count,
    COALESCE(to_jsonb(w)#>>'{metadata,v2_weekly_proof_pack,distinct_user_no_day_count}', to_jsonb(w)#>>'{metadata,distinct_user_no_day_count}', '') AS distinct_user_no_day_count,
    COALESCE(to_jsonb(w)#>>'{metadata,v2_weekly_proof_pack,exact_miss_day_count_reliable}', to_jsonb(w)#>>'{metadata,exact_miss_day_count_reliable}', '') AS exact_miss_day_count_reliable,
    to_jsonb(w) AS raw_json
  FROM sms_weekly_send_events w
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) < b.window_end
)
SELECT
  (event_at AT TIME ZONE 'America/New_York')::date AS local_day,
  event_at,
  clerk_user_id,
  status,
  no_send_reason,
  raw_user_no_count,
  distinct_user_no_day_count,
  exact_miss_day_count_reliable,
  body_preview,
  CASE
    WHEN body_preview ~* '(couple|few|several|two|2).{0,30}(missed|misses|missed days|days missed)' THEN 'exact_multi_miss_claim'
    WHEN body_preview ~* '(recommit|same line for a week)' THEN 'recommit_language'
    WHEN body_preview ~* '(streak|badge|scoreboard|xp|points)' THEN 'gamified_language'
    WHEN body_preview = '' AND no_send_reason <> '' THEN 'weekly_no_send'
    ELSE 'manual_review'
  END AS weekly_flag,
  raw_json
FROM weekly
ORDER BY event_at DESC;


-- =============================================================================
-- QUERY 12 — inbound_pairing_and_ghosting
-- Purpose: Inbound user message → coach job/reply with ghosting classification.
-- Export as Q12_inbound_pairing_and_ghosting.csv
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end
),
inbounds AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz
    ) AS inbound_at,
    COALESCE(to_jsonb(m)->>'clerk_user_id', to_jsonb(m)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(m)->>'message_sid', to_jsonb(m)#>>'{metadata,message_sid}') AS message_sid,
    LEFT(COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''),
      NULLIF(BTRIM(to_jsonb(m)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(m)#>>'{metadata,raw_body}'), ''),
      ''
    ), 1200) AS inbound_body,
    to_jsonb(m) AS raw_inbound_json
  FROM sms_inbound_messages m
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz
    ) < b.window_end
),
jobs AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) AS job_at,
    COALESCE(to_jsonb(j)->>'clerk_user_id', to_jsonb(j)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(j)->>'message_sid', to_jsonb(j)->>'inbound_message_sid', to_jsonb(j)#>>'{metadata,inbound_message_sid}') AS inbound_message_sid,
    COALESCE(to_jsonb(j)->>'status', '') AS status,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(j)->>'reply_body'), ''),
      NULLIF(BTRIM(to_jsonb(j)#>>'{metadata,reply_body}'), ''),
      ''
    ) AS reply_body,
    COALESCE(to_jsonb(j)->>'last_error', to_jsonb(j)#>>'{metadata,no_send_reason}', to_jsonb(j)#>>'{metadata,skip_source}', '') AS no_send_or_error,
    COALESCE(to_jsonb(j)#>>'{metadata,route_purpose}', to_jsonb(j)#>>'{metadata,branch_name}', '') AS route_or_branch,
    to_jsonb(j) AS raw_job_json
  FROM sms_inbound_coach_jobs j
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
paired AS (
  SELECT
    i.inbound_at,
    i.clerk_user_id,
    i.message_sid,
    i.inbound_body,
    j.job_at,
    j.status AS job_status,
    j.route_or_branch,
    j.no_send_or_error,
    j.reply_body,
    i.raw_inbound_json,
    j.raw_job_json
  FROM inbounds i
  LEFT JOIN LATERAL (
    SELECT *
    FROM jobs j2
    WHERE j2.inbound_message_sid = i.message_sid
       OR (j2.clerk_user_id = i.clerk_user_id AND j2.job_at >= i.inbound_at)
    ORDER BY j2.job_at ASC
    LIMIT 1
  ) j ON true
)
SELECT
  (inbound_at AT TIME ZONE 'America/New_York')::date AS local_day,
  inbound_at AS user_inbound_event_at,
  clerk_user_id,
  message_sid,
  inbound_body,
  job_at AS coach_job_event_at,
  job_status,
  route_or_branch,
  no_send_or_error AS no_send_reason,
  LEFT(COALESCE(reply_body, ''), 1200) AS reply_body,
  CASE
    WHEN job_status IS NULL THEN 'no_job_found'
    WHEN job_status ~* 'sent' AND COALESCE(reply_body, '') <> '' THEN 'reply_sent'
    WHEN COALESCE(reply_body, '') = '' AND LENGTH(BTRIM(inbound_body)) <= 12 THEN 'likely_ok_no_reply_short_ack'
    WHEN job_status ~* 'cancelled' AND inbound_body ~* '(no real challenge|no challenges|it was great|no problem|went well|all good)' THEN 'contradiction_risk'
    WHEN job_status !~* 'sent' OR COALESCE(reply_body, '') = '' THEN
      CASE
        WHEN LENGTH(BTRIM(inbound_body)) > 40 THEN 'meaningful_inbound_no_reply'
        ELSE 'possible_ghost'
      END
    WHEN reply_body ~* '(what made it difficult|what challenges|what got in the way)' AND inbound_body ~* '(no real challenge|no challenges|it was great|no problem)' THEN 'contradiction_risk'
    WHEN reply_body ~* '(strategies|what else|another approach)' AND inbound_body ~* '(plan|strategy|already|will )' THEN 'contradiction_risk'
    ELSE 'manual_review'
  END AS ghosting_classification,
  raw_inbound_json,
  raw_job_json
FROM paired
ORDER BY inbound_at DESC;


-- =============================================================================
-- QUERY 13 — final_guard_product_law_blocks
-- Purpose: Final guard / product-law blocks.
-- Export as Q13_final_guard_product_law_blocks.csv
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end
),
rows AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(s)->>'clerk_user_id', to_jsonb(s)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(
      to_jsonb(s)#>>'{metadata,route_kind}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,route_kind}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_route_kind}',
      ''
    ) AS route_kind,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_daily_conversation_intent}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_conversation_intent}',
      ''
    ) AS daily_conversation_intent,
    COALESCE(to_jsonb(s)->>'status', '') AS status,
    COALESCE(
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      to_jsonb(s)->>'no_send_reason',
      ''
    ) AS no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,skip_source}',
      to_jsonb(s)#>>'{metadata,voice_send_decision,skip_source}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,skip_source}',
      ''
    ) AS skip_source,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,lane_stage}',
      to_jsonb(s)#>>'{metadata,lane_stage}',
      ''
    ) AS lane_stage,
    COALESCE(
      to_jsonb(s)#>>'{metadata,unified_final_product_law_guard,no_send_reason}',
      to_jsonb(s)#>>'{metadata,unified_final_guard_no_send_reason}',
      to_jsonb(s)#>>'{metadata,final_guard_no_send_reason}',
      ''
    ) AS final_guard_no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,unified_final_product_law_guard,violations}',
      to_jsonb(s)#>>'{metadata,final_guard_violations}',
      ''
    ) AS final_guard_violations,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,v3_candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,v3_candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_candidate_body}'), ''),
      ''
    ) AS candidate_body,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,body}'), ''),
      ''
    ) AS final_body,
    to_jsonb(s) AS raw_json
  FROM sms_send_events s
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) < b.window_end
)
SELECT
  (event_at AT TIME ZONE 'America/New_York')::date AS local_day,
  event_at,
  clerk_user_id,
  route_kind,
  daily_conversation_intent,
  status,
  no_send_reason,
  skip_source,
  lane_stage,
  final_guard_no_send_reason,
  final_guard_violations,
  LEFT(candidate_body, 1000) AS candidate_body,
  LEFT(final_body, 1000) AS final_body,
  CASE
    WHEN final_guard_no_send_reason <> '' THEN 'final_guard_block'
    WHEN final_guard_violations <> '' THEN 'final_guard_violation_metadata'
    WHEN no_send_reason ~* '(final|product_law|voice|fvg|north_star|ownership|unsafe|blocked)' THEN 'product_law_related_no_send'
    WHEN lane_stage ~* '(final|product_law|voice|fvg|north_star|ownership|unsafe|blocked)' THEN 'lane_final_block'
    ELSE 'manual_review'
  END AS diagnostic,
  raw_json
FROM rows
WHERE final_guard_no_send_reason <> ''
   OR final_guard_violations <> ''
   OR no_send_reason ~* '(final|product_law|voice|fvg|north_star|ownership|unsafe|blocked)'
   OR lane_stage ~* '(final|product_law|voice|fvg|north_star|ownership|unsafe|blocked)'
   OR raw_json::text ~* '(unified_final_product_law_guard|final_voice_gate|north_star)'
ORDER BY event_at DESC;


-- =============================================================================
-- QUERY 14 — user_level_no_send_scoreboard
-- Purpose: Users with repeated no-sends / no visible coaching.
-- Export as Q14_user_level_no_send_scoreboard.csv
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end
),
rows AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(s)->>'clerk_user_id', to_jsonb(s)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(s)->>'status', '') AS status,
    COALESCE(to_jsonb(s)->>'message_sid', to_jsonb(s)->>'outbound_message_sid', to_jsonb(s)#>>'{metadata,message_sid}', '') AS message_sid,
    COALESCE(to_jsonb(s)#>>'{metadata,note}', '') AS note,
    COALESCE(
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      to_jsonb(s)->>'no_send_reason',
      ''
    ) AS no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,skip_source}',
      to_jsonb(s)#>>'{metadata,voice_send_decision,skip_source}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,skip_source}',
      ''
    ) AS skip_source,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,lane_stage}',
      to_jsonb(s)#>>'{metadata,lane_stage}',
      ''
    ) AS lane_stage,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_zero_question_mode_active}',
      ''
    ) AS daily_zero_question_mode_active,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_repair_skipped_zero_question_mode}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_repair_skipped_zero_question_mode}',
      ''
    ) AS memory_repeat_repair_skipped_zero_question_mode,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,v3_candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,v3_candidate_body}'), ''),
      ''
    ) AS candidate_body,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,body}'), ''),
      ''
    ) AS body_preview
  FROM sms_send_events s
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
classified AS (
  SELECT
    *,
    CASE
      WHEN no_send_reason ~* '(not.*v2|not_fully_on_v2|no_active_commitment|stopped|unsubscribed|duplicate|tapback|compliance|safety|crisis|invalid_phone|outside_send_window|skipped_not_time|skipped_active_inbound_thread)'
        OR skip_source ~* '(not.*v2|not_fully_on_v2|no_active_commitment|duplicate|tapback|compliance|safety|crisis|active_inbound_thread|outside_send_window)'
      THEN false
      ELSE true
    END AS eligible_coaching_row,
    CASE
      WHEN body_preview <> ''
       AND (
         status ~* '(sent|delivered|queued|success|accepted|sending)'
         OR message_sid <> ''
         OR note = 'sent_to_twilio'
       )
       AND no_send_reason = ''
       AND skip_source = ''
      THEN true
      WHEN body_preview <> ''
       AND (
         status ~* '(sent|delivered|queued|success|accepted|sending)'
         OR message_sid <> ''
         OR note = 'sent_to_twilio'
       )
       AND no_send_reason !~* '(blocked|no_send|stale|memory|freshness|missing|required|compliance|safety|duplicate|tapback|not_fully_on_v2|no_active_commitment|outside_send_window)'
       AND skip_source = ''
      THEN true
      ELSE false
    END AS visible_sent
  FROM rows
)
SELECT
  clerk_user_id,
  (MAX(event_at) AT TIME ZONE 'America/New_York')::date AS latest_local_day,
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE eligible_coaching_row) AS eligible_rows,
  COUNT(*) FILTER (WHERE visible_sent) AS visible_sends,
  COUNT(*) FILTER (WHERE eligible_coaching_row AND NOT visible_sent) AS eligible_no_sends,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE eligible_coaching_row AND NOT visible_sent)
    / NULLIF(COUNT(*) FILTER (WHERE eligible_coaching_row), 0),
    1
  ) AS eligible_no_send_rate_pct,
  ARRAY_AGG(DISTINCT no_send_reason) FILTER (WHERE eligible_coaching_row AND NOT visible_sent AND no_send_reason <> '') AS distinct_no_send_reasons,
  ARRAY_AGG(DISTINCT lane_stage) FILTER (WHERE lane_stage <> '') AS distinct_lane_stages,
  ARRAY_AGG(LEFT(body_preview, 180) ORDER BY event_at DESC) FILTER (WHERE visible_sent AND body_preview <> '') AS visible_body_examples,
  ARRAY_AGG(LEFT(candidate_body, 180) ORDER BY event_at DESC) FILTER (WHERE candidate_body <> '') AS candidate_examples,
  COUNT(*) FILTER (WHERE memory_repeat_repair_skipped_zero_question_mode ~* 'true') AS memory_skip_count,
  COUNT(*) FILTER (WHERE no_send_reason ~* 'freshness|thread_freshness') AS thread_freshness_block_count,
  COUNT(*) FILTER (WHERE no_send_reason ~* 'stale') AS stale_block_count,
  COUNT(*) FILTER (WHERE no_send_reason ~* 'pending|missing_required_verbatim') AS pending_resolution_count,
  COUNT(*) FILTER (WHERE daily_zero_question_mode_active ~* 'true') AS zero_question_active_count
FROM classified
GROUP BY clerk_user_id
HAVING COUNT(*) FILTER (WHERE eligible_coaching_row AND NOT visible_sent) > 0
ORDER BY eligible_no_sends DESC, eligible_no_send_rate_pct DESC NULLS LAST, visible_sends ASC;


-- =============================================================================
-- QUERY 15 — route_side_room_legacy_fallback_audit
-- Purpose: Legacy/fallback/template/machine/side-room paths.
-- Export as Q15_route_side_room_legacy_fallback_audit.csv
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end
),
daily_rows AS (
  SELECT
    'sms_send_events'::text AS source_table,
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(s)->>'clerk_user_id', to_jsonb(s)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(s)->>'status', '') AS status,
    COALESCE(
      to_jsonb(s)#>>'{metadata,route_kind}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,route_kind}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_route_kind}',
      ''
    ) AS route_kind,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_daily_conversation_intent}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_conversation_intent}',
      ''
    ) AS intent,
    COALESCE(
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      ''
    ) AS no_send_reason,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      ''
    ) AS body_preview,
    to_jsonb(s) AS raw_json
  FROM sms_send_events s
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
weekly_rows AS (
  SELECT
    'sms_weekly_send_events'::text,
    COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ),
    COALESCE(to_jsonb(w)->>'clerk_user_id', to_jsonb(w)#>>'{metadata,clerk_user_id}'),
    COALESCE(to_jsonb(w)->>'status', ''),
    'weekly',
    'weekly',
    COALESCE(to_jsonb(w)->>'no_send_reason', to_jsonb(w)#>>'{metadata,no_send_reason}', ''),
    COALESCE(
      NULLIF(BTRIM(to_jsonb(w)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,body}'), ''),
      ''
    ),
    to_jsonb(w)
  FROM sms_weekly_send_events w
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
all_rows AS (
  SELECT * FROM daily_rows
  UNION ALL SELECT * FROM weekly_rows
)
SELECT
  (event_at AT TIME ZONE 'America/New_York')::date AS local_day,
  event_at,
  source_table,
  clerk_user_id,
  route_kind,
  intent,
  status,
  no_send_reason,
  body_preview,
  CASE
    WHEN raw_json::text ~* 'legacy_fallback' THEN 'legacy_fallback'
    WHEN raw_json::text ~* 'side_room' THEN 'side_room'
    WHEN raw_json::text ~* 'shadow' THEN 'shadow'
    WHEN raw_json::text ~* 'contract_prompt' THEN 'contract_prompt'
    WHEN raw_json::text ~* 'deterministic|hardcoded|manual' THEN 'deterministic_or_hardcoded'
    WHEN raw_json::text ~* '\bfallback\b' THEN 'fallback'
    WHEN raw_json::text ~* '\btemplate\b' THEN 'template'
    WHEN raw_json::text ~* '\bmachine\b' THEN 'machine'
    WHEN raw_json::text ~* '\brecommit\b' THEN 'recommit'
    WHEN raw_json::text ~* '\bv1\b|\bc2\b|\bc3\b|\bold\b' THEN 'legacy_version_marker'
    WHEN body_preview ~* '(recommit|same line for a week|reply yes|reply no)' THEN 'visible_recommit_language'
    ELSE 'manual_review'
  END AS matched_family,
  raw_json
FROM all_rows
WHERE raw_json::text ~* '(legacy|fallback|template|machine|shadow|repair|recommit|contract_prompt|side_room|old|v1|c2|c3|manual|deterministic|hardcoded)'
   OR body_preview ~* '(recommit|same line for a week|reply yes|reply no)'
ORDER BY event_at DESC;


-- =============================================================================
-- QUERY 16 — post_deploy_slice1_slice2_scorecard
-- Purpose: Compact dashboard for Slice 1 + Slice 2 post-deploy impact.
-- Export as Q16_post_deploy_slice1_slice2_scorecard.csv
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end
),
send_base AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(s)->>'status', '') AS status,
    COALESCE(to_jsonb(s)->>'message_sid', to_jsonb(s)->>'outbound_message_sid', to_jsonb(s)#>>'{metadata,message_sid}', '') AS message_sid,
    COALESCE(to_jsonb(s)#>>'{metadata,note}', '') AS note,
    COALESCE(
      to_jsonb(s)#>>'{metadata,route_kind}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,route_kind}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_route_kind}',
      ''
    ) AS route_kind,
    COALESCE(
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      to_jsonb(s)->>'no_send_reason',
      ''
    ) AS no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,skip_source}',
      to_jsonb(s)#>>'{metadata,voice_send_decision,skip_source}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,skip_source}',
      ''
    ) AS skip_source,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,v3_brain,daily_zero_question_mode_active}',
      ''
    ) AS daily_zero_question_mode_active,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_high_repeat_risk}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,strategy_card_high_repeat_risk}',
      ''
    ) AS strategy_card_high_repeat_risk,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_guard_attempted}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_guard_attempted}',
      ''
    ) AS memory_repeat_guard_attempted,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_repair_skipped_zero_question_mode}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_repair_skipped_zero_question_mode}',
      ''
    ) AS memory_repeat_repair_skipped_zero_question_mode,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_no_send_reason}',
      ''
    ) AS memory_repeat_no_send_reason,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,v3_candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,v3_candidate_body}'), ''),
      ''
    ) AS candidate_body,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,north_star_visible_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_voice_gate,final_voice_gate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,body}'), ''),
      ''
    ) AS body_preview
  FROM sms_send_events s
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
classified AS (
  SELECT
    *,
    CASE
      WHEN no_send_reason ~* '(not.*v2|not_fully_on_v2|no_active_commitment|stopped|unsubscribed|duplicate|tapback|compliance|safety|crisis|invalid_phone|outside_send_window|skipped_not_time|skipped_active_inbound_thread)'
        OR skip_source ~* '(not.*v2|not_fully_on_v2|no_active_commitment|duplicate|tapback|compliance|safety|crisis|active_inbound_thread|outside_send_window)'
      THEN false
      ELSE true
    END AS eligible_coaching_row,
    CASE
      WHEN body_preview <> ''
       AND (
         status ~* '(sent|delivered|queued|success|accepted|sending)'
         OR message_sid <> ''
         OR note = 'sent_to_twilio'
       )
       AND no_send_reason = ''
       AND skip_source = ''
      THEN true
      WHEN body_preview <> ''
       AND (
         status ~* '(sent|delivered|queued|success|accepted|sending)'
         OR message_sid <> ''
         OR note = 'sent_to_twilio'
       )
       AND no_send_reason !~* '(blocked|no_send|stale|memory|freshness|missing|required|compliance|safety|duplicate|tapback|not_fully_on_v2|no_active_commitment|outside_send_window)'
       AND skip_source = ''
      THEN true
      ELSE false
    END AS visible_sent,
    (event_at AT TIME ZONE 'America/New_York')::date AS local_day
  FROM send_base
),
reason_rank AS (
  SELECT
    local_day,
    route_kind,
    no_send_reason,
    COUNT(*) AS cnt,
    ROW_NUMBER() OVER (
      PARTITION BY local_day, route_kind
      ORDER BY COUNT(*) DESC
    ) AS rn
  FROM classified
  WHERE eligible_coaching_row
    AND NOT visible_sent
    AND no_send_reason <> ''
  GROUP BY local_day, route_kind, no_send_reason
),
top_reasons AS (
  SELECT
    local_day,
    route_kind,
    ARRAY_AGG(no_send_reason ORDER BY cnt DESC) AS top_no_send_reasons
  FROM reason_rank
  WHERE rn <= 5
  GROUP BY local_day, route_kind
),
daily_agg AS (
  SELECT
    c.local_day,
    c.route_kind,
    COUNT(*) FILTER (WHERE c.eligible_coaching_row) AS eligible_rows,
    COUNT(*) FILTER (WHERE c.eligible_coaching_row AND c.visible_sent) AS eligible_visible_sends,
    COUNT(*) FILTER (WHERE c.eligible_coaching_row AND NOT c.visible_sent) AS eligible_no_sends,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE c.eligible_coaching_row AND NOT c.visible_sent)
      / NULLIF(COUNT(*) FILTER (WHERE c.eligible_coaching_row), 0),
      1
    ) AS eligible_no_send_rate_pct,
    COUNT(*) FILTER (WHERE c.daily_zero_question_mode_active ~* 'true') AS zero_question_mode_rows,
    COUNT(*) FILTER (WHERE c.daily_zero_question_mode_active ~* 'true' AND c.visible_sent) AS zero_question_visible_sends,
    COUNT(*) FILTER (
      WHERE c.daily_zero_question_mode_active ~* 'true'
        AND c.visible_sent
        AND c.body_preview ~* '\?|\b(tell me|let me know|reply with|name the blocker|choose one|send me|what|how|why|when|did you|do you|will you|can you)\b'
    ) AS zero_question_visible_question_violations,
    COUNT(*) FILTER (WHERE c.strategy_card_high_repeat_risk ~* 'true') AS high_repeat_rows,
    COUNT(*) FILTER (WHERE c.memory_repeat_guard_attempted ~* 'true') AS memory_guard_attempted_rows,
    COUNT(*) FILTER (WHERE c.memory_repeat_repair_skipped_zero_question_mode ~* 'true') AS memory_repair_skipped_zero_question_rows,
    COUNT(*) FILTER (
      WHERE c.eligible_coaching_row AND NOT c.visible_sent
        AND (
          c.memory_repeat_no_send_reason = 'repair_disabled_zero_question_mode'
          OR c.no_send_reason ~* 'memory_repeat|thread_memory_repeat'
        )
    ) AS memory_repeat_direct_no_sends,
    COUNT(*) FILTER (WHERE c.eligible_coaching_row AND NOT c.visible_sent AND c.no_send_reason ~* 'freshness|thread_freshness') AS thread_freshness_blocks,
    COUNT(*) FILTER (WHERE c.eligible_coaching_row AND NOT c.visible_sent AND c.no_send_reason ~* 'stale') AS stale_ask_blocks,
    COUNT(*) FILTER (
      WHERE c.eligible_coaching_row AND NOT c.visible_sent
        AND c.no_send_reason ~* '(memory|repeat|freshness|stale|thread)'
    ) AS memory_or_thread_blocks,
    COUNT(*) FILTER (WHERE c.eligible_coaching_row AND NOT c.visible_sent AND c.no_send_reason ~* 'pending|missing_required_verbatim') AS pending_resolution_blocks,
    COUNT(*) FILTER (WHERE c.visible_sent AND c.status ~* 'accepted') AS accepted_visible_sends,
    COUNT(*) FILTER (WHERE c.visible_sent AND c.status ~* '(sent|delivered)') AS sent_or_delivered_visible_sends,
    ARRAY_AGG(LEFT(c.candidate_body, 160) ORDER BY c.event_at DESC)
      FILTER (WHERE c.eligible_coaching_row AND NOT c.visible_sent AND c.candidate_body <> '') AS example_no_send_candidates,
    ARRAY_AGG(LEFT(c.body_preview, 160) ORDER BY c.event_at DESC)
      FILTER (WHERE c.daily_zero_question_mode_active ~* 'true' AND c.visible_sent AND c.body_preview <> '') AS example_visible_zero_question_bodies
  FROM classified c
  GROUP BY c.local_day, c.route_kind
)
SELECT
  d.local_day,
  d.route_kind,
  d.eligible_rows,
  d.eligible_visible_sends,
  d.eligible_no_sends,
  d.eligible_no_send_rate_pct,
  d.zero_question_mode_rows,
  d.zero_question_visible_sends,
  d.zero_question_visible_question_violations,
  d.high_repeat_rows,
  d.memory_guard_attempted_rows,
  d.memory_repair_skipped_zero_question_rows,
  d.memory_repeat_direct_no_sends,
  d.thread_freshness_blocks,
  d.stale_ask_blocks,
  d.memory_or_thread_blocks,
  d.pending_resolution_blocks,
  d.accepted_visible_sends,
  d.sent_or_delivered_visible_sends,
  tr.top_no_send_reasons,
  d.example_no_send_candidates,
  d.example_visible_zero_question_bodies,
  CASE
    WHEN d.eligible_no_send_rate_pct IS NULL THEN 'no_eligible_rows'
    WHEN d.eligible_no_send_rate_pct <= 1.5 THEN 'target_zone_near_1_pct'
    WHEN d.eligible_no_send_rate_pct < 5 THEN 'intermediate_under_5_pct'
    WHEN d.eligible_no_send_rate_pct < 15 THEN 'improving_under_15_pct'
    ELSE 'still_high'
  END AS target_status,
  CASE
    WHEN d.zero_question_visible_question_violations > 0 THEN 'zero_question_validator_or_card_alignment'
    WHEN d.thread_freshness_blocks >= GREATEST(d.stale_ask_blocks, d.pending_resolution_blocks)
         AND (
           d.thread_freshness_blocks::numeric / NULLIF(d.eligible_no_sends, 0) > 0.10
           OR d.eligible_no_send_rate_pct >= 15
         )
      THEN 'thread_freshness_zero_question_hardening'
    WHEN d.stale_ask_blocks::numeric / NULLIF(d.eligible_no_sends, 0) > 0.15 THEN 'strategy_card_json_demoted_rule_cleanup'
    WHEN d.pending_resolution_blocks::numeric / NULLIF(d.eligible_no_sends, 0) > 0.10 THEN 'pending_resolution_verbatim'
    WHEN d.eligible_no_send_rate_pct < 5 AND d.memory_repair_skipped_zero_question_rows > 0 THEN 'keep_soaking'
    WHEN d.eligible_no_send_rate_pct < 15 THEN 'keep_soaking'
    ELSE 'thread_freshness_zero_question_hardening'
  END AS next_recommended_slice
FROM daily_agg d
LEFT JOIN top_reasons tr
  ON tr.local_day = d.local_day
 AND tr.route_kind = d.route_kind
ORDER BY d.local_day DESC, d.route_kind;
