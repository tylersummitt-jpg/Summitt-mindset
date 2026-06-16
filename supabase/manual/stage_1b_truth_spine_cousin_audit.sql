-- =============================================================================
-- STAGE 1b — TRUTH SPINE COUSIN AUDIT (read-only, schema-safe v1.1)
-- =============================================================================
-- Run in Supabase SQL editor. SELECT-only — does not mutate data.
--
-- Window (edit bounds CTE in each query if needed):
--   2026-06-11 00:00 America/New_York
--   through 2026-06-17 00:00 America/New_York exclusive
--
-- All users. No user-specific filters.
--
-- Recommended run order:
--   1. truth_spine_health_rollup
--   2. reported_completion_no_write_post_fix_monitor
--   3. daily_outcome_spine_health_by_user
--   4. explicit_miss_candidates_without_user_no
--   5. explicit_partial_candidates_without_user_partial
--   6. sent_inbound_reply_without_truth_spine_row
--   7. victory_room_displayability_from_truth_spine
--   8. plan_answer_to_prior_question_telemetry
--   9. blocker_captured_health
--  10. contract_raise_lower_change_health
--
-- Schema-safe patterns (v1.1 — do not reference columns that may be absent):
--
-- sms_send_events body preview from alias s_json := to_jsonb(s):
--   COALESCE(
--     s_json->>'sms_body',
--     s_json->>'body',
--     s_json->>'message_body',
--     s_json->>'final_body',
--     s_json->>'body_preview',
--     s_json#>>'{metadata,sms_body}',
--     s_json#>>'{metadata,body}',
--     s_json#>>'{metadata,final_body}',
--     s_json#>>'{metadata,body_preview}',
--     s_json#>>'{metadata,voice_send_decision,body_preview}',
--     ''
--   )
--
-- sms_inbound_messages timestamp from to_jsonb(m):
--   COALESCE(
--     NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
--     NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
--     NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
--     NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz
--   )
--
-- sms_inbound_messages body from to_jsonb(m):
--   COALESCE(
--     to_jsonb(m)->>'raw_body',
--     to_jsonb(m)->>'body',
--     to_jsonb(m)->>'message_body',
--     to_jsonb(m)#>>'{metadata,raw_body}',
--     ''
--   )
--
-- v2_commitment approximate effective ask from to_jsonb(c):
--   COALESCE(
--     to_jsonb(c)->>'effective_ask',
--     CASE
--       WHEN NULLIF(to_jsonb(c)->>'adaptive_ask_text', '') IS NOT NULL
--         AND COALESCE(
--           NULLIF(to_jsonb(c)->>'adaptive_ask_expires_at', '')::timestamptz,
--           timestamptz 'infinity'
--         ) > now()
--       THEN to_jsonb(c)->>'adaptive_ask_text'
--     END,
--     to_jsonb(c)->>'adaptive_proposal_text',
--     to_jsonb(c)->>'behavior_statement',
--     to_jsonb(c)->>'title',
--     ''
--   )
-- =============================================================================


-- =============================================================================
-- QUERY 1 (run 1) — truth_spine_health_rollup
-- One row per day: inbound volume, sent replies, spine outcomes, gap counters.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_end
),
days AS (
  SELECT generate_series(
    (SELECT window_start FROM bounds),
    (SELECT window_end FROM bounds) - interval '1 day',
    interval '1 day'
  ) AS day_start
),
day_bounds AS (
  SELECT
    day_start,
    day_start + interval '1 day' AS day_end,
    (day_start AT TIME ZONE 'America/New_York')::date AS day_et
  FROM days
),
inbound_messages AS (
  SELECT
    db.day_et,
    COUNT(*) AS inbound_user_messages
  FROM sms_inbound_messages m
  JOIN day_bounds db
    ON COALESCE(
         NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
         NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
         NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
         NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz
       ) >= db.day_start
   AND COALESCE(
         NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
         NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
         NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
         NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz
       ) < db.day_end
  GROUP BY db.day_et
),
sent_jobs AS (
  SELECT
    db.day_et,
    COUNT(*) AS sent_inbound_replies
  FROM sms_inbound_coach_jobs j
  JOIN day_bounds db
    ON COALESCE(
         NULLIF(to_jsonb(j)->>'sent_at', '')::timestamptz,
         NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz,
         NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz
       ) >= db.day_start
   AND COALESCE(
         NULLIF(to_jsonb(j)->>'sent_at', '')::timestamptz,
         NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz,
         NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz
       ) < db.day_end
  WHERE to_jsonb(j)->>'status' = 'sent'
    AND NULLIF(BTRIM(to_jsonb(j)->>'outbound_message_sid'), '') IS NOT NULL
  GROUP BY db.day_et
),
spine_counts AS (
  SELECT
    db.day_et,
    COUNT(*) FILTER (WHERE e.event_type = 'user_yes') AS user_yes_count,
    COUNT(*) FILTER (WHERE e.event_type = 'user_no') AS user_no_count,
    COUNT(*) FILTER (WHERE e.event_type = 'user_partial') AS user_partial_count,
    COUNT(*) FILTER (WHERE e.event_type = 'blocker_captured') AS blocker_captured_count,
    COUNT(*) FILTER (
      WHERE e.event_type IN (
        'contract_overlay_proposed',
        'contract_overlay_activated',
        'contract_overlay_declined'
      )
    ) AS contract_goal_state_events,
    COUNT(*) FILTER (
      WHERE e.event_type IN ('coaching_refresh_prompted', 'coaching_refresh_resolved')
    ) AS refresh_events
  FROM v2_commitment_event e
  JOIN day_bounds db
    ON e.occurred_at >= db.day_start
   AND e.occurred_at < db.day_end
  GROUP BY db.day_et
),
telemetry_gaps AS (
  SELECT
    db.day_et,
    COUNT(*) FILTER (
      WHERE t.payload_json->>'inbound_meaning_relationship' = 'reported_completion'
        AND t.payload_json->>'inbound_meaning_persistence' = 'no_outcome_write'
    ) AS reported_completion_no_write_count,
    COUNT(*) FILTER (
      WHERE (
          t.payload_json->>'inbound_meaning_relationship' = 'miss'
          OR COALESCE(t.payload_json->>'raw_body_preview', '') ~* '(missed|didn''?t hit|did not hit|skipped|failed today|didn''?t happen|didn''?t do|did not do)'
        )
        AND t.payload_json->>'inbound_meaning_persistence' = 'no_outcome_write'
    ) AS miss_no_write_count,
    COUNT(*) FILTER (
      WHERE (
          t.payload_json->>'inbound_meaning_relationship' = 'partial_attempt'
          OR COALESCE(t.payload_json->>'raw_body_preview', '') ~* '(did half|only did half|halfway|part of it|got some of it done|\d[\d,]*\s+of\s+\d[\d,]*)'
        )
        AND t.payload_json->>'inbound_meaning_persistence' = 'no_outcome_write'
    ) AS partial_no_write_count
  FROM v2_commitment_event t
  JOIN day_bounds db
    ON t.occurred_at >= db.day_start
   AND t.occurred_at < db.day_end
  WHERE t.event_type = 'sms_memory_signal'
    AND t.payload_json->>'inbound_turn_telemetry' = 'true'
  GROUP BY db.day_et
),
sent_no_truth AS (
  SELECT
    db.day_et,
    COUNT(*) AS sent_reply_no_truth_event_count
  FROM (
    SELECT
      j.message_sid,
      COALESCE(
        NULLIF(to_jsonb(j)->>'sent_at', '')::timestamptz,
        NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz,
        NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz
      ) AS job_anchor_at,
      COALESCE(
        NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''),
        ''
      ) AS raw_body,
      to_jsonb(j)->>'clerk_user_id' AS clerk_user_id
    FROM sms_inbound_coach_jobs j
    WHERE to_jsonb(j)->>'status' = 'sent'
      AND NULLIF(BTRIM(to_jsonb(j)->>'outbound_message_sid'), '') IS NOT NULL
  ) j
  JOIN day_bounds db
    ON j.job_anchor_at >= db.day_start
   AND j.job_anchor_at < db.day_end
  LEFT JOIN LATERAL (
    SELECT
      BOOL_OR(
        ev.event_type IN (
          'user_yes',
          'user_no',
          'user_partial',
          'blocker_captured',
          'contract_overlay_activated',
          'contract_overlay_declined',
          'contract_overlay_proposed',
          'coaching_refresh_resolved'
        )
      ) AS any_truth_event
    FROM v2_commitment_event ev
    WHERE COALESCE(
            NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''),
            SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
          ) = j.message_sid
  ) te ON TRUE
  WHERE j.raw_body ~* '(hit\s+(the|my)\s+goal|got\s+my|got\s+in\s+\d|completed|finished|did\s+it|missed|didn''?t|skipped|failed\s+today|did\s+half|halfway|part\s+of\s+it|got\s+some\s+of\s+it\s+done|\d[\d,]*\s+of\s+\d[\d,]*)'
    AND COALESCE(te.any_truth_event, FALSE) = FALSE
  GROUP BY db.day_et
)
SELECT
  db.day_et,
  COALESCE(im.inbound_user_messages, 0) AS inbound_user_messages,
  COALESCE(sj.sent_inbound_replies, 0) AS sent_inbound_replies,
  COALESCE(sc.user_yes_count, 0) AS user_yes_count,
  COALESCE(sc.user_no_count, 0) AS user_no_count,
  COALESCE(sc.user_partial_count, 0) AS user_partial_count,
  COALESCE(sc.blocker_captured_count, 0) AS blocker_captured_count,
  COALESCE(sc.contract_goal_state_events, 0) AS contract_goal_state_events,
  COALESCE(sc.refresh_events, 0) AS refresh_events,
  COALESCE(tg.reported_completion_no_write_count, 0) AS reported_completion_no_write_count,
  COALESCE(tg.miss_no_write_count, 0) AS miss_no_write_count,
  COALESCE(tg.partial_no_write_count, 0) AS partial_no_write_count,
  COALESCE(snt.sent_reply_no_truth_event_count, 0) AS sent_reply_no_truth_event_count
FROM day_bounds db
LEFT JOIN inbound_messages im
  ON im.day_et = db.day_et
LEFT JOIN sent_jobs sj
  ON sj.day_et = db.day_et
LEFT JOIN spine_counts sc
  ON sc.day_et = db.day_et
LEFT JOIN telemetry_gaps tg
  ON tg.day_et = db.day_et
LEFT JOIN sent_no_truth snt
  ON snt.day_et = db.day_et
ORDER BY db.day_et;


-- =============================================================================
-- QUERY 2 (run 2) — reported_completion_no_write_post_fix_monitor
-- Post-fix monitor: reported_completion + no_outcome_write + job sent.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_end
),
telemetry AS (
  SELECT
    e.occurred_at,
    e.clerk_user_id,
    e.commitment_id,
    COALESCE(
      NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(e.payload_json->>'inbound_message_sid'), ''),
      NULLIF(BTRIM(e.payload_json->>'source_message_sid'), ''),
      SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) AS message_sid,
    NULLIF(BTRIM(e.payload_json->>'raw_body_preview'), '') AS raw_body_preview,
    NULLIF(BTRIM(e.payload_json->>'reply_body_preview'), '') AS reply_body_preview,
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_relationship'), '') AS relationship_meaning,
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_persistence'), '') AS persistence_decision,
    COALESCE(
      NULLIF(BTRIM(e.payload_json->>'persistence_reason'), ''),
      NULLIF(BTRIM(e.payload_json->'inbound_meaning_facts'->>'persistence_reason'), '')
    ) AS persistence_reason,
    e.payload_json AS raw_telemetry_json
  FROM v2_commitment_event e
  CROSS JOIN bounds b
  WHERE e.event_type = 'sms_memory_signal'
    AND e.payload_json->>'inbound_turn_telemetry' = 'true'
    AND e.occurred_at >= b.window_start
    AND e.occurred_at < b.window_end
),
user_yes_by_sid AS (
  SELECT
    COALESCE(
      NULLIF(BTRIM(o.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(o.payload_json->>'inbound_message_sid'), ''),
      NULLIF(BTRIM(o.payload_json->>'source_message_sid'), ''),
      SUBSTRING(o.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) AS message_sid,
    BOOL_OR(o.event_type = 'user_yes') AS user_yes_written
  FROM v2_commitment_event o
  CROSS JOIN bounds b
  WHERE o.occurred_at >= b.window_start - interval '1 day'
    AND o.occurred_at < b.window_end + interval '1 day'
    AND (
      o.event_type = 'user_yes'
      OR o.idempotency_key LIKE 'v2_user_yes:%'
    )
  GROUP BY 1
)
SELECT
  t.occurred_at,
  t.clerk_user_id,
  t.commitment_id,
  t.message_sid,
  t.raw_body_preview,
  t.reply_body_preview,
  t.relationship_meaning,
  t.persistence_decision,
  t.persistence_reason,
  to_jsonb(j)->>'status' AS job_status,
  COALESCE(y.user_yes_written, FALSE) AS user_yes_written,
  to_jsonb(t.raw_telemetry_json) AS raw_telemetry_json
FROM telemetry t
LEFT JOIN sms_inbound_coach_jobs j
  ON j.message_sid = t.message_sid
LEFT JOIN user_yes_by_sid y
  ON y.message_sid = t.message_sid
CROSS JOIN bounds b
WHERE t.relationship_meaning = 'reported_completion'
  AND t.persistence_decision = 'no_outcome_write'
  AND to_jsonb(j)->>'status' = 'sent'
  AND t.occurred_at >= b.window_start
  AND t.occurred_at < b.window_end
ORDER BY t.occurred_at DESC;


-- =============================================================================
-- QUERY 3 (run 3) — daily_outcome_spine_health_by_user
-- Per user/day counts for accountability outcomes and related spine events.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_end
),
spine_events AS (
  SELECT
    e.clerk_user_id,
    (e.occurred_at AT TIME ZONE 'America/New_York')::date AS day_et,
    e.event_type,
    COALESCE((e.payload_json->>'proof_moment')::boolean, FALSE) AS proof_moment
  FROM v2_commitment_event e
  CROSS JOIN bounds b
  WHERE e.occurred_at >= b.window_start
    AND e.occurred_at < b.window_end
    AND e.event_type IN (
      'user_yes',
      'user_no',
      'user_partial',
      'blocker_captured',
      'contract_overlay_proposed',
      'contract_overlay_activated',
      'contract_overlay_declined',
      'coaching_refresh_prompted',
      'coaching_refresh_resolved',
      'check_sent',
      'created',
      'activated',
      'completed',
      'abandoned',
      'superseded',
      'ask_shrunk',
      'timing_shifted',
      'tone_shifted',
      'paused',
      'resumed'
    )
)
SELECT
  s.clerk_user_id,
  s.day_et,
  COUNT(*) FILTER (WHERE s.event_type = 'user_yes') AS user_yes_count,
  COUNT(*) FILTER (WHERE s.event_type = 'user_no') AS user_no_count,
  COUNT(*) FILTER (WHERE s.event_type = 'user_partial') AS user_partial_count,
  COUNT(*) FILTER (
    WHERE s.event_type IN ('user_yes', 'user_no', 'user_partial')
      AND s.proof_moment = TRUE
  ) AS accountability_proof_moment_count,
  COUNT(*) FILTER (WHERE s.event_type = 'blocker_captured') AS blocker_captured_count,
  COUNT(*) FILTER (WHERE s.event_type = 'contract_overlay_activated') AS contract_overlay_activated_count,
  COUNT(*) FILTER (WHERE s.event_type = 'contract_overlay_declined') AS contract_overlay_declined_count,
  COUNT(*) FILTER (WHERE s.event_type = 'contract_overlay_proposed') AS contract_overlay_proposed_count,
  COUNT(*) FILTER (WHERE s.event_type = 'coaching_refresh_prompted') AS coaching_refresh_prompted_count,
  COUNT(*) FILTER (WHERE s.event_type = 'coaching_refresh_resolved') AS coaching_refresh_resolved_count,
  COUNT(*) FILTER (WHERE s.event_type = 'check_sent') AS check_sent_count,
  COUNT(*) FILTER (WHERE s.event_type IN ('created', 'activated')) AS commitment_start_events_count,
  COUNT(*) FILTER (WHERE s.event_type IN ('completed', 'abandoned', 'superseded')) AS commitment_end_events_count,
  COUNT(*) FILTER (WHERE s.event_type = 'ask_shrunk') AS ask_shrunk_count,
  COUNT(*) FILTER (WHERE s.event_type IN ('timing_shifted', 'tone_shifted')) AS timing_tone_shift_count,
  COUNT(*) FILTER (WHERE s.event_type IN ('paused', 'resumed')) AS pause_resume_count
FROM spine_events s
GROUP BY s.clerk_user_id, s.day_et
ORDER BY s.day_et DESC, s.clerk_user_id;


-- =============================================================================
-- QUERY 4 (run 4) — explicit_miss_candidates_without_user_no
-- Explicit miss-shaped inbound where persistence blocked user_no write.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_end
),
telemetry AS (
  SELECT
    e.id AS telemetry_event_id,
    e.occurred_at,
    e.clerk_user_id,
    e.commitment_id,
    e.payload_json,
    COALESCE(
      NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(e.payload_json->>'inbound_message_sid'), ''),
      NULLIF(BTRIM(e.payload_json->>'consent_inbound_message_sid'), ''),
      NULLIF(BTRIM(e.payload_json->>'source_message_sid'), ''),
      SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) AS message_sid,
    NULLIF(BTRIM(e.payload_json->>'raw_body_preview'), '') AS raw_body_preview,
    NULLIF(BTRIM(e.payload_json->>'reply_body_preview'), '') AS reply_body_preview,
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_relationship'), '') AS relationship_meaning,
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_persistence'), '') AS persistence_decision,
    COALESCE(
      NULLIF(BTRIM(e.payload_json->>'persistence_reason'), ''),
      NULLIF(BTRIM(e.payload_json->>'inbound_meaning_reason'), ''),
      NULLIF(BTRIM(e.payload_json->'inbound_meaning_facts'->>'persistence_reason'), ''),
      NULLIF(BTRIM(e.payload_json->'deterministic_meaning'->>'persistence_reason'), ''),
      NULLIF(BTRIM(e.payload_json->'meaning_facts'->>'persistence_reason'), '')
    ) AS persistence_reason,
    NULLIF(BTRIM(e.payload_json->>'server_reconciled_persistence_decision'), '') AS server_reconciled_persistence_decision,
    NULLIF(BTRIM(e.payload_json->>'turn_understanding_relationship_meaning'), '') AS turn_understanding_relationship_meaning,
    NULLIF(BTRIM(e.payload_json->>'branch'), '') AS telemetry_branch,
    NULLIF(BTRIM(e.payload_json->>'route_purpose'), '') AS route_purpose,
    NULLIF(BTRIM(e.payload_json->>'branch_name'), '') AS branch_name,
    NULLIF(BTRIM(e.payload_json->>'no_send_reason'), '') AS no_send_reason
  FROM v2_commitment_event e
  CROSS JOIN bounds b
  WHERE e.event_type = 'sms_memory_signal'
    AND e.payload_json->>'inbound_turn_telemetry' = 'true'
    AND e.occurred_at >= b.window_start
    AND e.occurred_at < b.window_end
),
miss_candidates AS (
  SELECT
    t.*,
    COALESCE(
      t.raw_body_preview,
      NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''),
      NULLIF(BTRIM(to_jsonb(m)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(m)->>'message_body'), ''),
      NULLIF(BTRIM(to_jsonb(m)#>>'{metadata,raw_body}'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), '')
    ) AS inbound_body_preview
  FROM telemetry t
  LEFT JOIN sms_inbound_coach_jobs j
    ON j.message_sid = t.message_sid
  LEFT JOIN sms_inbound_messages m
    ON m.message_sid = t.message_sid
  CROSS JOIN bounds b
  WHERE (
      t.relationship_meaning = 'miss'
      OR COALESCE(
        t.raw_body_preview,
        to_jsonb(m)->>'raw_body',
        to_jsonb(m)->>'body',
        to_jsonb(j)->>'raw_body',
        ''
      ) ~* '(missed(\s+it|\s+my\s+goal)?|didn''?t\s+hit|did\s+not\s+hit|skipped(\s+it)?|failed\s+today|didn''?t\s+happen|didn''?t\s+do|did\s+not\s+do|couldn''?t\s+get\s+it\s+done|not\s+done)'
    )
    AND NOT (
      COALESCE(
        t.raw_body_preview,
        to_jsonb(m)->>'raw_body',
        to_jsonb(j)->>'raw_body',
        ''
      ) ~* '(didn''?t\s+say|did\s+not\s+say|not\s+what\s+i\s+said|not\s+what\s+i\s+meant|where\s+did\s+you\s+get\s+that|why\s+did\s+you\s+ask)'
    )
),
outcome_by_sid AS (
  SELECT
    COALESCE(
      NULLIF(BTRIM(o.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(o.payload_json->>'inbound_message_sid'), ''),
      NULLIF(BTRIM(o.payload_json->>'source_message_sid'), ''),
      SUBSTRING(o.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) AS message_sid,
    BOOL_OR(o.event_type = 'user_no') AS user_no_written,
    MAX(o.occurred_at) FILTER (WHERE o.event_type = 'user_no') AS user_no_occurred_at
  FROM v2_commitment_event o
  CROSS JOIN bounds b
  WHERE o.occurred_at >= b.window_start - interval '1 day'
    AND o.occurred_at < b.window_end + interval '1 day'
    AND (
      o.event_type = 'user_no'
      OR o.idempotency_key LIKE 'v2_user_no:%'
    )
  GROUP BY 1
)
SELECT
  c.occurred_at,
  c.clerk_user_id,
  c.commitment_id,
  c.message_sid,
  c.inbound_body_preview,
  c.relationship_meaning,
  c.persistence_decision,
  c.persistence_reason,
  c.server_reconciled_persistence_decision,
  c.turn_understanding_relationship_meaning,
  to_jsonb(j)->>'status' AS job_status,
  to_jsonb(j)->>'reply_body' AS job_reply_body,
  c.reply_body_preview,
  COALESCE(obs.user_no_written, FALSE) AS user_no_written,
  obs.user_no_occurred_at,
  (
    c.persistence_decision = 'no_outcome_write'
    OR COALESCE(obs.user_no_written, FALSE) = FALSE
  ) AS miss_gap_flag,
  c.telemetry_branch,
  c.route_purpose,
  c.branch_name,
  c.no_send_reason,
  to_jsonb(c.payload_json) AS raw_telemetry_json
FROM miss_candidates c
LEFT JOIN sms_inbound_coach_jobs j
  ON j.message_sid = c.message_sid
LEFT JOIN outcome_by_sid obs
  ON obs.message_sid = c.message_sid
CROSS JOIN bounds b
WHERE c.occurred_at >= b.window_start
  AND c.occurred_at < b.window_end
  AND (
    c.persistence_decision = 'no_outcome_write'
    OR COALESCE(obs.user_no_written, FALSE) = FALSE
  )
ORDER BY c.occurred_at DESC;


-- =============================================================================
-- QUERY 5 (run 5) — explicit_partial_candidates_without_user_partial
-- Explicit partial-shaped inbound where persistence blocked user_partial write.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_end
),
telemetry AS (
  SELECT
    e.id AS telemetry_event_id,
    e.occurred_at,
    e.clerk_user_id,
    e.commitment_id,
    e.payload_json,
    COALESCE(
      NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(e.payload_json->>'inbound_message_sid'), ''),
      NULLIF(BTRIM(e.payload_json->>'consent_inbound_message_sid'), ''),
      NULLIF(BTRIM(e.payload_json->>'source_message_sid'), ''),
      SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) AS message_sid,
    NULLIF(BTRIM(e.payload_json->>'raw_body_preview'), '') AS raw_body_preview,
    NULLIF(BTRIM(e.payload_json->>'reply_body_preview'), '') AS reply_body_preview,
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_relationship'), '') AS relationship_meaning,
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_persistence'), '') AS persistence_decision,
    COALESCE(
      NULLIF(BTRIM(e.payload_json->>'persistence_reason'), ''),
      NULLIF(BTRIM(e.payload_json->>'inbound_meaning_reason'), ''),
      NULLIF(BTRIM(e.payload_json->'inbound_meaning_facts'->>'persistence_reason'), ''),
      NULLIF(BTRIM(e.payload_json->'deterministic_meaning'->>'persistence_reason'), ''),
      NULLIF(BTRIM(e.payload_json->'meaning_facts'->>'persistence_reason'), '')
    ) AS persistence_reason,
    NULLIF(BTRIM(e.payload_json->>'server_reconciled_persistence_decision'), '') AS server_reconciled_persistence_decision,
    NULLIF(BTRIM(e.payload_json->>'turn_understanding_relationship_meaning'), '') AS turn_understanding_relationship_meaning,
    NULLIF(BTRIM(e.payload_json->>'branch'), '') AS telemetry_branch,
    NULLIF(BTRIM(e.payload_json->>'route_purpose'), '') AS route_purpose,
    NULLIF(BTRIM(e.payload_json->>'branch_name'), '') AS branch_name,
    NULLIF(BTRIM(e.payload_json->>'no_send_reason'), '') AS no_send_reason
  FROM v2_commitment_event e
  CROSS JOIN bounds b
  WHERE e.event_type = 'sms_memory_signal'
    AND e.payload_json->>'inbound_turn_telemetry' = 'true'
    AND e.occurred_at >= b.window_start
    AND e.occurred_at < b.window_end
),
partial_candidates AS (
  SELECT
    t.*,
    COALESCE(
      t.raw_body_preview,
      NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''),
      NULLIF(BTRIM(to_jsonb(m)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(m)->>'message_body'), ''),
      NULLIF(BTRIM(to_jsonb(m)#>>'{metadata,raw_body}'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), '')
    ) AS inbound_body_preview
  FROM telemetry t
  LEFT JOIN sms_inbound_coach_jobs j
    ON j.message_sid = t.message_sid
  LEFT JOIN sms_inbound_messages m
    ON m.message_sid = t.message_sid
  CROSS JOIN bounds b
  WHERE (
      t.relationship_meaning = 'partial_attempt'
      OR COALESCE(
        t.raw_body_preview,
        to_jsonb(m)->>'raw_body',
        to_jsonb(m)->>'body',
        to_jsonb(j)->>'raw_body',
        ''
      ) ~* '(did\s+half|only\s+did\s+half|halfway|part\s+of\s+it|got\s+some\s+of\s+it\s+done|got\s+part\s+of\s+it\s+done|started\s+but|only\s+did\s+part|\d[\d,]*\s+of\s+\d[\d,]*|\d+\s+minutes?\s+of\s+the\s+hour)'
    )
),
outcome_by_sid AS (
  SELECT
    COALESCE(
      NULLIF(BTRIM(o.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(o.payload_json->>'inbound_message_sid'), ''),
      NULLIF(BTRIM(o.payload_json->>'source_message_sid'), ''),
      SUBSTRING(o.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) AS message_sid,
    BOOL_OR(o.event_type = 'user_partial') AS user_partial_written,
    MAX(o.occurred_at) FILTER (WHERE o.event_type = 'user_partial') AS user_partial_occurred_at
  FROM v2_commitment_event o
  CROSS JOIN bounds b
  WHERE o.occurred_at >= b.window_start - interval '1 day'
    AND o.occurred_at < b.window_end + interval '1 day'
    AND (
      o.event_type = 'user_partial'
      OR o.idempotency_key LIKE 'v2_user_partial:%'
    )
  GROUP BY 1
)
SELECT
  c.occurred_at,
  c.clerk_user_id,
  c.commitment_id,
  c.message_sid,
  c.inbound_body_preview,
  c.relationship_meaning,
  c.persistence_decision,
  c.persistence_reason,
  c.server_reconciled_persistence_decision,
  c.turn_understanding_relationship_meaning,
  to_jsonb(j)->>'status' AS job_status,
  to_jsonb(j)->>'reply_body' AS job_reply_body,
  c.reply_body_preview,
  COALESCE(obs.user_partial_written, FALSE) AS user_partial_written,
  obs.user_partial_occurred_at,
  (
    c.persistence_decision = 'no_outcome_write'
    OR COALESCE(obs.user_partial_written, FALSE) = FALSE
  ) AS partial_gap_flag,
  c.telemetry_branch,
  c.route_purpose,
  c.branch_name,
  c.no_send_reason,
  to_jsonb(c.payload_json) AS raw_telemetry_json
FROM partial_candidates c
LEFT JOIN sms_inbound_coach_jobs j
  ON j.message_sid = c.message_sid
LEFT JOIN outcome_by_sid obs
  ON obs.message_sid = c.message_sid
CROSS JOIN bounds b
WHERE c.occurred_at >= b.window_start
  AND c.occurred_at < b.window_end
  AND (
    c.persistence_decision = 'no_outcome_write'
    OR COALESCE(obs.user_partial_written, FALSE) = FALSE
  )
ORDER BY c.occurred_at DESC;


-- =============================================================================
-- QUERY 6 (run 6) — sent_inbound_reply_without_truth_spine_row
-- Sent inbound replies with substantive user text but no nearby truth-spine row.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_end
),
sent_jobs AS (
  SELECT
    j.message_sid,
    to_jsonb(j)->>'clerk_user_id' AS clerk_user_id,
    to_jsonb(j)->>'status' AS status,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''),
      ''
    ) AS raw_body,
    to_jsonb(j)->>'reply_body' AS reply_body,
    COALESCE(
      NULLIF(to_jsonb(j)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz
    ) AS job_anchor_at,
    to_jsonb(j)->>'outbound_message_sid' AS outbound_message_sid
  FROM sms_inbound_coach_jobs j
  CROSS JOIN bounds b
  WHERE to_jsonb(j)->>'status' = 'sent'
    AND COALESCE(
      NULLIF(to_jsonb(j)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(j)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz
    ) < b.window_end
    AND NULLIF(BTRIM(to_jsonb(j)->>'outbound_message_sid'), '') IS NOT NULL
),
telemetry AS (
  SELECT
    e.clerk_user_id,
    e.commitment_id,
    COALESCE(
      NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
      SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) AS message_sid,
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_relationship'), '') AS relationship_meaning,
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_persistence'), '') AS persistence_decision,
    COALESCE(
      NULLIF(BTRIM(e.payload_json->>'persistence_reason'), ''),
      NULLIF(BTRIM(e.payload_json->'inbound_meaning_facts'->>'persistence_reason'), '')
    ) AS persistence_reason,
    e.payload_json AS raw_telemetry_json
  FROM v2_commitment_event e
  CROSS JOIN bounds b
  WHERE e.event_type = 'sms_memory_signal'
    AND e.payload_json->>'inbound_turn_telemetry' = 'true'
    AND e.occurred_at >= b.window_start - interval '1 day'
    AND e.occurred_at < b.window_end + interval '1 day'
),
truth_events AS (
  SELECT
    COALESCE(
      NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(e.payload_json->>'inbound_message_sid'), ''),
      NULLIF(BTRIM(e.payload_json->>'source_message_sid'), ''),
      SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) AS message_sid,
    BOOL_OR(e.event_type IN ('user_yes', 'user_no', 'user_partial')) AS accountability_outcome_written,
    BOOL_OR(e.event_type = 'blocker_captured') AS blocker_written,
    BOOL_OR(
      e.event_type IN (
        'contract_overlay_activated',
        'contract_overlay_declined',
        'contract_overlay_proposed'
      )
    ) AS contract_event_written,
    BOOL_OR(e.event_type = 'coaching_refresh_resolved') AS refresh_resolved_written,
    BOOL_OR(
      e.event_type = 'sms_memory_signal'
      AND COALESCE(e.payload_json->>'inbound_turn_telemetry', 'false') <> 'true'
      AND COALESCE(e.payload_json->>'wave12_commitment_change_proof', 'false') = 'true'
    ) AS wave12_goal_change_written
  FROM v2_commitment_event e
  CROSS JOIN bounds b
  WHERE e.occurred_at >= b.window_start - interval '1 day'
    AND e.occurred_at < b.window_end + interval '1 day'
    AND (
      e.event_type IN (
        'user_yes',
        'user_no',
        'user_partial',
        'blocker_captured',
        'contract_overlay_activated',
        'contract_overlay_declined',
        'contract_overlay_proposed',
        'coaching_refresh_resolved'
      )
      OR (
        e.event_type = 'sms_memory_signal'
        AND COALESCE(e.payload_json->>'wave12_commitment_change_proof', 'false') = 'true'
      )
    )
  GROUP BY 1
),
classified AS (
  SELECT
    j.message_sid,
    j.clerk_user_id,
    j.status,
    j.raw_body,
    j.reply_body,
    j.job_anchor_at,
    t.commitment_id,
    t.relationship_meaning,
    t.persistence_decision,
    t.persistence_reason,
    (
      j.raw_body ~* '(hit\s+(the|my)\s+goal|got\s+my|got\s+in\s+\d|completed|finished|did\s+it|missed|didn''?t|skipped|failed\s+today|did\s+half|halfway|part\s+of\s+it|got\s+some\s+of\s+it\s+done|\d[\d,]*\s+of\s+\d[\d,]*)'
    ) AS substantive_shaped,
    COALESCE(te.accountability_outcome_written, FALSE) AS accountability_outcome_written,
    COALESCE(te.blocker_written, FALSE) AS blocker_written,
    COALESCE(te.contract_event_written, FALSE) AS contract_event_written,
    COALESCE(te.refresh_resolved_written, FALSE) AS refresh_resolved_written,
    COALESCE(te.wave12_goal_change_written, FALSE) AS wave12_goal_change_written,
    to_jsonb(t.raw_telemetry_json) AS raw_telemetry_json
  FROM sent_jobs j
  LEFT JOIN telemetry t
    ON t.message_sid = j.message_sid
  LEFT JOIN truth_events te
    ON te.message_sid = j.message_sid
)
SELECT
  c.job_anchor_at AS occurred_at,
  c.clerk_user_id,
  c.commitment_id,
  c.message_sid,
  c.raw_body AS inbound_body_preview,
  c.reply_body AS reply_preview,
  c.status AS job_status,
  c.relationship_meaning,
  c.persistence_decision,
  c.persistence_reason,
  c.substantive_shaped,
  c.accountability_outcome_written,
  c.blocker_written,
  c.contract_event_written,
  c.refresh_resolved_written,
  c.wave12_goal_change_written,
  (
    c.substantive_shaped = TRUE
    AND c.accountability_outcome_written = FALSE
    AND c.blocker_written = FALSE
    AND c.contract_event_written = FALSE
    AND c.refresh_resolved_written = FALSE
    AND c.wave12_goal_change_written = FALSE
  ) AS sent_reply_no_truth_event_flag,
  c.raw_telemetry_json
FROM classified c
WHERE (
  c.substantive_shaped = TRUE
  AND c.accountability_outcome_written = FALSE
  AND c.blocker_written = FALSE
  AND c.contract_event_written = FALSE
  AND c.refresh_resolved_written = FALSE
  AND c.wave12_goal_change_written = FALSE
)
ORDER BY c.job_anchor_at DESC;


-- =============================================================================
-- QUERY 7 (run 7) — victory_room_displayability_from_truth_spine
-- Whether spine outcome rows carry proof lines likely displayable in Victory Room.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_end
),
outcome_rows AS (
  SELECT
    e.occurred_at,
    e.clerk_user_id,
    e.commitment_id,
    e.event_type,
    COALESCE(
      NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(e.payload_json->>'inbound_message_sid'), ''),
      NULLIF(BTRIM(e.payload_json->>'source_message_sid'), ''),
      SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) AS message_sid,
    COALESCE((e.payload_json->>'proof_moment')::boolean, FALSE) AS proof_moment,
    NULLIF(BTRIM(e.payload_json->>'proof_moment_type'), '') AS proof_moment_type,
    NULLIF(BTRIM(e.payload_json->>'proof_meaning_line'), '') AS proof_meaning_line,
    NULLIF(BTRIM(e.payload_json->>'user_visible_proof_line'), '') AS user_visible_proof_line,
    NULLIF(BTRIM(e.payload_json->>'message'), '') AS accountability_message,
    e.payload_json AS raw_payload_json
  FROM v2_commitment_event e
  CROSS JOIN bounds b
  WHERE e.occurred_at >= b.window_start
    AND e.occurred_at < b.window_end
    AND (
      e.event_type IN ('user_yes', 'user_no', 'user_partial')
      OR (
        e.event_type IN (
          'blocker_captured',
          'contract_overlay_activated',
          'sms_memory_signal',
          'coaching_refresh_resolved'
        )
        AND COALESCE((e.payload_json->>'proof_moment')::boolean, FALSE) = TRUE
      )
    )
)
SELECT
  o.occurred_at,
  o.clerk_user_id,
  o.commitment_id,
  o.event_type,
  o.message_sid,
  o.proof_moment,
  o.proof_moment_type,
  (NULLIF(BTRIM(o.proof_meaning_line), '') IS NOT NULL) AS proof_meaning_line_present,
  (NULLIF(BTRIM(o.user_visible_proof_line), '') IS NOT NULL) AS user_visible_proof_line_present,
  (
    o.event_type IN ('user_yes', 'user_no', 'user_partial')
    OR (
      o.proof_moment = TRUE
      AND (
        NULLIF(BTRIM(o.proof_meaning_line), '') IS NOT NULL
        OR NULLIF(BTRIM(o.user_visible_proof_line), '') IS NOT NULL
        OR NULLIF(BTRIM(o.accountability_message), '') IS NOT NULL
      )
    )
  ) AS likely_displayable,
  CASE
    WHEN o.event_type = 'user_yes' AND o.proof_moment = TRUE THEN 'Proof in the thread'
    WHEN o.event_type = 'user_yes' AND o.proof_moment = FALSE THEN 'Kept your word'
    WHEN o.event_type = 'user_no' THEN 'Honest miss'
    WHEN o.event_type = 'user_partial' THEN 'Stayed engaged'
    WHEN o.event_type = 'blocker_captured' THEN 'Named the blocker'
    WHEN o.event_type = 'contract_overlay_activated' THEN 'Adjusted wisely'
    ELSE COALESCE(o.proof_moment_type, o.event_type)
  END AS likely_vr_headline,
  to_jsonb(o.raw_payload_json) AS raw_payload_json
FROM outcome_rows o
ORDER BY o.occurred_at DESC;


-- =============================================================================
-- QUERY 8 (run 8) — plan_answer_to_prior_question_telemetry
-- Plans / answers to prior questions: no_outcome_write is expected; inspect carry-forward.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_end
),
plan_telemetry AS (
  SELECT
    e.occurred_at,
    e.clerk_user_id,
    e.commitment_id,
    COALESCE(
      NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(e.payload_json->>'inbound_message_sid'), ''),
      NULLIF(BTRIM(e.payload_json->>'source_message_sid'), ''),
      SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) AS message_sid,
    NULLIF(BTRIM(e.payload_json->>'raw_body_preview'), '') AS raw_body_preview,
    NULLIF(BTRIM(e.payload_json->>'reply_body_preview'), '') AS reply_body_preview,
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_relationship'), '') AS relationship_meaning,
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_persistence'), '') AS persistence_decision,
    COALESCE(
      NULLIF(BTRIM(e.payload_json->>'persistence_reason'), ''),
      NULLIF(BTRIM(e.payload_json->'inbound_meaning_facts'->>'persistence_reason'), '')
    ) AS persistence_reason,
    NULLIF(BTRIM(e.payload_json->'short_answer_context'->>'prior_question_type'), '') AS prior_question_type,
    COALESCE((e.payload_json->'short_answer_context'->>'outcome_proof_eligible')::boolean, NULL) AS outcome_proof_eligible,
    NULLIF(BTRIM(e.payload_json->'short_answer_context'->>'allowed_persistence'), '') AS allowed_persistence,
    COALESCE((e.payload_json->>'open_loop_count')::int, NULL) AS open_loop_count,
    COALESCE((e.payload_json->>'do_not_repeat_ask_count')::int, NULL) AS do_not_repeat_ask_count,
    COALESCE((e.payload_json->>'recent_unanswered_question_count')::int, NULL) AS recent_unanswered_question_count,
    NULLIF(BTRIM(e.payload_json->>'active_pending_state_source'), '') AS active_pending_state_source,
    e.payload_json->'short_answer_context' AS short_answer_context_json,
    e.payload_json AS raw_telemetry_json
  FROM v2_commitment_event e
  CROSS JOIN bounds b
  WHERE e.event_type = 'sms_memory_signal'
    AND e.payload_json->>'inbound_turn_telemetry' = 'true'
    AND e.occurred_at >= b.window_start
    AND e.occurred_at < b.window_end
    AND e.payload_json->>'inbound_meaning_relationship' IN ('plan_made', 'answer_to_prior_question')
),
daily_send_events AS (
  SELECT
    to_jsonb(s)->>'clerk_user_id' AS clerk_user_id,
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz
    ) AS created_at,
    to_jsonb(s) AS s_json,
    COALESCE(
      to_jsonb(s)->>'sms_body',
      to_jsonb(s)->>'body',
      to_jsonb(s)->>'message_body',
      to_jsonb(s)->>'final_body',
      to_jsonb(s)->>'body_preview',
      to_jsonb(s)#>>'{metadata,sms_body}',
      to_jsonb(s)#>>'{metadata,body}',
      to_jsonb(s)#>>'{metadata,final_body}',
      to_jsonb(s)#>>'{metadata,body_preview}',
      to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}',
      ''
    ) AS next_daily_body_preview
  FROM sms_send_events s
  CROSS JOIN bounds b
  WHERE COALESCE(
          NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
          NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
          timestamptz 'epoch'
        ) >= b.window_start
    AND COALESCE(
          NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
          NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
          timestamptz 'epoch'
        ) < b.window_end + interval '36 hours'
),
next_daily AS (
  SELECT
    p.message_sid,
    p.occurred_at AS plan_occurred_at,
    MIN(d.created_at) AS next_daily_send_at,
    BOOL_OR(
      COALESCE(d.s_json#>>'{metadata,daily_v3_lane,route_purpose}', '') ILIKE '%plan%'
      OR COALESCE(d.s_json#>>'{metadata,relationship_packet_observability,strategy_card_daily_conversation_intent}', '') ILIKE '%plan%'
      OR COALESCE(d.s_json#>>'{metadata,relationship_packet_observability,strategy_card_move_type}', '') ILIKE '%plan%'
      OR COALESCE(d.s_json->>'route_purpose', '') ILIKE '%plan%'
      OR COALESCE(d.next_daily_body_preview, '') ILIKE '%plan%'
      OR COALESCE(d.next_daily_body_preview, '') ILIKE '%scheduled%'
      OR COALESCE(d.next_daily_body_preview, '') ILIKE '%time%'
    ) AS next_daily_references_plan_heuristic
  FROM plan_telemetry p
  LEFT JOIN daily_send_events d
    ON d.clerk_user_id = p.clerk_user_id
   AND d.created_at > p.occurred_at
   AND d.created_at < p.occurred_at + interval '36 hours'
   AND COALESCE(d.s_json->>'status', '') NOT ILIKE 'skipped%'
  GROUP BY p.message_sid, p.occurred_at
),
commitment_pending AS (
  SELECT
    c.id AS commitment_id,
    c.clerk_user_id,
    to_jsonb(c) AS c_json,
    to_jsonb(c)->>'pending_resolution_kind' AS pending_resolution_kind,
    NULLIF(to_jsonb(c)->>'pending_resolution_created_at', '')::timestamptz AS pending_resolution_created_at,
    NULLIF(to_jsonb(c)->>'pending_resolution_expires_at', '')::timestamptz AS pending_resolution_expires_at,
    to_jsonb(c)->'pending_resolution_payload' AS pending_resolution_payload
  FROM v2_commitment c
  WHERE c.status = 'active'
)
SELECT
  p.occurred_at,
  p.clerk_user_id,
  p.commitment_id,
  p.message_sid,
  p.raw_body_preview,
  p.reply_body_preview,
  p.relationship_meaning,
  p.persistence_decision,
  p.persistence_reason,
  p.prior_question_type,
  p.outcome_proof_eligible,
  p.allowed_persistence,
  p.open_loop_count,
  p.do_not_repeat_ask_count,
  p.recent_unanswered_question_count,
  p.active_pending_state_source,
  cp.pending_resolution_kind,
  cp.pending_resolution_created_at,
  cp.pending_resolution_expires_at,
  to_jsonb(cp.pending_resolution_payload) AS pending_resolution_payload_json,
  nd.next_daily_send_at,
  COALESCE(nd.next_daily_references_plan_heuristic, FALSE) AS next_daily_references_plan_heuristic,
  to_jsonb(p.short_answer_context_json) AS short_answer_context_json,
  to_jsonb(p.raw_telemetry_json) AS raw_telemetry_json
FROM plan_telemetry p
LEFT JOIN next_daily nd
  ON nd.message_sid = p.message_sid
LEFT JOIN commitment_pending cp
  ON cp.commitment_id = p.commitment_id
WHERE p.persistence_decision = 'no_outcome_write'
ORDER BY p.occurred_at DESC;


-- =============================================================================
-- QUERY 9 (run 9) — blocker_captured_health
-- Blocker spine rows plus related inbound telemetry and next-daily carry-forward.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_end
),
blocker_rows AS (
  SELECT
    e.occurred_at,
    e.clerk_user_id,
    e.commitment_id,
    e.event_type,
    COALESCE(
      NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(e.payload_json->>'inbound_message_sid'), ''),
      NULLIF(BTRIM(e.payload_json->>'ack_inbound_message_sid'), ''),
      SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) AS message_sid,
    NULLIF(BTRIM(e.payload_json->>'message'), '') AS blocker_message,
    NULLIF(BTRIM(e.payload_json->>'following_event_type'), '') AS following_event_type,
    NULLIF(BTRIM(e.payload_json->>'captured_at_context'), '') AS captured_at_context,
    COALESCE((e.payload_json->>'proof_moment')::boolean, FALSE) AS proof_moment,
    NULLIF(BTRIM(e.payload_json->>'proof_moment_type'), '') AS proof_moment_type,
    NULLIF(BTRIM(e.payload_json->>'user_visible_proof_line'), '') AS user_visible_proof_line,
    e.payload_json->'memory_signal' AS memory_signal_json,
    e.payload_json AS raw_payload_json
  FROM v2_commitment_event e
  CROSS JOIN bounds b
  WHERE e.event_type = 'blocker_captured'
    AND e.occurred_at >= b.window_start
    AND e.occurred_at < b.window_end
),
related_telemetry AS (
  SELECT
    b.occurred_at AS blocker_occurred_at,
    b.clerk_user_id,
    b.commitment_id,
    b.message_sid,
    t.occurred_at AS telemetry_occurred_at,
    NULLIF(BTRIM(t.payload_json->>'raw_body_preview'), '') AS inbound_body_preview,
    NULLIF(BTRIM(t.payload_json->>'reply_body_preview'), '') AS reply_body_preview,
    NULLIF(BTRIM(t.payload_json->>'inbound_meaning_relationship'), '') AS relationship_meaning,
    NULLIF(BTRIM(t.payload_json->>'inbound_meaning_persistence'), '') AS persistence_decision,
    to_jsonb(t.payload_json) AS raw_telemetry_json
  FROM blocker_rows b
  LEFT JOIN LATERAL (
    SELECT ev.*
    FROM v2_commitment_event ev
    WHERE ev.event_type = 'sms_memory_signal'
      AND ev.payload_json->>'inbound_turn_telemetry' = 'true'
      AND (
        ev.payload_json->>'message_sid' = b.message_sid
        OR ev.idempotency_key = 'inbound_turn_telemetry:' || b.message_sid
      )
    ORDER BY ev.occurred_at DESC
    LIMIT 1
  ) t ON TRUE
),
daily_send_events AS (
  SELECT
    to_jsonb(s)->>'clerk_user_id' AS clerk_user_id,
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz
    ) AS created_at,
    to_jsonb(s) AS s_json,
    COALESCE(
      to_jsonb(s)->>'sms_body',
      to_jsonb(s)->>'body',
      to_jsonb(s)->>'message_body',
      to_jsonb(s)->>'final_body',
      to_jsonb(s)->>'body_preview',
      to_jsonb(s)#>>'{metadata,sms_body}',
      to_jsonb(s)#>>'{metadata,body}',
      to_jsonb(s)#>>'{metadata,final_body}',
      to_jsonb(s)#>>'{metadata,body_preview}',
      to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}',
      ''
    ) AS next_daily_body_preview
  FROM sms_send_events s
  CROSS JOIN bounds b
  WHERE COALESCE(
          NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
          NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
          timestamptz 'epoch'
        ) >= b.window_start
    AND COALESCE(
          NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
          NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
          timestamptz 'epoch'
        ) < b.window_end + interval '36 hours'
),
next_daily_blocker_preview AS (
  SELECT
    b.message_sid,
    b.occurred_at AS blocker_occurred_at,
    MIN(d.created_at) AS next_daily_send_at,
    BOOL_OR(
      COALESCE(d.s_json#>>'{metadata,daily_v3_lane,blocker_preview}', '') <> ''
      OR COALESCE(d.s_json#>>'{metadata,relationship_packet_observability,blocker_preview}', '') <> ''
      OR COALESCE(d.s_json#>>'{metadata,accountability,blocker_preview}', '') <> ''
      OR COALESCE(d.next_daily_body_preview, '') ILIKE '%blocker%'
      OR COALESCE(d.next_daily_body_preview, '') ILIKE '%got in the way%'
      OR COALESCE(d.next_daily_body_preview, '') ILIKE '%obstacle%'
    ) AS next_daily_references_blocker_heuristic
  FROM blocker_rows b
  LEFT JOIN daily_send_events d
    ON d.clerk_user_id = b.clerk_user_id
   AND d.created_at > b.occurred_at
   AND d.created_at < b.occurred_at + interval '36 hours'
   AND COALESCE(d.s_json->>'status', '') NOT ILIKE 'skipped%'
  GROUP BY b.message_sid, b.occurred_at
)
SELECT
  b.occurred_at,
  b.clerk_user_id,
  b.commitment_id,
  b.message_sid,
  b.blocker_message,
  b.following_event_type,
  b.captured_at_context,
  b.proof_moment,
  b.proof_moment_type,
  b.user_visible_proof_line,
  rt.inbound_body_preview,
  rt.reply_body_preview,
  rt.relationship_meaning,
  rt.persistence_decision,
  nd.next_daily_send_at,
  COALESCE(nd.next_daily_references_blocker_heuristic, FALSE) AS next_daily_references_blocker_heuristic,
  to_jsonb(b.memory_signal_json) AS memory_signal_json,
  to_jsonb(rt.raw_telemetry_json) AS related_telemetry_json,
  to_jsonb(b.raw_payload_json) AS raw_blocker_payload_json
FROM blocker_rows b
LEFT JOIN related_telemetry rt
  ON rt.message_sid = b.message_sid
 AND rt.blocker_occurred_at = b.occurred_at
LEFT JOIN next_daily_blocker_preview nd
  ON nd.message_sid = b.message_sid
 AND nd.blocker_occurred_at = b.occurred_at
ORDER BY b.occurred_at DESC;


-- =============================================================================
-- QUERY 10 (run 10) — contract_raise_lower_change_health
-- Contract overlay, refresh, pending resolution, and ask-change spine signals.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_end
),
state_events AS (
  SELECT
    e.occurred_at,
    e.clerk_user_id,
    e.commitment_id,
    e.event_type,
    e.source,
    e.idempotency_key,
    COALESCE(
      NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(e.payload_json->>'inbound_message_sid'), ''),
      NULLIF(BTRIM(e.payload_json->>'source_message_sid'), ''),
      SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) AS message_sid,
    COALESCE(
      NULLIF(BTRIM(e.payload_json->>'raw_body_preview'), ''),
      NULLIF(BTRIM(e.payload_json->>'message'), ''),
      NULLIF(BTRIM(e.payload_json->>'inbound_body_preview'), ''),
      NULLIF(BTRIM(e.payload_json->>'consent_inbound_body_preview'), '')
    ) AS body_preview,
    NULLIF(BTRIM(e.payload_json->>'contract_kind'), '') AS contract_kind,
    NULLIF(BTRIM(e.payload_json->>'contract_overlay_kind'), '') AS contract_overlay_kind,
    NULLIF(BTRIM(e.payload_json->>'resolution'), '') AS refresh_resolution,
    NULLIF(BTRIM(e.payload_json->>'pending_resolution_kind'), '') AS pending_resolution_kind,
    NULLIF(BTRIM(e.payload_json->>'route_purpose'), '') AS route_purpose,
    NULLIF(BTRIM(e.payload_json->>'branch_name'), '') AS branch_name,
    NULLIF(BTRIM(e.payload_json->>'effective_ask'), '') AS payload_effective_ask,
    NULLIF(BTRIM(e.payload_json->>'behavior_statement'), '') AS payload_behavior_statement,
    NULLIF(BTRIM(e.payload_json->>'prior_effective_ask'), '') AS prior_effective_ask,
    NULLIF(BTRIM(e.payload_json->>'new_effective_ask'), '') AS new_effective_ask,
    NULLIF(BTRIM(e.payload_json->>'effective_ask_text'), '') AS effective_ask_text,
    NULLIF(BTRIM(e.payload_json->>'proof_moment_type'), '') AS proof_moment_type,
    COALESCE((e.payload_json->>'proof_moment')::boolean, FALSE) AS proof_moment,
    NULLIF(BTRIM(e.payload_json->>'user_visible_proof_line'), '') AS user_visible_proof_line,
    NULLIF(BTRIM(e.payload_json->>'proof_meaning_line'), '') AS proof_meaning_line,
    e.payload_json AS raw_payload_json
  FROM v2_commitment_event e
  CROSS JOIN bounds b
  WHERE e.occurred_at >= b.window_start
    AND e.occurred_at < b.window_end
    AND (
      e.event_type IN (
        'contract_overlay_proposed',
        'contract_overlay_activated',
        'contract_overlay_declined',
        'coaching_refresh_prompted',
        'coaching_refresh_resolved',
        'ask_shrunk',
        'timing_shifted',
        'tone_shifted',
        'created',
        'activated',
        'completed',
        'abandoned',
        'superseded'
      )
      OR (
        e.event_type = 'sms_memory_signal'
        AND (
          COALESCE(e.payload_json->>'route_purpose', '') ILIKE '%commitment_change%'
          OR COALESCE(e.payload_json->>'route_purpose', '') ILIKE '%contract%'
          OR COALESCE(e.payload_json->>'route_purpose', '') ILIKE '%refresh%'
          OR COALESCE(e.payload_json->>'route_purpose', '') ILIKE '%pending_resolution%'
          OR COALESCE(e.payload_json->>'branch_name', '') ILIKE '%commitment_change%'
          OR COALESCE(e.payload_json->>'branch_name', '') ILIKE '%contract%'
          OR COALESCE(e.payload_json->>'branch_name', '') ILIKE '%refresh%'
          OR COALESCE(e.payload_json->>'inbound_meaning_persistence', '') = 'defer_to_contract_consent'
          OR COALESCE(e.payload_json->>'inbound_meaning_persistence', '') = 'defer_to_pending_resolution'
        )
      )
    )
),
active_commitment_pending AS (
  SELECT
    c.id AS commitment_id,
    c.clerk_user_id,
    to_jsonb(c) AS c_json,
    to_jsonb(c)->>'title' AS title,
    to_jsonb(c)->>'behavior_statement' AS behavior_statement,
    to_jsonb(c)->>'pending_resolution_kind' AS pending_resolution_kind,
    NULLIF(to_jsonb(c)->>'pending_resolution_created_at', '')::timestamptz AS pending_resolution_created_at,
    NULLIF(to_jsonb(c)->>'pending_resolution_expires_at', '')::timestamptz AS pending_resolution_expires_at,
    to_jsonb(c)->'pending_resolution_payload' AS pending_resolution_payload,
    COALESCE(
      to_jsonb(c)->>'effective_ask',
      CASE
        WHEN NULLIF(to_jsonb(c)->>'adaptive_ask_text', '') IS NOT NULL
          AND COALESCE(
            NULLIF(to_jsonb(c)->>'adaptive_ask_expires_at', '')::timestamptz,
            timestamptz 'infinity'
          ) > now()
        THEN to_jsonb(c)->>'adaptive_ask_text'
      END,
      to_jsonb(c)->>'adaptive_proposal_text',
      to_jsonb(c)->>'behavior_statement',
      to_jsonb(c)->>'title',
      ''
    ) AS approximate_effective_ask_sql,
    to_jsonb(c)->>'adaptive_contract_overlay_kind' AS adaptive_contract_overlay_kind,
    to_jsonb(c)->>'adaptive_contract_overlay_status' AS adaptive_contract_overlay_status
  FROM v2_commitment c
  WHERE c.status = 'active'
)
SELECT
  se.occurred_at,
  se.clerk_user_id,
  se.commitment_id,
  se.event_type,
  se.source,
  se.idempotency_key,
  se.message_sid,
  se.body_preview,
  COALESCE(
    se.contract_kind,
    se.contract_overlay_kind,
    ac.adaptive_contract_overlay_kind
  ) AS contract_subtype,
  se.refresh_resolution,
  COALESCE(se.pending_resolution_kind, ac.pending_resolution_kind) AS pending_resolution_kind,
  se.route_purpose,
  se.branch_name,
  COALESCE(
    se.payload_effective_ask,
    se.effective_ask_text,
    se.new_effective_ask,
    ac.approximate_effective_ask_sql
  ) AS effective_ask,
  COALESCE(se.payload_behavior_statement, ac.behavior_statement) AS behavior_statement,
  se.prior_effective_ask,
  se.new_effective_ask,
  se.proof_moment,
  se.proof_moment_type,
  se.user_visible_proof_line,
  se.proof_meaning_line,
  ac.title AS active_commitment_title,
  ac.approximate_effective_ask_sql,
  ac.adaptive_contract_overlay_status,
  to_jsonb(ac.pending_resolution_payload) AS active_pending_resolution_payload_json,
  to_jsonb(se.raw_payload_json) AS raw_payload_json
FROM state_events se
LEFT JOIN active_commitment_pending ac
  ON ac.commitment_id = se.commitment_id
ORDER BY se.occurred_at DESC;
