-- =============================================================================
-- TRUTH SPINE CERTIFICATION PACK v1.0 (read-only)
-- =============================================================================
-- Compare real SMS threads to real persisted system truth.
-- SELECT-only. All users. Bounded window. No mutations.
--
-- Default window:
--   2026-06-11 00:00:00 America/New_York
--   through 2026-06-18 00:00:00 America/New_York exclusive
--
-- Recommended run order:
--   12 certification_scoreboard
--    1 master_thread_truth_reconciliation
--    2 outcome_candidate_gap_rollup
--    3 user_yes_certification
--    4 user_no_certification
--    5 user_partial_certification
--    6 plan_memory_certification
--    7 blocker_certification
--    8 goal_change_raise_lower_certification
--    9 victory_room_projection_certification
--   10 next_sms_truth_usage_certification
--   11 no_send_truth_loss_certification
--
-- Schema-safe: to_jsonb(m|j|s|w|c) for drift-prone columns.
-- Join spine rows via payload_json->>'message_sid' or idempotency_key suffix.
-- =============================================================================


-- =============================================================================
-- QUERY 1 — master_thread_truth_reconciliation
-- One row per inbound SMS: thread + classification + persistence + spine + VR.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
),
inbound_rows AS (
  SELECT
    COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')
    ) AS inbound_message_sid,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'clerk_user_id'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'clerk_user_id'), '')
    ) AS clerk_user_id,
    COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) AS inbound_at,
  LEFT(
    COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''),
      NULLIF(BTRIM(to_jsonb(m)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(m)->>'message_body'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''),
      ''
    ),
    280
  ) AS inbound_body_preview
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j
    ON j.message_sid = to_jsonb(m)->>'message_sid'
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz
    ) < b.window_end
    AND COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')
    ) IS NOT NULL
),
enriched AS (
  SELECT
    ir.*,
    (ir.inbound_at AT TIME ZONE 'America/New_York')::date AS local_day,
    to_jsonb(j)->>'status' AS next_coach_reply_status,
    LEFT(COALESCE(NULLIF(BTRIM(to_jsonb(j)->>'reply_body'), ''), ''), 280) AS next_coach_reply_preview,
    tel.commitment_id,
    tel.relationship_meaning,
    tel.persistence_decision,
    tel.persistence_reason,
    tel.raw_telemetry_json,
    prev.previous_coach_message_preview,
    prev.previous_coach_at,
    nxt.next_daily_or_weekly_sms_preview,
    sp.persisted_user_yes,
    sp.persisted_user_no,
    sp.persisted_user_partial,
    sp.persisted_blocker_captured,
    sp.persisted_plan_signal,
    sp.persisted_goal_or_contract_change,
    sp.proof_moment,
    sp.proof_moment_type,
    sp.user_visible_proof_line,
    sp.raw_spine_events_json,
    CASE
      WHEN ir.inbound_body_preview ~* '(stop|unsubscribe|help|start)\b' THEN 'support_safety_candidate'
      WHEN ir.inbound_body_preview ~* '(onboarding|what i chose|didn''?t ask me|did not ask me|why did you ask|didn''?t say|never said|didn''?t mean|that''?s not what i said)'
        AND ir.inbound_body_preview !~* '(missed|didn''?t do|did not do|didn''?t hit|skipped|failed today|didn''?t happen)'
        THEN 'meta_process_candidate'
      WHEN ir.inbound_body_preview ~* '(change my goal|raise the bar|lower the bar|shrink|make it easier|too easy|too hard|new goal|different goal|\d+\s+miles?\s+instead of)'
        THEN 'goal_change_candidate'
      WHEN ir.inbound_body_preview ~* '(blocker|got in the way|what stopped|couldn''?t because|in the way was)'
        THEN 'blocker_candidate'
      WHEN ir.inbound_body_preview ~* '(i''?ll|i will|plan to|going to|gonna|tomorrow morning|tomorrow night|made a plan)'
        THEN 'plan_candidate'
      WHEN ir.inbound_body_preview ~* '(did half|only did part|halfway|part of it|got some of it done|\d[\d,]*\s+of\s+\d[\d,]*|started but)'
        THEN 'partial_candidate'
      WHEN ir.inbound_body_preview ~* '(missed|didn''?t hit|did not hit|skipped|failed today|didn''?t happen|didn''?t do|did not do|did not get it today)'
        AND ir.inbound_body_preview !~* '(didn''?t say|didn''?t ask|onboarding matter)'
        THEN 'miss_candidate'
      WHEN ir.inbound_body_preview ~* '(hit\s+(the|my)\s+goal|got\s+my|got\s+in\s+\d|completed|finished|did\s+it|woo\s*hoo|\d{1,3}[,]?\d*\s+steps)'
        AND ir.inbound_body_preview !~* '(should still be able|going to|plan to|gonna|might|may|hope to)'
        THEN 'completion_candidate'
      ELSE 'other'
    END AS candidate_family
  FROM inbound_rows ir
  LEFT JOIN sms_inbound_coach_jobs j
    ON j.message_sid = ir.inbound_message_sid
  LEFT JOIN LATERAL (
    SELECT
      e.commitment_id,
      NULLIF(BTRIM(e.payload_json->>'inbound_meaning_relationship'), '') AS relationship_meaning,
      NULLIF(BTRIM(e.payload_json->>'inbound_meaning_persistence'), '') AS persistence_decision,
      COALESCE(
        NULLIF(BTRIM(e.payload_json->>'persistence_reason'), ''),
        NULLIF(BTRIM(e.payload_json->'inbound_meaning_facts'->>'persistence_reason'), '')
      ) AS persistence_reason,
      to_jsonb(e.payload_json) AS raw_telemetry_json
    FROM v2_commitment_event e
    WHERE e.event_type = 'sms_memory_signal'
      AND e.payload_json->>'inbound_turn_telemetry' = 'true'
      AND COALESCE(
        NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
        SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
      ) = ir.inbound_message_sid
    ORDER BY e.occurred_at DESC
    LIMIT 1
  ) tel ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      LEFT(COALESCE(
        NULLIF(BTRIM(e.payload_json->>'body_preview'), ''),
        NULLIF(BTRIM(e.payload_json->>'effective_ask_text'), ''),
        NULLIF(BTRIM(tm.last_outbound_full_body), ''),
        ''
      ), 280) AS previous_coach_message_preview,
      COALESCE(e.occurred_at, tm.last_outbound_sent_at) AS previous_coach_at
    FROM v2_commitment_event e
    LEFT JOIN v2_commitment_sms_thread_memory tm
      ON tm.clerk_user_id = ir.clerk_user_id
    WHERE e.clerk_user_id = ir.clerk_user_id
      AND e.event_type = 'check_sent'
      AND e.occurred_at < ir.inbound_at
    ORDER BY e.occurred_at DESC
    LIMIT 1
  ) prev ON TRUE
  LEFT JOIN LATERAL (
    SELECT LEFT(COALESCE(
      to_jsonb(s)->>'sms_body',
      to_jsonb(s)#>>'{metadata,sms_body}',
      to_jsonb(s)#>>'{metadata,final_body}',
      ''
    ), 280) AS next_daily_or_weekly_sms_preview
    FROM sms_send_events s
    WHERE to_jsonb(s)->>'clerk_user_id' = ir.clerk_user_id
      AND NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz > ir.inbound_at
    ORDER BY NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz ASC NULLS LAST
    LIMIT 1
  ) nxt ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      BOOL_OR(ev.event_type = 'user_yes') AS persisted_user_yes,
      BOOL_OR(ev.event_type = 'user_no') AS persisted_user_no,
      BOOL_OR(ev.event_type = 'user_partial') AS persisted_user_partial,
      BOOL_OR(ev.event_type = 'blocker_captured') AS persisted_blocker_captured,
      BOOL_OR(
        ev.event_type = 'sms_memory_signal'
        AND COALESCE(ev.payload_json->'memory_signal'->>'memory_signal_detected', 'false') = 'true'
        AND ev.payload_json->'memory_signal'->>'memory_signal_type' ILIKE '%plan%'
      ) AS persisted_plan_signal,
      BOOL_OR(ev.event_type IN (
        'contract_overlay_proposed', 'contract_overlay_activated', 'contract_overlay_declined',
        'coaching_refresh_prompted', 'coaching_refresh_resolved', 'ask_shrunk', 'created', 'superseded'
      )) AS persisted_goal_or_contract_change,
      BOOL_OR(COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS proof_moment,
      MAX(ev.payload_json->>'proof_moment_type') FILTER (WHERE COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS proof_moment_type,
      MAX(LEFT(COALESCE(
        ev.payload_json->>'user_visible_proof_line',
        ev.payload_json->>'proof_meaning_line',
        ''
      ), 220)) FILTER (WHERE COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS user_visible_proof_line,
      jsonb_agg(to_jsonb(ev) ORDER BY ev.occurred_at) AS raw_spine_events_json
    FROM v2_commitment_event ev
    WHERE COALESCE(
      NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(ev.payload_json->>'inbound_resolution_message_sid'), ''),
      SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) = ir.inbound_message_sid
  ) sp ON TRUE
)
SELECT
  e.local_day,
  e.inbound_at,
  e.clerk_user_id,
  e.commitment_id,
  e.inbound_message_sid,
  e.inbound_body_preview,
  e.previous_coach_message_preview,
  e.previous_coach_at,
  e.next_coach_reply_preview,
  e.next_coach_reply_status,
  e.next_daily_or_weekly_sms_preview,
  e.relationship_meaning,
  e.persistence_decision,
  e.persistence_reason,
  e.candidate_family,
  COALESCE(e.persisted_user_yes, FALSE) AS persisted_user_yes,
  COALESCE(e.persisted_user_no, FALSE) AS persisted_user_no,
  COALESCE(e.persisted_user_partial, FALSE) AS persisted_user_partial,
  COALESCE(e.persisted_blocker_captured, FALSE) AS persisted_blocker_captured,
  COALESCE(e.persisted_plan_signal, FALSE) AS persisted_plan_signal,
  COALESCE(e.persisted_goal_or_contract_change, FALSE) AS persisted_goal_or_contract_change,
  COALESCE(e.proof_moment, FALSE) AS proof_moment,
  e.proof_moment_type,
  e.user_visible_proof_line,
  (
    COALESCE(e.proof_moment, FALSE)
    AND COALESCE(e.user_visible_proof_line, '') <> ''
    AND COALESCE(e.proof_moment_type, '') NOT IN ('memory_updated')
    AND e.candidate_family <> 'meta_process_candidate'
  ) AS victory_room_display_candidate,
  CASE
    WHEN e.candidate_family = 'completion_candidate'
      AND COALESCE(e.persistence_decision, '') IN ('write_user_yes_today', 'ack_only')
      AND COALESCE(e.persisted_user_yes, FALSE) = FALSE
      THEN 'completion_without_user_yes'
    WHEN e.candidate_family = 'miss_candidate'
      AND COALESCE(e.persistence_decision, '') = 'write_user_no'
      AND COALESCE(e.persisted_user_no, FALSE) = FALSE
      THEN 'miss_without_user_no'
    WHEN e.candidate_family = 'partial_candidate'
      AND COALESCE(e.persistence_decision, '') = 'write_user_partial'
      AND COALESCE(e.persisted_user_partial, FALSE) = FALSE
      THEN 'partial_without_user_partial'
    WHEN e.candidate_family = 'blocker_candidate'
      AND COALESCE(e.persisted_blocker_captured, FALSE) = FALSE
      AND e.inbound_body_preview ~* '(blocker|got in the way|stopped me)'
      THEN 'blocker_without_blocker_event'
    WHEN e.candidate_family = 'plan_candidate'
      AND COALESCE(e.persisted_plan_signal, FALSE) = FALSE
      AND COALESCE(e.persistence_decision, '') = 'no_outcome_write'
      THEN 'plan_without_plan_memory_signal'
    WHEN e.candidate_family = 'goal_change_candidate'
      AND COALESCE(e.persisted_goal_or_contract_change, FALSE) = FALSE
      THEN 'goal_change_without_state_event'
    WHEN e.candidate_family = 'meta_process_candidate'
      AND COALESCE(e.persisted_user_no, FALSE) = TRUE
      THEN 'meta_process_written_as_outcome'
    WHEN e.candidate_family IN ('meta_process_candidate', 'support_safety_candidate', 'other')
      AND COALESCE(e.persistence_decision, '') = 'no_outcome_write'
      THEN 'no_outcome_expected'
    WHEN (
      (e.candidate_family = 'completion_candidate' AND COALESCE(e.persisted_user_yes, FALSE))
      OR (e.candidate_family = 'miss_candidate' AND COALESCE(e.persisted_user_no, FALSE))
      OR (e.candidate_family = 'partial_candidate' AND COALESCE(e.persisted_user_partial, FALSE))
      OR (e.candidate_family = 'blocker_candidate' AND COALESCE(e.persisted_blocker_captured, FALSE))
    ) THEN 'outcome_written_ok'
    ELSE 'manual_review'
  END AS diagnostic,
  e.raw_telemetry_json,
  e.raw_spine_events_json
FROM enriched e
ORDER BY e.inbound_at DESC, e.clerk_user_id;


-- =============================================================================
-- QUERY 2 — outcome_candidate_gap_rollup
-- Group master reconciliation signals by day, candidate family, diagnostic.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
),
inbound_rows AS (
  SELECT
    COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''), NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')) AS inbound_message_sid,
    COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'clerk_user_id'), ''), NULLIF(BTRIM(to_jsonb(j)->>'clerk_user_id'), '')) AS clerk_user_id,
    COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz
    ) AS inbound_at,
    LEFT(COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''),
      ''
    ), 280) AS inbound_body_preview
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j ON j.message_sid = to_jsonb(m)->>'message_sid'
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz
    ) < b.window_end
),
classified AS (
  SELECT
    ir.*,
    (ir.inbound_at AT TIME ZONE 'America/New_York')::date AS local_day,
    CASE
      WHEN ir.inbound_body_preview ~* '(onboarding|didn''?t ask me|did not ask)' THEN 'meta_process_candidate'
      WHEN ir.inbound_body_preview ~* '(change my goal|lower the bar|raise the bar|shrink)' THEN 'goal_change_candidate'
      WHEN ir.inbound_body_preview ~* '(blocker|got in the way)' THEN 'blocker_candidate'
      WHEN ir.inbound_body_preview ~* '(i''?ll|plan to|going to|tomorrow)' THEN 'plan_candidate'
      WHEN ir.inbound_body_preview ~* '(did half|halfway|part of it|\d+\s+of\s+\d+)' THEN 'partial_candidate'
      WHEN ir.inbound_body_preview ~* '(missed|didn''?t hit|skipped|didn''?t do)' THEN 'miss_candidate'
      WHEN ir.inbound_body_preview ~* '(hit the goal|got my|completed|finished|did it)' THEN 'completion_candidate'
      ELSE 'other'
    END AS candidate_family,
    COALESCE(sp.yes_w, FALSE) AS persisted_user_yes,
    COALESCE(sp.no_w, FALSE) AS persisted_user_no,
    COALESCE(sp.partial_w, FALSE) AS persisted_user_partial,
    COALESCE(sp.blocker_w, FALSE) AS persisted_blocker_captured,
    COALESCE(sp.plan_w, FALSE) AS persisted_plan_signal,
    COALESCE(sp.goal_w, FALSE) AS persisted_goal_or_contract_change,
    to_jsonb(j)->>'status' = 'sent' AS sent_reply
  FROM inbound_rows ir
  LEFT JOIN sms_inbound_coach_jobs j ON j.message_sid = ir.inbound_message_sid
  LEFT JOIN LATERAL (
    SELECT
      BOOL_OR(ev.event_type = 'user_yes') AS yes_w,
      BOOL_OR(ev.event_type = 'user_no') AS no_w,
      BOOL_OR(ev.event_type = 'user_partial') AS partial_w,
      BOOL_OR(ev.event_type = 'blocker_captured') AS blocker_w,
      BOOL_OR(ev.event_type = 'sms_memory_signal' AND ev.payload_json->'memory_signal' IS NOT NULL) AS plan_w,
      BOOL_OR(ev.event_type IN ('contract_overlay_proposed', 'contract_overlay_activated', 'ask_shrunk')) AS goal_w
    FROM v2_commitment_event ev
    WHERE COALESCE(NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''), SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')) = ir.inbound_message_sid
  ) sp ON TRUE
),
diagnosed AS (
  SELECT
    c.*,
    CASE
      WHEN c.candidate_family = 'completion_candidate' AND NOT c.persisted_user_yes THEN 'completion_without_user_yes'
      WHEN c.candidate_family = 'miss_candidate' AND NOT c.persisted_user_no THEN 'miss_without_user_no'
      WHEN c.candidate_family = 'partial_candidate' AND NOT c.persisted_user_partial THEN 'partial_without_user_partial'
      WHEN c.candidate_family = 'meta_process_candidate' AND c.persisted_user_no THEN 'meta_process_written_as_outcome'
      WHEN c.candidate_family IN ('completion_candidate','miss_candidate','partial_candidate') AND (
        (c.candidate_family = 'completion_candidate' AND c.persisted_user_yes)
        OR (c.candidate_family = 'miss_candidate' AND c.persisted_user_no)
        OR (c.candidate_family = 'partial_candidate' AND c.persisted_user_partial)
      ) THEN 'outcome_written_ok'
      ELSE 'manual_review'
    END AS diagnostic
  FROM classified c
)
SELECT
  d.local_day,
  d.candidate_family,
  d.diagnostic,
  COUNT(*) AS inbound_count,
  COUNT(*) FILTER (WHERE d.persisted_user_yes) AS persisted_yes_count,
  COUNT(*) FILTER (WHERE d.persisted_user_no) AS persisted_no_count,
  COUNT(*) FILTER (WHERE d.persisted_user_partial) AS persisted_partial_count,
  COUNT(*) FILTER (WHERE d.persisted_blocker_captured) AS persisted_blocker_count,
  COUNT(*) FILTER (WHERE d.persisted_plan_signal) AS persisted_plan_count,
  COUNT(*) FILTER (WHERE d.persisted_goal_or_contract_change) AS persisted_goal_change_count,
  COUNT(*) FILTER (WHERE d.sent_reply) AS sent_reply_count,
  ARRAY_AGG(DISTINCT d.inbound_body_preview ORDER BY d.inbound_body_preview) FILTER (WHERE d.inbound_body_preview IS NOT NULL) AS examples
FROM diagnosed d
GROUP BY d.local_day, d.candidate_family, d.diagnostic
ORDER BY d.local_day DESC, inbound_count DESC;


-- =============================================================================
-- QUERY 3 — user_yes_certification
-- Completion candidates: substantive completions vs false-positive futures.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
),
rows AS (
  SELECT
    COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''), NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')) AS message_sid,
    COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'clerk_user_id'), ''), NULLIF(BTRIM(to_jsonb(j)->>'clerk_user_id'), '')) AS clerk_user_id,
    COALESCE(NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) AS inbound_at,
    LEFT(COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''), NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''), ''), 280) AS inbound_body_preview,
    LEFT(COALESCE(NULLIF(BTRIM(tm.open_question_text), ''), NULLIF(BTRIM(tm.last_outbound_full_body), ''), ''), 280) AS prior_coach_ask_preview
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j ON j.message_sid = to_jsonb(m)->>'message_sid'
  LEFT JOIN v2_commitment_sms_thread_memory tm ON tm.clerk_user_id = COALESCE(to_jsonb(m)->>'clerk_user_id', to_jsonb(j)->>'clerk_user_id')
  CROSS JOIN bounds b
  WHERE COALESCE(NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) >= b.window_start
    AND COALESCE(NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) < b.window_end
)
SELECT
  r.inbound_at,
  r.clerk_user_id,
  r.message_sid,
  r.inbound_body_preview AS real_body,
  r.prior_coach_ask_preview AS prior_coach_ask,
  tel.relationship_meaning,
  tel.persistence_decision,
  COALESCE(y.user_yes_written, FALSE) AS user_yes_written,
  COALESCE(p.proof_moment, FALSE) AS proof_moment,
  LEFT(COALESCE(to_jsonb(j)->>'reply_body', tel.reply_body_preview, ''), 280) AS next_reply_preview,
  CASE
    WHEN r.inbound_body_preview ~* '(should still be able|going to|plan to|gonna|might hit|hope to)' THEN 'false_positive_future_completion'
    WHEN r.inbound_body_preview ~* '(hit the goal|got my|got in \d|completed|finished|did it|woo\s*hoo|\d+[,]?\d*\s+steps)' AND COALESCE(y.user_yes_written, FALSE) THEN 'substantive_completion_ok'
    WHEN r.inbound_body_preview ~* '(hit the goal|got my|completed|finished|did it)' AND NOT COALESCE(y.user_yes_written, FALSE) THEN 'completion_without_user_yes'
    ELSE 'manual_review'
  END AS diagnostic
FROM rows r
LEFT JOIN sms_inbound_coach_jobs j ON j.message_sid = r.message_sid
LEFT JOIN LATERAL (
  SELECT
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_relationship'), '') AS relationship_meaning,
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_persistence'), '') AS persistence_decision,
    NULLIF(BTRIM(e.payload_json->>'reply_body_preview'), '') AS reply_body_preview
  FROM v2_commitment_event e
  WHERE e.event_type = 'sms_memory_signal' AND e.payload_json->>'inbound_turn_telemetry' = 'true'
    AND COALESCE(NULLIF(BTRIM(e.payload_json->>'message_sid'), ''), SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')) = r.message_sid
  ORDER BY e.occurred_at DESC LIMIT 1
) tel ON TRUE
LEFT JOIN LATERAL (
  SELECT BOOL_OR(ev.event_type = 'user_yes') AS user_yes_written
  FROM v2_commitment_event ev
  WHERE COALESCE(NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''), SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')) = r.message_sid
) y ON TRUE
LEFT JOIN LATERAL (
  SELECT BOOL_OR(COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS proof_moment
  FROM v2_commitment_event ev
  WHERE COALESCE(NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''), SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')) = r.message_sid
    AND ev.event_type = 'user_yes'
) p ON TRUE
WHERE r.inbound_body_preview ~* '(hit\s+(the|my)\s+goal|got\s+my|got\s+in\s+\d|completed|finished|did\s+it|woo\s*hoo|\d{1,3}[,]?\d*\s+steps|distribution done)'
ORDER BY r.inbound_at DESC;


-- =============================================================================
-- QUERY 4 — user_no_certification
-- Miss candidates vs meta/process disputes.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
),
rows AS (
  SELECT
    COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''), NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')) AS message_sid,
    COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'clerk_user_id'), ''), NULLIF(BTRIM(to_jsonb(j)->>'clerk_user_id'), '')) AS clerk_user_id,
    COALESCE(NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) AS inbound_at,
    LEFT(COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''), NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''), ''), 280) AS inbound_body_preview,
    LEFT(COALESCE(NULLIF(BTRIM(tm.open_question_text), ''), ''), 280) AS prior_coach_ask_preview
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j ON j.message_sid = to_jsonb(m)->>'message_sid'
  LEFT JOIN v2_commitment_sms_thread_memory tm ON tm.clerk_user_id = COALESCE(to_jsonb(m)->>'clerk_user_id', to_jsonb(j)->>'clerk_user_id')
  CROSS JOIN bounds b
  WHERE COALESCE(NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) >= b.window_start
    AND COALESCE(NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) < b.window_end
)
SELECT
  r.inbound_at,
  r.clerk_user_id,
  r.inbound_body_preview AS real_body,
  r.prior_coach_ask_preview AS prior_coach_ask,
  tel.relationship_meaning,
  tel.persistence_decision,
  COALESCE(n.user_no_written, FALSE) AS user_no_written,
  COALESCE(p.honest_miss, FALSE) AS proof_moment_honest_miss,
  (
    r.inbound_body_preview ~* '(didn''?t say|never said|didn''?t ask|onboarding matter|why did you ask)'
    AND r.inbound_body_preview !~* '(missed|didn''?t do|didn''?t hit|skipped|failed today)'
  ) AS false_miss_risk,
  CASE
    WHEN r.inbound_body_preview ~* '(didn''?t say|onboarding|didn''?t ask)' AND COALESCE(n.user_no_written, FALSE) THEN 'meta_process_written_as_outcome'
    WHEN r.inbound_body_preview ~* '(missed|didn''?t hit|skipped|didn''?t do|did not get it today)' AND COALESCE(n.user_no_written, FALSE) THEN 'true_miss_ok'
    WHEN r.inbound_body_preview ~* '(missed|didn''?t hit|skipped)' AND NOT COALESCE(n.user_no_written, FALSE) AND tel.persistence_decision = 'write_user_no' THEN 'miss_without_user_no'
    WHEN r.inbound_body_preview ~* '(didn''?t say|onboarding)' AND tel.persistence_decision = 'no_outcome_write' THEN 'no_outcome_expected'
    ELSE 'manual_review'
  END AS diagnostic
FROM rows r
LEFT JOIN LATERAL (
  SELECT
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_relationship'), '') AS relationship_meaning,
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_persistence'), '') AS persistence_decision
  FROM v2_commitment_event e
  WHERE e.event_type = 'sms_memory_signal' AND e.payload_json->>'inbound_turn_telemetry' = 'true'
    AND COALESCE(NULLIF(BTRIM(e.payload_json->>'message_sid'), ''), SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')) = r.message_sid
  ORDER BY e.occurred_at DESC LIMIT 1
) tel ON TRUE
LEFT JOIN LATERAL (
  SELECT BOOL_OR(ev.event_type = 'user_no') AS user_no_written
  FROM v2_commitment_event ev
  WHERE COALESCE(NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''), SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')) = r.message_sid
) n ON TRUE
LEFT JOIN LATERAL (
  SELECT BOOL_OR(ev.payload_json->>'proof_moment_type' = 'honest_miss') AS honest_miss
  FROM v2_commitment_event ev
  WHERE COALESCE(NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''), SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')) = r.message_sid
) p ON TRUE
WHERE r.inbound_body_preview ~* '(missed|didn''?t hit|did not hit|skipped|didn''?t happen|didn''?t do|did not do|did not get it today|didn''?t say|onboarding|didn''?t ask|why did you ask)'
ORDER BY r.inbound_at DESC;


-- =============================================================================
-- QUERY 5 — user_partial_certification
-- Partial-shaped inbound — observe real examples before assuming persist policy.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
),
rows AS (
  SELECT
    COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''), NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')) AS message_sid,
    COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'clerk_user_id'), ''), NULLIF(BTRIM(to_jsonb(j)->>'clerk_user_id'), '')) AS clerk_user_id,
    COALESCE(NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) AS inbound_at,
    LEFT(COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''), NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''), ''), 280) AS inbound_body_preview
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j ON j.message_sid = to_jsonb(m)->>'message_sid'
  CROSS JOIN bounds b
  WHERE COALESCE(NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) >= b.window_start
    AND COALESCE(NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) < b.window_end
)
SELECT
  r.inbound_at,
  r.clerk_user_id,
  r.inbound_body_preview AS real_body,
  tel.relationship_meaning,
  tel.persistence_decision,
  COALESCE(p.partial_written, FALSE) AS user_partial_written,
  COALESCE(pm.proof_moment, FALSE) AS proof_moment,
  CASE
    WHEN r.inbound_body_preview ~* '(did half|only did part|got some of it done|\d[\d,]*\s+of\s+\d[\d,]*|started but)' AND COALESCE(p.partial_written, FALSE) THEN 'partial_ok'
    WHEN r.inbound_body_preview ~* '(did half|only did part|halfway)' AND NOT COALESCE(p.partial_written, FALSE) AND tel.persistence_decision = 'no_outcome_write' THEN 'no_partial_expected'
    WHEN r.inbound_body_preview ~* '(did half|only did part)' AND tel.persistence_decision = 'write_user_partial' AND NOT COALESCE(p.partial_written, FALSE) THEN 'partial_without_user_partial'
    ELSE 'manual_review'
  END AS diagnostic
FROM rows r
LEFT JOIN LATERAL (
  SELECT
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_relationship'), '') AS relationship_meaning,
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_persistence'), '') AS persistence_decision
  FROM v2_commitment_event e
  WHERE e.event_type = 'sms_memory_signal' AND e.payload_json->>'inbound_turn_telemetry' = 'true'
    AND COALESCE(NULLIF(BTRIM(e.payload_json->>'message_sid'), ''), SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')) = r.message_sid
  ORDER BY e.occurred_at DESC LIMIT 1
) tel ON TRUE
LEFT JOIN LATERAL (
  SELECT BOOL_OR(ev.event_type = 'user_partial') AS partial_written
  FROM v2_commitment_event ev
  WHERE COALESCE(NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''), SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')) = r.message_sid
) p ON TRUE
LEFT JOIN LATERAL (
  SELECT BOOL_OR(COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS proof_moment
  FROM v2_commitment_event ev
  WHERE COALESCE(NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''), SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')) = r.message_sid AND ev.event_type = 'user_partial'
) pm ON TRUE
WHERE r.inbound_body_preview ~* '(did half|only did part|halfway|part of it|got some of it done|\d[\d,]*\s+of\s+\d[\d,]*|20 minutes of the hour|started but)'
ORDER BY r.inbound_at DESC;


-- =============================================================================
-- QUERY 6 — plan_memory_certification
-- Plan candidates: memory signal + next daily reference heuristic.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
),
rows AS (
  SELECT
    COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''), NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')) AS message_sid,
    COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'clerk_user_id'), ''), NULLIF(BTRIM(to_jsonb(j)->>'clerk_user_id'), '')) AS clerk_user_id,
    COALESCE(NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) AS inbound_at,
    LEFT(COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''), NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''), ''), 280) AS inbound_body_preview,
    LEFT(COALESCE(NULLIF(BTRIM(tm.open_question_text), ''), ''), 280) AS prior_coach_ask_preview
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j ON j.message_sid = to_jsonb(m)->>'message_sid'
  LEFT JOIN v2_commitment_sms_thread_memory tm ON tm.clerk_user_id = COALESCE(to_jsonb(m)->>'clerk_user_id', to_jsonb(j)->>'clerk_user_id')
  CROSS JOIN bounds b
  WHERE COALESCE(NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) >= b.window_start
    AND COALESCE(NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) < b.window_end
    AND LEFT(COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''), ''), 280) ~* '(i''?ll|i will|plan to|going to|gonna|tomorrow morning|tomorrow night|made a plan)'
)
SELECT
  r.inbound_at,
  r.clerk_user_id,
  r.inbound_body_preview AS real_user_plan_text,
  r.prior_coach_ask_preview AS prior_coach_ask,
  tel.relationship_meaning,
  tel.persistence_decision,
  ms.memory_signal_summary,
  tm.open_question_text AS thread_open_question,
  nd.next_daily_body_preview,
  (
    nd.next_daily_body_preview IS NOT NULL
    AND length(r.inbound_body_preview) > 8
    AND nd.next_daily_body_preview ILIKE '%' || LEFT(regexp_replace(r.inbound_body_preview, '[^a-zA-Z0-9 ]', '', 'g'), 24) || '%'
  ) AS next_daily_references_plan_heuristic,
  CASE
    WHEN ms.memory_signal_summary IS NOT NULL AND nd.next_daily_body_preview IS NOT NULL
      AND nd.next_daily_body_preview ILIKE '%' || LEFT(regexp_replace(r.inbound_body_preview, '[^a-zA-Z0-9 ]', '', 'g'), 20) || '%'
      THEN 'plan_saved_and_used'
    WHEN ms.memory_signal_summary IS NOT NULL THEN 'plan_saved_not_used'
    WHEN tel.persistence_decision = 'no_outcome_write' AND tel.relationship_meaning IN ('plan_made', 'answer_to_prior_question') THEN 'no_plan_expected'
    WHEN ms.memory_signal_summary IS NULL AND r.inbound_body_preview ~* '(plan to|tomorrow)' THEN 'plan_not_saved'
    ELSE 'manual_review'
  END AS diagnostic
FROM rows r
LEFT JOIN v2_commitment_sms_thread_memory tm ON tm.clerk_user_id = r.clerk_user_id
LEFT JOIN LATERAL (
  SELECT
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_relationship'), '') AS relationship_meaning,
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_persistence'), '') AS persistence_decision
  FROM v2_commitment_event e
  WHERE e.event_type = 'sms_memory_signal' AND e.payload_json->>'inbound_turn_telemetry' = 'true'
    AND COALESCE(NULLIF(BTRIM(e.payload_json->>'message_sid'), ''), SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')) = r.message_sid
  ORDER BY e.occurred_at DESC LIMIT 1
) tel ON TRUE
LEFT JOIN LATERAL (
  SELECT NULLIF(BTRIM(e.payload_json->'memory_signal'->>'memory_signal_summary'), '') AS memory_signal_summary
  FROM v2_commitment_event e
  WHERE e.event_type = 'sms_memory_signal'
    AND COALESCE(NULLIF(BTRIM(e.payload_json->>'message_sid'), ''), SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')) = r.message_sid
    AND e.payload_json->'memory_signal' IS NOT NULL
  ORDER BY e.occurred_at DESC LIMIT 1
) ms ON TRUE
LEFT JOIN LATERAL (
  SELECT LEFT(COALESCE(to_jsonb(s)->>'sms_body', to_jsonb(s)#>>'{metadata,sms_body}', ''), 280) AS next_daily_body_preview
  FROM sms_send_events s
  WHERE to_jsonb(s)->>'clerk_user_id' = r.clerk_user_id
    AND NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz > r.inbound_at
  ORDER BY NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz ASC LIMIT 1
) nd ON TRUE
ORDER BY r.inbound_at DESC;


-- =============================================================================
-- QUERY 7 — blocker_certification
-- Blocker candidates: capture row + next daily reference heuristic.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
),
rows AS (
  SELECT
    COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''), NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')) AS message_sid,
    COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'clerk_user_id'), ''), NULLIF(BTRIM(to_jsonb(j)->>'clerk_user_id'), '')) AS clerk_user_id,
    COALESCE(NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) AS inbound_at,
    LEFT(COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''), NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''), ''), 280) AS inbound_body_preview
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j ON j.message_sid = to_jsonb(m)->>'message_sid'
  CROSS JOIN bounds b
  WHERE COALESCE(NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) >= b.window_start
    AND COALESCE(NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) < b.window_end
    AND LEFT(COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''), ''), 280) ~* '(blocker|got in the way|what stopped|couldn''?t because|in the way was|traffic|kids|work)'
)
SELECT
  r.inbound_at,
  r.clerk_user_id,
  r.inbound_body_preview AS real_blocker_text,
  blk.blocker_message,
  blk.blocker_captured_at,
  tel.relationship_meaning,
  tel.persistence_decision,
  nd.next_daily_body_preview,
  (
    nd.next_daily_body_preview IS NOT NULL
    AND blk.blocker_message IS NOT NULL
    AND nd.next_daily_body_preview ILIKE '%' || LEFT(regexp_replace(blk.blocker_message, '[^a-zA-Z0-9 ]', '', 'g'), 20) || '%'
  ) AS next_daily_references_blocker_heuristic,
  CASE
    WHEN blk.blocker_message IS NOT NULL AND nd.next_daily_body_preview ILIKE '%' || LEFT(regexp_replace(blk.blocker_message, '[^a-zA-Z0-9 ]', '', 'g'), 16) || '%' THEN 'blocker_saved_and_used'
    WHEN blk.blocker_message IS NOT NULL THEN 'blocker_saved_not_used'
    WHEN blk.blocker_message IS NULL AND r.inbound_body_preview ~* '(blocker|got in the way)' THEN 'blocker_not_saved'
    ELSE 'manual_review'
  END AS diagnostic
FROM rows r
LEFT JOIN LATERAL (
  SELECT
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_relationship'), '') AS relationship_meaning,
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_persistence'), '') AS persistence_decision
  FROM v2_commitment_event e
  WHERE e.event_type = 'sms_memory_signal' AND e.payload_json->>'inbound_turn_telemetry' = 'true'
    AND COALESCE(NULLIF(BTRIM(e.payload_json->>'message_sid'), ''), SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')) = r.message_sid
  ORDER BY e.occurred_at DESC LIMIT 1
) tel ON TRUE
LEFT JOIN LATERAL (
  SELECT
    NULLIF(BTRIM(ev.payload_json->>'message'), '') AS blocker_message,
    ev.occurred_at AS blocker_captured_at
  FROM v2_commitment_event ev
  WHERE ev.event_type = 'blocker_captured'
    AND COALESCE(NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''), SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')) = r.message_sid
  ORDER BY ev.occurred_at DESC LIMIT 1
) blk ON TRUE
LEFT JOIN LATERAL (
  SELECT LEFT(COALESCE(to_jsonb(s)->>'sms_body', to_jsonb(s)#>>'{metadata,sms_body}', ''), 280) AS next_daily_body_preview
  FROM sms_send_events s
  WHERE to_jsonb(s)->>'clerk_user_id' = r.clerk_user_id
    AND NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz > r.inbound_at
  ORDER BY NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz ASC LIMIT 1
) nd ON TRUE
ORDER BY r.inbound_at DESC;


-- =============================================================================
-- QUERY 8 — goal_change_raise_lower_certification
-- Goal/contract change candidates vs pending resolution + overlay events.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
),
rows AS (
  SELECT
    COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''), NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')) AS message_sid,
    COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'clerk_user_id'), ''), NULLIF(BTRIM(to_jsonb(j)->>'clerk_user_id'), '')) AS clerk_user_id,
    COALESCE(NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) AS inbound_at,
    LEFT(COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''), NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''), ''), 280) AS inbound_body_preview
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j ON j.message_sid = to_jsonb(m)->>'message_sid'
  CROSS JOIN bounds b
  WHERE COALESCE(NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) >= b.window_start
    AND COALESCE(NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) < b.window_end
    AND LEFT(COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''), ''), 280) ~* '(change my goal|raise the bar|lower the bar|shrink|make it easier|too easy|too hard|miles instead of|new goal|different goal)'
)
SELECT
  r.inbound_at,
  r.clerk_user_id,
  r.inbound_body_preview AS real_body,
  tel.relationship_meaning,
  tel.persistence_decision,
  c.behavior_statement_before,
  c.pending_resolution_kind,
  c.adaptive_ask_text,
  ev.contract_events_json,
  nd.next_sms_preview,
  CASE
    WHEN ev.contract_event_count > 0 AND (c.pending_resolution_kind IS NOT NULL OR c.adaptive_ask_text IS NOT NULL) THEN 'change_detected_and_state_updated'
    WHEN c.pending_resolution_kind IS NOT NULL AND ev.contract_event_count = 0 THEN 'pending_resolution_created'
    WHEN ev.contract_event_count = 0 AND r.inbound_body_preview ~* '(change my goal|lower the bar)' THEN 'change_candidate_without_state_event'
    WHEN tel.relationship_meaning IN ('support_request', 'question') THEN 'false_change_candidate'
    ELSE 'manual_review'
  END AS diagnostic
FROM rows r
LEFT JOIN LATERAL (
  SELECT
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_relationship'), '') AS relationship_meaning,
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_persistence'), '') AS persistence_decision
  FROM v2_commitment_event e
  WHERE e.event_type = 'sms_memory_signal' AND e.payload_json->>'inbound_turn_telemetry' = 'true'
    AND COALESCE(NULLIF(BTRIM(e.payload_json->>'message_sid'), ''), SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')) = r.message_sid
  ORDER BY e.occurred_at DESC LIMIT 1
) tel ON TRUE
LEFT JOIN LATERAL (
  SELECT
    NULLIF(BTRIM(to_jsonb(c)->>'behavior_statement'), '') AS behavior_statement_before,
    NULLIF(BTRIM(to_jsonb(c)->>'pending_resolution_kind'), '') AS pending_resolution_kind,
    NULLIF(BTRIM(to_jsonb(c)->>'adaptive_ask_text'), '') AS adaptive_ask_text
  FROM v2_commitment c
  WHERE to_jsonb(c)->>'clerk_user_id' = r.clerk_user_id
    AND to_jsonb(c)->>'status' = 'active'
  ORDER BY NULLIF(to_jsonb(c)->>'updated_at', '')::timestamptz DESC NULLS LAST
  LIMIT 1
) c ON TRUE
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS contract_event_count,
    jsonb_agg(jsonb_build_object('event_type', ev.event_type, 'occurred_at', ev.occurred_at, 'payload', ev.payload_json) ORDER BY ev.occurred_at) AS contract_events_json
  FROM v2_commitment_event ev
  WHERE COALESCE(NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''), SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')) = r.message_sid
    AND ev.event_type IN ('contract_overlay_proposed', 'contract_overlay_activated', 'contract_overlay_declined', 'ask_shrunk', 'coaching_refresh_prompted', 'coaching_refresh_resolved', 'created', 'superseded')
) ev ON TRUE
LEFT JOIN LATERAL (
  SELECT LEFT(COALESCE(to_jsonb(s)->>'sms_body', to_jsonb(s)#>>'{metadata,sms_body}', ''), 280) AS next_sms_preview
  FROM sms_send_events s
  WHERE to_jsonb(s)->>'clerk_user_id' = r.clerk_user_id
    AND NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz > r.inbound_at
  ORDER BY NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz ASC LIMIT 1
) nd ON TRUE
ORDER BY r.inbound_at DESC;


-- =============================================================================
-- QUERY 9 — victory_room_projection_certification
-- Spine truth rows → Victory Room displayability (loader reads proof_moment*).
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
),
spine AS (
  SELECT
    ev.occurred_at,
    ev.clerk_user_id,
    ev.commitment_id,
    ev.event_type,
    ev.id AS event_id,
    COALESCE(
      NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''),
      SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) AS message_sid,
    LEFT(COALESCE(
      ev.payload_json->>'message',
      ev.payload_json->>'message_preview',
      ev.payload_json->>'raw_body_preview',
      ''
    ), 280) AS inbound_body_preview,
    COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE) AS proof_moment,
    ev.payload_json->>'proof_moment_type' AS proof_moment_type,
    LEFT(COALESCE(
      ev.payload_json->>'user_visible_proof_line',
      ev.payload_json->>'proof_meaning_line',
      ''
    ), 220) AS user_visible_proof_line,
    ev.payload_json->>'proof_meaning_line' AS proof_meaning_line,
    COALESCE((ev.payload_json->>'can_reference_victory_room')::boolean, FALSE) AS can_reference_victory_room,
    COALESCE((ev.payload_json->>'season_lifecycle')::boolean, FALSE) AS season_lifecycle,
    COALESCE((ev.payload_json->>'exclude_from_proof_curation')::boolean, FALSE) AS exclude_from_proof_curation,
    to_jsonb(ev.payload_json) AS raw_payload_json
  FROM v2_commitment_event ev
  CROSS JOIN bounds b
  WHERE ev.occurred_at >= b.window_start
    AND ev.occurred_at < b.window_end
    AND ev.event_type IN (
      'user_yes', 'user_no', 'user_partial', 'blocker_captured',
      'contract_overlay_proposed', 'contract_overlay_activated', 'contract_overlay_declined',
      'sms_memory_signal', 'ask_shrunk', 'coaching_refresh_resolved'
    )
)
SELECT
  s.occurred_at,
  s.clerk_user_id,
  s.commitment_id,
  s.event_type,
  s.message_sid,
  s.inbound_body_preview,
  s.proof_moment,
  s.proof_moment_type,
  s.user_visible_proof_line,
  s.proof_meaning_line,
  s.can_reference_victory_room,
  (
    s.proof_moment
    AND COALESCE(s.user_visible_proof_line, '') <> ''
    AND NOT s.season_lifecycle
    AND NOT s.exclude_from_proof_curation
    AND COALESCE(s.proof_moment_type, '') NOT IN ('memory_updated')
    AND s.inbound_body_preview !~* '(onboarding|didn''?t ask me)'
  ) AS likely_victory_room_display_candidate,
  CASE
    WHEN NOT s.proof_moment AND s.event_type IN ('user_yes', 'user_no', 'user_partial') THEN 'outcome_without_displayable_proof'
    WHEN s.proof_moment AND s.inbound_body_preview ~* '(onboarding|didn''?t ask)' THEN 'fake_or_suspect_proof'
    WHEN s.proof_moment AND COALESCE(s.user_visible_proof_line, '') = '' THEN 'proof_missing_display_line'
    WHEN s.season_lifecycle OR s.exclude_from_proof_curation THEN 'non_proof_expected'
    WHEN s.proof_moment AND COALESCE(s.user_visible_proof_line, '') <> '' THEN 'real_proof_displayable'
    ELSE 'manual_review'
  END AS reason_if_not_display_candidate,
  CASE
    WHEN s.proof_moment AND COALESCE(s.user_visible_proof_line, '') <> '' AND NOT s.season_lifecycle THEN 'real_proof_displayable'
    WHEN NOT s.proof_moment AND s.event_type IN ('contract_overlay_proposed', 'sms_memory_signal') THEN 'non_proof_expected'
    WHEN s.proof_moment AND s.inbound_body_preview ~* '(onboarding|didn''?t ask)' THEN 'fake_or_suspect_proof'
    WHEN NOT s.proof_moment AND s.event_type IN ('user_yes','user_no','user_partial') THEN 'outcome_without_displayable_proof'
    ELSE 'manual_review'
  END AS diagnostic,
  s.raw_payload_json
FROM spine s
ORDER BY s.occurred_at DESC, s.clerk_user_id;


-- =============================================================================
-- QUERY 10 — next_sms_truth_usage_certification
-- Did the next outbound SMS use or contradict persisted truth?
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
),
truth_events AS (
  SELECT
    ev.occurred_at AS truth_at,
    ev.clerk_user_id,
    ev.event_type AS truth_event_type,
    COALESCE(
      NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''),
      SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) AS message_sid,
    LEFT(COALESCE(ev.payload_json->>'message', ev.payload_json->>'message_preview', ''), 280) AS inbound_body_preview
  FROM v2_commitment_event ev
  CROSS JOIN bounds b
  WHERE ev.occurred_at >= b.window_start
    AND ev.occurred_at < b.window_end
    AND ev.event_type IN ('user_yes', 'user_no', 'user_partial', 'blocker_captured', 'contract_overlay_activated', 'ask_shrunk')
),
paired AS (
  SELECT
    t.*,
    nd.next_outbound_at,
    nd.next_outbound_body_preview,
    nd.next_outbound_status
  FROM truth_events t
  LEFT JOIN LATERAL (
    SELECT
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz AS next_outbound_at,
      LEFT(COALESCE(to_jsonb(s)->>'sms_body', to_jsonb(s)#>>'{metadata,sms_body}', ''), 280) AS next_outbound_body_preview,
      to_jsonb(s)->>'status' AS next_outbound_status
    FROM sms_send_events s
    WHERE to_jsonb(s)->>'clerk_user_id' = t.clerk_user_id
      AND NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz > t.truth_at
    ORDER BY NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz ASC
    LIMIT 1
  ) nd ON TRUE
)
SELECT
  p.truth_at,
  p.clerk_user_id,
  p.message_sid,
  p.inbound_body_preview AS inbound_body,
  p.truth_event_type AS truth_event_written,
  p.next_outbound_body_preview AS next_outbound_sms_body,
  p.next_outbound_status,
  (
    p.truth_event_type = 'user_yes'
    AND p.next_outbound_body_preview ~* '(nice|good|got it|completed|well done|proud)'
  ) AS appears_to_acknowledge_completion,
  (
    p.truth_event_type = 'user_no'
    AND p.next_outbound_body_preview ~* '(missed|didn''?t|couple missed|few missed|two missed)'
    AND p.inbound_body_preview !~* '(missed|didn''?t)'
  ) AS appears_to_contradict_miss_truth,
  (
    p.truth_event_type = 'blocker_captured'
    AND p.next_outbound_body_preview ILIKE '%' || LEFT(regexp_replace(p.inbound_body_preview, '[^a-zA-Z0-9 ]', '', 'g'), 16) || '%'
  ) AS appears_to_reference_blocker,
  CASE
    WHEN p.next_outbound_body_preview IS NULL THEN 'no_next_sms_yet'
    WHEN p.truth_event_type = 'user_yes' AND p.next_outbound_body_preview ~* '(missed|didn''?t hit)' THEN 'next_sms_contradicts_truth'
    WHEN p.truth_event_type = 'user_no' AND p.next_outbound_body_preview ~* '(great job|completed every|perfect)' THEN 'next_sms_contradicts_truth'
    WHEN p.truth_event_type IN ('user_yes','user_no','user_partial') AND p.next_outbound_body_preview ~* '(did you|get it done|hit the goal)' AND p.truth_at::date = p.next_outbound_at::date THEN 'next_sms_repeats_stale_ask'
    WHEN p.next_outbound_body_preview IS NOT NULL THEN 'next_sms_uses_truth'
    ELSE 'manual_review'
  END AS diagnostic
FROM paired p
ORDER BY p.truth_at DESC;


-- =============================================================================
-- QUERY 11 — no_send_truth_loss_certification
-- Important truth statements when inbound reply did not send visibly.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
),
inbound AS (
  SELECT
    COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''), NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')) AS message_sid,
    COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'clerk_user_id'), ''), NULLIF(BTRIM(to_jsonb(j)->>'clerk_user_id'), '')) AS clerk_user_id,
    COALESCE(NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) AS inbound_at,
    LEFT(COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''), NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''), ''), 280) AS inbound_body_preview,
    to_jsonb(j)->>'status' AS job_status,
    LEFT(COALESCE(NULLIF(BTRIM(to_jsonb(j)->>'reply_body'), ''), ''), 280) AS reply_body_preview
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j ON j.message_sid = to_jsonb(m)->>'message_sid'
  CROSS JOIN bounds b
  WHERE COALESCE(NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) >= b.window_start
    AND COALESCE(NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) < b.window_end
)
SELECT
  i.inbound_at,
  i.clerk_user_id,
  i.message_sid,
  i.inbound_body_preview,
  i.job_status,
  COALESCE(
    tel.no_send_reason,
    tel.unified_final_guard_no_send_reason,
    tel.final_voice_gate_skip_reason,
    ''
  ) AS no_send_reason,
  COALESCE(truth.any_truth_row, FALSE) AS truth_row_persisted,
  truth.truth_event_types,
  tel.persistence_decision,
  CASE
    WHEN i.inbound_body_preview ~* '(hit the goal|got my|missed|didn''?t hit|did half|blocker|change my goal)'
      AND COALESCE(truth.any_truth_row, FALSE) AND (i.job_status IS DISTINCT FROM 'sent' OR i.job_status IS NULL)
      THEN 'truth_persisted_despite_no_send'
    WHEN i.inbound_body_preview ~* '(hit the goal|got my|missed|didn''?t hit)'
      AND NOT COALESCE(truth.any_truth_row, FALSE)
      AND tel.persistence_decision IN ('write_user_yes_today', 'write_user_no', 'write_user_partial')
      THEN 'truth_lost_due_to_no_send'
    WHEN tel.persistence_decision = 'no_outcome_write' AND NOT COALESCE(truth.any_truth_row, FALSE) THEN 'no_truth_expected'
    ELSE 'manual_review'
  END AS diagnostic
FROM inbound i
LEFT JOIN LATERAL (
  SELECT
    NULLIF(BTRIM(e.payload_json->>'no_send_reason'), '') AS no_send_reason,
    NULLIF(BTRIM(e.payload_json->>'unified_final_guard_no_send_reason'), '') AS unified_final_guard_no_send_reason,
    NULLIF(BTRIM(e.payload_json->>'final_voice_gate_skip_reason'), '') AS final_voice_gate_skip_reason,
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_persistence'), '') AS persistence_decision
  FROM v2_commitment_event e
  WHERE e.event_type = 'sms_memory_signal'
    AND e.payload_json->>'inbound_turn_telemetry' = 'true'
    AND COALESCE(NULLIF(BTRIM(e.payload_json->>'message_sid'), ''), SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')) = i.message_sid
  ORDER BY e.occurred_at DESC LIMIT 1
) tel ON TRUE
LEFT JOIN LATERAL (
  SELECT
    BOOL_OR(ev.event_type IN ('user_yes','user_no','user_partial','blocker_captured')) AS any_truth_row,
    string_agg(DISTINCT ev.event_type, ', ' ORDER BY ev.event_type) AS truth_event_types
  FROM v2_commitment_event ev
  WHERE COALESCE(NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''), SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')) = i.message_sid
) truth ON TRUE
WHERE i.inbound_body_preview ~* '(hit the goal|got my|missed|didn''?t|did half|blocker|change my goal|onboarding)'
  AND (i.job_status IS DISTINCT FROM 'sent' OR tel.no_send_reason IS NOT NULL)
ORDER BY i.inbound_at DESC;


-- =============================================================================
-- QUERY 12 — certification_scoreboard
-- Roll up mismatch rates by candidate family (start here).
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
),
inbound_rows AS (
  SELECT
    COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''), NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')) AS inbound_message_sid,
    LEFT(COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''), NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''), ''), 280) AS inbound_body_preview,
    CASE
      WHEN LEFT(COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''), ''), 280) ~* '(onboarding|didn''?t ask)' THEN 'meta_process_candidate'
      WHEN LEFT(COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''), ''), 280) ~* '(change my goal|lower the bar|raise the bar)' THEN 'goal_change_candidate'
      WHEN LEFT(COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''), ''), 280) ~* '(blocker|got in the way)' THEN 'blocker_candidate'
      WHEN LEFT(COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''), ''), 280) ~* '(i''?ll|plan to|tomorrow)' THEN 'plan_candidate'
      WHEN LEFT(COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''), ''), 280) ~* '(did half|halfway|\d+\s+of\s+\d+)' THEN 'partial_candidate'
      WHEN LEFT(COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''), ''), 280) ~* '(missed|didn''?t hit|skipped)' THEN 'miss_candidate'
      WHEN LEFT(COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''), ''), 280) ~* '(hit the goal|got my|completed|finished|did it)' THEN 'completion_candidate'
      ELSE 'other'
    END AS candidate_family
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j ON j.message_sid = to_jsonb(m)->>'message_sid'
  CROSS JOIN bounds b
  WHERE COALESCE(NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) >= b.window_start
    AND COALESCE(NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) < b.window_end
),
scored AS (
  SELECT
    ir.candidate_family,
    ir.inbound_body_preview,
    CASE
      WHEN ir.candidate_family = 'completion_candidate' AND NOT COALESCE(sp.yes_w, FALSE) THEN 'mismatch'
      WHEN ir.candidate_family = 'miss_candidate' AND NOT COALESCE(sp.no_w, FALSE) AND ir.inbound_body_preview !~* '(didn''?t say|onboarding)' THEN 'mismatch'
      WHEN ir.candidate_family = 'meta_process_candidate' AND COALESCE(sp.no_w, FALSE) THEN 'mismatch'
      WHEN ir.candidate_family IN ('completion_candidate','miss_candidate','partial_candidate')
        AND (
          (ir.candidate_family = 'completion_candidate' AND COALESCE(sp.yes_w, FALSE))
          OR (ir.candidate_family = 'miss_candidate' AND COALESCE(sp.no_w, FALSE))
          OR (ir.candidate_family = 'partial_candidate' AND COALESCE(sp.partial_w, FALSE))
        ) THEN 'ok'
      WHEN ir.candidate_family IN ('meta_process_candidate','other','plan_candidate') THEN 'manual_review'
      ELSE 'manual_review'
    END AS score_bucket
  FROM inbound_rows ir
  LEFT JOIN LATERAL (
    SELECT
      BOOL_OR(ev.event_type = 'user_yes') AS yes_w,
      BOOL_OR(ev.event_type = 'user_no') AS no_w,
      BOOL_OR(ev.event_type = 'user_partial') AS partial_w
    FROM v2_commitment_event ev
    WHERE COALESCE(NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''), SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')) = ir.inbound_message_sid
  ) sp ON TRUE
)
SELECT
  s.candidate_family,
  COUNT(*) AS total_candidates,
  COUNT(*) FILTER (WHERE s.score_bucket = 'ok') AS ok_count,
  COUNT(*) FILTER (WHERE s.score_bucket = 'mismatch') AS mismatch_count,
  COUNT(*) FILTER (WHERE s.score_bucket = 'manual_review') AS manual_review_count,
  ROUND(100.0 * COUNT(*) FILTER (WHERE s.score_bucket = 'mismatch') / NULLIF(COUNT(*), 0), 2) AS mismatch_rate_pct,
  (
    SELECT ARRAY_AGG(ex.inbound_body_preview ORDER BY ex.inbound_body_preview)
    FROM (
      SELECT DISTINCT s2.inbound_body_preview
      FROM scored s2
      WHERE s2.candidate_family = s.candidate_family AND s2.score_bucket = 'mismatch'
      LIMIT 5
    ) ex
  ) AS top_mismatch_examples
FROM scored s
GROUP BY s.candidate_family
ORDER BY mismatch_count DESC NULLS LAST, total_candidates DESC;

