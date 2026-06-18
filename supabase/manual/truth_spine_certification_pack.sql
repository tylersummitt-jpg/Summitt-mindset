-- =============================================================================
-- TRUTH SPINE CERTIFICATION PACK v1.1 (read-only, current-code-aware)
-- =============================================================================
-- Compare real SMS threads to real persisted system truth.
-- SELECT-only. All users. Bounded window. No mutations.
--
-- =============================================================================
-- CHANGE THESE BEFORE RUNNING A NEW CERTIFICATION (edit bounds CTE in each query)
-- =============================================================================
-- window_start:           default post-fix 2026-06-17 00:00 America/New_York
-- window_end:             default post-fix 2026-06-20 00:00 America/New_York exclusive
-- known_fix_cutover_at_user_yes:
-- known_fix_cutover_at_meta_process:
-- known_fix_cutover_at_weekly_miss_count:
--
-- Historical wider window example (pre+post fix comparison):
--   window_start: timestamptz '2026-06-11 00:00:00 America/New_York'
--   window_end:   timestamptz '2026-06-18 00:00:00 America/New_York'
--
-- Important:
--   Do NOT call pre-fix rows current bugs.
--   Use pre-fix rows as historical certification fixtures only.
--   For current-code certification, run a post-fix window first.
--
-- Recommended run order (see TRUTH_SPINE_CERTIFICATION_SQL_GUIDE.md):
--   12 certification_scoreboard
--   13 Q13_known_fixture_drilldown
--    1 master_thread_truth_reconciliation
--    2 outcome_candidate_gap_rollup
--    3-11 specialty queries
--
-- Shared pattern: bounds → inbound_base → classified_inbound
-- Schema-safe: to_jsonb(m|j|s|w|c) for drift-prone columns.
-- =============================================================================

-- =============================================================================
-- QUERY 1 — master_thread_truth_reconciliation
-- Film room: one row per inbound SMS.
-- Current failures only:
-- WHERE cert_diagnostic IN ('current_code_failure_candidate','expected_write_but_missing','false_outcome_written')
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_user_yes,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_meta_process,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_weekly_miss_count
),
inbound_base AS (
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
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
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
    ) AS inbound_body_preview,
    to_jsonb(m) AS raw_inbound_json,
    to_jsonb(j) AS raw_job_json
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j
    ON j.message_sid = to_jsonb(m)->>'message_sid'
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) < b.window_end
    AND COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')
    ) IS NOT NULL
),
classified_inbound AS (
  SELECT
    ib.inbound_message_sid,
    ib.clerk_user_id,
    ib.inbound_at,
    (ib.inbound_at AT TIME ZONE 'America/New_York')::date AS local_day,
    ib.inbound_body_preview,
    ib.raw_inbound_json,
    ib.raw_job_json,
    CASE
      WHEN ib.inbound_body_preview ~* '(^|\s)(stop|unsubscribe|help|start)\b' THEN 'safety_or_support_candidate'
      WHEN ib.inbound_body_preview ~* '(onboarding|didn''?t ask me|did not ask me|did the onboarding matter|you didn''?t ask|coach forgot|process dispute|you said.*didn''?t)' THEN 'meta_process_candidate'
      WHEN ib.inbound_body_preview ~* '(change my goal|lower the bar|raise the bar|shrink|replace.*goal|adjust my goal)' THEN 'goal_change_candidate'
      WHEN ib.inbound_body_preview ~* '(got in the way|threw me off|blocker|rain|meetings|forgot my shoes|travel|sick|kids)' THEN 'blocker_candidate'
      WHEN ib.inbound_body_preview ~* '(i''?ll|i will|tomorrow|before breakfast|after work|setting my shoes|planning to|going to run|gonna run)' THEN 'plan_candidate'
      WHEN ib.inbound_body_preview ~* '(only did|half|started but didn''?t|did \d+ of \d+|some of it|part of it)' THEN 'partial_candidate'
      WHEN ib.inbound_body_preview ~* '(missed|didn''?t happen|did not happen|skipped|couldn''?t get|no run today|blew it|didn''?t hit)'
        AND ib.inbound_body_preview !~* '(didn''?t ask|onboarding matter)' THEN 'miss_candidate'
      WHEN ib.inbound_body_preview ~* '(got my|got it done|hit the goal|completed|finished|got my run in|ran this morning|miles done|steps today|knocked out|done this morning|did it)'
        AND ib.inbound_body_preview !~* '(should still|going to|tomorrow|plan to|gonna)' THEN 'completion_candidate'
      WHEN ib.inbound_body_preview ~* '(discouraged|struggling|overwhelmed|anxious|depressed|frustrated)' THEN 'emotional_state_candidate'
      WHEN ib.inbound_body_preview ~* '(my (wife|husband|mom|dad|daughter|son)|important person|identity)' THEN 'important_memory_candidate'
      ELSE 'other'
    END AS candidate_family,
    CASE
      WHEN ib.inbound_at < LEAST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= GREATEST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS fix_era,
    CASE
      WHEN ib.inbound_at < b.known_fix_cutover_at_user_yes THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= b.known_fix_cutover_at_user_yes THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS user_yes_fix_era,
    CASE
      WHEN ib.inbound_at < b.known_fix_cutover_at_meta_process THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= b.known_fix_cutover_at_meta_process THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS meta_process_fix_era,
    CASE
      WHEN ib.inbound_body_preview ILIKE '%got my distribution done today%' AND ib.inbound_body_preview ILIKE '%hit the goal%' THEN 'distribution_completion'
      WHEN ib.inbound_body_preview ~* '10[,]?000 steps today' THEN 'steps_completion'
      WHEN ib.inbound_body_preview ILIKE '%onboarding%' AND ib.inbound_body_preview ~* 'didn''?t ask' THEN 'onboarding_meta_dispute'
      WHEN ib.inbound_body_preview ~* '(going to run tomorrow|tomorrow i''?ll get it done)' THEN 'future_plan_negative'
      ELSE NULL
    END AS is_known_historical_fixture,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_relationship'), ''),
      NULLIF(BTRIM(tel.payload_json->>'turn_understanding_relationship_meaning'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning'->>'relationship_meaning'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning_facts'->>'relationship_meaning'), '')
    ) AS relationship_meaning,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning'->>'persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning_facts'->>'persistence_decision'), '')
    ) AS persistence_decision,
    NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), '') AS server_reconciled_persistence_decision,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'outcome_persist_skip_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->>'turn_understanding_persist_skip_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->'turn_understanding_persist_guard'->>'guard_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->>'outcome_persist_skip_reason_before_no_send'), '')
    ) AS persist_skip_reason,
    NULLIF(BTRIM(tel.payload_json->>'openai_turn_understanding_version'), '') AS prod_code_version,
    to_jsonb(tel.payload_json) AS raw_telemetry_json,
    COALESCE(sp.persisted_user_yes, FALSE) AS persisted_user_yes,
    COALESCE(sp.persisted_user_no, FALSE) AS persisted_user_no,
    COALESCE(sp.persisted_user_partial, FALSE) AS persisted_user_partial,
    COALESCE(sp.persisted_blocker, FALSE) AS persisted_blocker,
    COALESCE(sp.persisted_plan_signal, FALSE) AS persisted_plan_signal,
    COALESCE(sp.persisted_goal_change, FALSE) AS persisted_goal_change,
    COALESCE(sp.persisted_proof_moment, FALSE) AS persisted_proof_moment,
    COALESCE(sp.persisted_user_visible_proof_line, FALSE) AS persisted_user_visible_proof_line,
    sp.persisted_proof_moment_type,
    sp.persisted_outcome_event_types,
    sp.persisted_event_ids,
  CASE
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IN ('write_user_yes_today') THEN 'write_user_yes'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) = 'write_user_no' THEN 'write_user_no'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) = 'write_user_partial' THEN 'write_user_partial'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IN ('no_outcome_write', 'ack_only', 'defer_to_pending_resolution', 'defer_to_contract_consent') THEN 'no_outcome_write'
    WHEN ib.inbound_body_preview ~* '(onboarding|didn''?t ask me|did the onboarding matter)' THEN 'no_outcome_write'
    WHEN ib.inbound_body_preview ~* '(i''?ll|i will|tomorrow|going to run|planning to)' THEN 'no_outcome_write'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IS NULL THEN 'unknown'
    ELSE 'unknown'
  END AS expected_persistence_decision
  FROM inbound_base ib
  CROSS JOIN bounds b
  LEFT JOIN LATERAL (
    SELECT e.payload_json
    FROM v2_commitment_event e
    WHERE e.event_type = 'sms_memory_signal'
      AND e.payload_json->>'inbound_turn_telemetry' = 'true'
      AND COALESCE(
        NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
        SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
      ) = ib.inbound_message_sid
    ORDER BY e.occurred_at DESC
    LIMIT 1
  ) tel ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      BOOL_OR(ev.event_type = 'user_yes') AS persisted_user_yes,
      BOOL_OR(ev.event_type = 'user_no') AS persisted_user_no,
      BOOL_OR(ev.event_type = 'user_partial') AS persisted_user_partial,
      BOOL_OR(ev.event_type = 'blocker_captured') AS persisted_blocker,
      BOOL_OR(
        ev.event_type = 'sms_memory_signal'
        AND ev.payload_json->'memory_signal' IS NOT NULL
        AND COALESCE(ev.payload_json->'memory_signal'->>'memory_signal_detected', 'false') = 'true'
      ) AS persisted_plan_signal,
      BOOL_OR(ev.event_type IN ('contract_overlay_proposed', 'contract_overlay_activated', 'ask_shrunk')) AS persisted_goal_change,
      BOOL_OR(COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS persisted_proof_moment,
      BOOL_OR(COALESCE(ev.payload_json->>'user_visible_proof_line', '') <> '') AS persisted_user_visible_proof_line,
      MAX(ev.payload_json->>'proof_moment_type') FILTER (WHERE COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS persisted_proof_moment_type,
      ARRAY_AGG(DISTINCT ev.event_type ORDER BY ev.event_type) FILTER (WHERE ev.event_type IN ('user_yes', 'user_no', 'user_partial')) AS persisted_outcome_event_types,
      ARRAY_AGG(ev.id ORDER BY ev.occurred_at) FILTER (WHERE ev.event_type IN ('user_yes', 'user_no', 'user_partial')) AS persisted_event_ids
    FROM v2_commitment_event ev
    WHERE COALESCE(
      NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(ev.payload_json->>'inbound_resolution_message_sid'), ''),
      SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) = ib.inbound_message_sid
  ) sp ON TRUE
),
classified_with_diag AS (
  SELECT
    c.*,
    CASE
      WHEN c.fix_era = 'pre_known_fix_window' AND c.is_known_historical_fixture IS NOT NULL THEN 'historical_pre_fix_observation'
      WHEN c.candidate_family IN ('meta_process_candidate', 'plan_candidate', 'safety_or_support_candidate')
        AND (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'false_outcome_written'
      WHEN c.persistence_decision IS NULL AND c.server_reconciled_persistence_decision IS NULL
        AND c.candidate_family NOT IN ('other', 'emotional_state_candidate', 'important_memory_candidate') THEN 'telemetry_missing'
      WHEN c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision IN ('write_user_yes', 'write_user_no', 'write_user_partial')
        AND c.fix_era = 'post_known_fix_window'
        AND c.is_known_historical_fixture IS NOT NULL
        AND NOT (
          (c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes)
          OR (c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no)
          OR (c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial)
        ) THEN 'current_code_failure_candidate'
      WHEN c.expected_persistence_decision IN ('write_user_yes', 'write_user_no', 'write_user_partial')
        AND c.fix_era = 'post_known_fix_window'
        AND NOT (
          (c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes)
          OR (c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no)
          OR (c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial)
        ) THEN 'expected_write_but_missing'
      WHEN c.expected_persistence_decision = 'no_outcome_write'
        AND NOT (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'server_no_outcome_expected'
      WHEN c.expected_persistence_decision = 'no_outcome_write'
        AND NOT (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'expected_no_write_and_none_written'
      WHEN c.candidate_family = 'other' THEN 'regex_weak_manual_review'
      WHEN c.expected_persistence_decision = 'unknown' THEN 'cert_join_uncertain'
      ELSE 'cert_join_uncertain'
    END AS cert_diagnostic,
    CASE
      WHEN c.candidate_family = 'other' THEN 'regex_family_uncertain_review_body'
      WHEN c.persistence_decision IS NULL AND c.server_reconciled_persistence_decision IS NULL THEN 'missing_turn_telemetry'
      WHEN c.candidate_family = 'plan_candidate' THEN 'plan_manual_review_expected_no_outcome_proof'
      ELSE NULL
    END AS needs_human_review_reason
  FROM classified_inbound c
)
SELECT
  c.local_day,
  c.inbound_at,
  c.clerk_user_id,
  c.inbound_message_sid,
  c.inbound_body_preview,
  c.fix_era,
  c.candidate_family,
  c.is_known_historical_fixture,
  c.relationship_meaning,
  c.persistence_decision,
  c.server_reconciled_persistence_decision,
  c.expected_persistence_decision,
  c.cert_diagnostic,
  c.needs_human_review_reason,
  c.persisted_user_yes,
  c.persisted_user_no,
  c.persisted_user_partial,
  c.persisted_blocker,
  c.persisted_plan_signal,
  c.persisted_goal_change,
  c.persisted_proof_moment,
  c.persisted_user_visible_proof_line,
  c.persisted_proof_moment_type,
  c.persist_skip_reason,
  c.prod_code_version,
  to_jsonb(c.raw_job_json)->>'status' AS next_coach_reply_status,
  LEFT(COALESCE(NULLIF(BTRIM(to_jsonb(c.raw_job_json)->>'reply_body'), ''), ''), 280) AS next_coach_reply_preview,
  c.persisted_outcome_event_types,
  c.persisted_event_ids,
  c.raw_telemetry_json
FROM classified_with_diag c
ORDER BY c.inbound_at DESC, c.clerk_user_id;



-- =============================================================================
-- QUERY 2 — outcome_candidate_gap_rollup
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_user_yes,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_meta_process,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_weekly_miss_count
),
inbound_base AS (
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
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
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
    ) AS inbound_body_preview,
    to_jsonb(m) AS raw_inbound_json,
    to_jsonb(j) AS raw_job_json
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j
    ON j.message_sid = to_jsonb(m)->>'message_sid'
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) < b.window_end
    AND COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')
    ) IS NOT NULL
),
classified_inbound AS (
  SELECT
    ib.inbound_message_sid,
    ib.clerk_user_id,
    ib.inbound_at,
    (ib.inbound_at AT TIME ZONE 'America/New_York')::date AS local_day,
    ib.inbound_body_preview,
    ib.raw_inbound_json,
    ib.raw_job_json,
    CASE
      WHEN ib.inbound_body_preview ~* '(^|\s)(stop|unsubscribe|help|start)\b' THEN 'safety_or_support_candidate'
      WHEN ib.inbound_body_preview ~* '(onboarding|didn''?t ask me|did not ask me|did the onboarding matter|you didn''?t ask|coach forgot|process dispute|you said.*didn''?t)' THEN 'meta_process_candidate'
      WHEN ib.inbound_body_preview ~* '(change my goal|lower the bar|raise the bar|shrink|replace.*goal|adjust my goal)' THEN 'goal_change_candidate'
      WHEN ib.inbound_body_preview ~* '(got in the way|threw me off|blocker|rain|meetings|forgot my shoes|travel|sick|kids)' THEN 'blocker_candidate'
      WHEN ib.inbound_body_preview ~* '(i''?ll|i will|tomorrow|before breakfast|after work|setting my shoes|planning to|going to run|gonna run)' THEN 'plan_candidate'
      WHEN ib.inbound_body_preview ~* '(only did|half|started but didn''?t|did \d+ of \d+|some of it|part of it)' THEN 'partial_candidate'
      WHEN ib.inbound_body_preview ~* '(missed|didn''?t happen|did not happen|skipped|couldn''?t get|no run today|blew it|didn''?t hit)'
        AND ib.inbound_body_preview !~* '(didn''?t ask|onboarding matter)' THEN 'miss_candidate'
      WHEN ib.inbound_body_preview ~* '(got my|got it done|hit the goal|completed|finished|got my run in|ran this morning|miles done|steps today|knocked out|done this morning|did it)'
        AND ib.inbound_body_preview !~* '(should still|going to|tomorrow|plan to|gonna)' THEN 'completion_candidate'
      WHEN ib.inbound_body_preview ~* '(discouraged|struggling|overwhelmed|anxious|depressed|frustrated)' THEN 'emotional_state_candidate'
      WHEN ib.inbound_body_preview ~* '(my (wife|husband|mom|dad|daughter|son)|important person|identity)' THEN 'important_memory_candidate'
      ELSE 'other'
    END AS candidate_family,
    CASE
      WHEN ib.inbound_at < LEAST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= GREATEST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS fix_era,
    CASE
      WHEN ib.inbound_at < b.known_fix_cutover_at_user_yes THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= b.known_fix_cutover_at_user_yes THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS user_yes_fix_era,
    CASE
      WHEN ib.inbound_at < b.known_fix_cutover_at_meta_process THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= b.known_fix_cutover_at_meta_process THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS meta_process_fix_era,
    CASE
      WHEN ib.inbound_body_preview ILIKE '%got my distribution done today%' AND ib.inbound_body_preview ILIKE '%hit the goal%' THEN 'distribution_completion'
      WHEN ib.inbound_body_preview ~* '10[,]?000 steps today' THEN 'steps_completion'
      WHEN ib.inbound_body_preview ILIKE '%onboarding%' AND ib.inbound_body_preview ~* 'didn''?t ask' THEN 'onboarding_meta_dispute'
      WHEN ib.inbound_body_preview ~* '(going to run tomorrow|tomorrow i''?ll get it done)' THEN 'future_plan_negative'
      ELSE NULL
    END AS is_known_historical_fixture,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_relationship'), ''),
      NULLIF(BTRIM(tel.payload_json->>'turn_understanding_relationship_meaning'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning'->>'relationship_meaning'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning_facts'->>'relationship_meaning'), '')
    ) AS relationship_meaning,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning'->>'persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning_facts'->>'persistence_decision'), '')
    ) AS persistence_decision,
    NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), '') AS server_reconciled_persistence_decision,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'outcome_persist_skip_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->>'turn_understanding_persist_skip_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->'turn_understanding_persist_guard'->>'guard_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->>'outcome_persist_skip_reason_before_no_send'), '')
    ) AS persist_skip_reason,
    NULLIF(BTRIM(tel.payload_json->>'openai_turn_understanding_version'), '') AS prod_code_version,
    to_jsonb(tel.payload_json) AS raw_telemetry_json,
    COALESCE(sp.persisted_user_yes, FALSE) AS persisted_user_yes,
    COALESCE(sp.persisted_user_no, FALSE) AS persisted_user_no,
    COALESCE(sp.persisted_user_partial, FALSE) AS persisted_user_partial,
    COALESCE(sp.persisted_blocker, FALSE) AS persisted_blocker,
    COALESCE(sp.persisted_plan_signal, FALSE) AS persisted_plan_signal,
    COALESCE(sp.persisted_goal_change, FALSE) AS persisted_goal_change,
    COALESCE(sp.persisted_proof_moment, FALSE) AS persisted_proof_moment,
    COALESCE(sp.persisted_user_visible_proof_line, FALSE) AS persisted_user_visible_proof_line,
    sp.persisted_proof_moment_type,
    sp.persisted_outcome_event_types,
    sp.persisted_event_ids,
  CASE
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IN ('write_user_yes_today') THEN 'write_user_yes'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) = 'write_user_no' THEN 'write_user_no'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) = 'write_user_partial' THEN 'write_user_partial'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IN ('no_outcome_write', 'ack_only', 'defer_to_pending_resolution', 'defer_to_contract_consent') THEN 'no_outcome_write'
    WHEN ib.inbound_body_preview ~* '(onboarding|didn''?t ask me|did the onboarding matter)' THEN 'no_outcome_write'
    WHEN ib.inbound_body_preview ~* '(i''?ll|i will|tomorrow|going to run|planning to)' THEN 'no_outcome_write'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IS NULL THEN 'unknown'
    ELSE 'unknown'
  END AS expected_persistence_decision
  FROM inbound_base ib
  CROSS JOIN bounds b
  LEFT JOIN LATERAL (
    SELECT e.payload_json
    FROM v2_commitment_event e
    WHERE e.event_type = 'sms_memory_signal'
      AND e.payload_json->>'inbound_turn_telemetry' = 'true'
      AND COALESCE(
        NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
        SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
      ) = ib.inbound_message_sid
    ORDER BY e.occurred_at DESC
    LIMIT 1
  ) tel ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      BOOL_OR(ev.event_type = 'user_yes') AS persisted_user_yes,
      BOOL_OR(ev.event_type = 'user_no') AS persisted_user_no,
      BOOL_OR(ev.event_type = 'user_partial') AS persisted_user_partial,
      BOOL_OR(ev.event_type = 'blocker_captured') AS persisted_blocker,
      BOOL_OR(
        ev.event_type = 'sms_memory_signal'
        AND ev.payload_json->'memory_signal' IS NOT NULL
        AND COALESCE(ev.payload_json->'memory_signal'->>'memory_signal_detected', 'false') = 'true'
      ) AS persisted_plan_signal,
      BOOL_OR(ev.event_type IN ('contract_overlay_proposed', 'contract_overlay_activated', 'ask_shrunk')) AS persisted_goal_change,
      BOOL_OR(COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS persisted_proof_moment,
      BOOL_OR(COALESCE(ev.payload_json->>'user_visible_proof_line', '') <> '') AS persisted_user_visible_proof_line,
      MAX(ev.payload_json->>'proof_moment_type') FILTER (WHERE COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS persisted_proof_moment_type,
      ARRAY_AGG(DISTINCT ev.event_type ORDER BY ev.event_type) FILTER (WHERE ev.event_type IN ('user_yes', 'user_no', 'user_partial')) AS persisted_outcome_event_types,
      ARRAY_AGG(ev.id ORDER BY ev.occurred_at) FILTER (WHERE ev.event_type IN ('user_yes', 'user_no', 'user_partial')) AS persisted_event_ids
    FROM v2_commitment_event ev
    WHERE COALESCE(
      NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(ev.payload_json->>'inbound_resolution_message_sid'), ''),
      SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) = ib.inbound_message_sid
  ) sp ON TRUE
),
classified_with_diag AS (
  SELECT
    c.*,
    CASE
      WHEN c.fix_era = 'pre_known_fix_window' AND c.is_known_historical_fixture IS NOT NULL THEN 'historical_pre_fix_observation'
      WHEN c.candidate_family IN ('meta_process_candidate', 'plan_candidate', 'safety_or_support_candidate')
        AND (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'false_outcome_written'
      WHEN c.persistence_decision IS NULL AND c.server_reconciled_persistence_decision IS NULL
        AND c.candidate_family NOT IN ('other', 'emotional_state_candidate', 'important_memory_candidate') THEN 'telemetry_missing'
      WHEN c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision IN ('write_user_yes', 'write_user_no', 'write_user_partial')
        AND c.fix_era = 'post_known_fix_window'
        AND c.is_known_historical_fixture IS NOT NULL
        AND NOT (
          (c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes)
          OR (c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no)
          OR (c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial)
        ) THEN 'current_code_failure_candidate'
      WHEN c.expected_persistence_decision IN ('write_user_yes', 'write_user_no', 'write_user_partial')
        AND c.fix_era = 'post_known_fix_window'
        AND NOT (
          (c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes)
          OR (c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no)
          OR (c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial)
        ) THEN 'expected_write_but_missing'
      WHEN c.expected_persistence_decision = 'no_outcome_write'
        AND NOT (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'server_no_outcome_expected'
      WHEN c.expected_persistence_decision = 'no_outcome_write'
        AND NOT (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'expected_no_write_and_none_written'
      WHEN c.candidate_family = 'other' THEN 'regex_weak_manual_review'
      WHEN c.expected_persistence_decision = 'unknown' THEN 'cert_join_uncertain'
      ELSE 'cert_join_uncertain'
    END AS cert_diagnostic,
    CASE
      WHEN c.candidate_family = 'other' THEN 'regex_family_uncertain_review_body'
      WHEN c.persistence_decision IS NULL AND c.server_reconciled_persistence_decision IS NULL THEN 'missing_turn_telemetry'
      WHEN c.candidate_family = 'plan_candidate' THEN 'plan_manual_review_expected_no_outcome_proof'
      ELSE NULL
    END AS needs_human_review_reason
  FROM classified_inbound c
)
SELECT
  c.local_day,
  c.fix_era,
  c.candidate_family,
  c.expected_persistence_decision,
  c.cert_diagnostic,
  c.needs_human_review_reason,
  COUNT(*) AS inbound_count,
  COUNT(*) FILTER (WHERE c.persisted_user_yes) AS persisted_yes_count,
  COUNT(*) FILTER (WHERE c.persisted_user_no) AS persisted_no_count,
  COUNT(*) FILTER (WHERE c.persisted_user_partial) AS persisted_partial_count,
  COUNT(*) FILTER (WHERE c.cert_diagnostic = 'current_code_failure_candidate') AS current_code_failure_count,
  COUNT(*) FILTER (WHERE c.cert_diagnostic = 'historical_pre_fix_observation') AS historical_pre_fix_count,
  ARRAY_AGG(DISTINCT c.inbound_body_preview ORDER BY c.inbound_body_preview) FILTER (WHERE c.inbound_body_preview IS NOT NULL) AS examples
FROM classified_with_diag c
GROUP BY c.local_day, c.fix_era, c.candidate_family, c.expected_persistence_decision, c.cert_diagnostic, c.needs_human_review_reason
ORDER BY c.local_day DESC, inbound_count DESC;



-- =============================================================================
-- QUERY 3 — user_yes_certification
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_user_yes,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_meta_process,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_weekly_miss_count
),
inbound_base AS (
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
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
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
    ) AS inbound_body_preview,
    to_jsonb(m) AS raw_inbound_json,
    to_jsonb(j) AS raw_job_json
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j
    ON j.message_sid = to_jsonb(m)->>'message_sid'
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) < b.window_end
    AND COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')
    ) IS NOT NULL
),
classified_inbound AS (
  SELECT
    ib.inbound_message_sid,
    ib.clerk_user_id,
    ib.inbound_at,
    (ib.inbound_at AT TIME ZONE 'America/New_York')::date AS local_day,
    ib.inbound_body_preview,
    ib.raw_inbound_json,
    ib.raw_job_json,
    CASE
      WHEN ib.inbound_body_preview ~* '(^|\s)(stop|unsubscribe|help|start)\b' THEN 'safety_or_support_candidate'
      WHEN ib.inbound_body_preview ~* '(onboarding|didn''?t ask me|did not ask me|did the onboarding matter|you didn''?t ask|coach forgot|process dispute|you said.*didn''?t)' THEN 'meta_process_candidate'
      WHEN ib.inbound_body_preview ~* '(change my goal|lower the bar|raise the bar|shrink|replace.*goal|adjust my goal)' THEN 'goal_change_candidate'
      WHEN ib.inbound_body_preview ~* '(got in the way|threw me off|blocker|rain|meetings|forgot my shoes|travel|sick|kids)' THEN 'blocker_candidate'
      WHEN ib.inbound_body_preview ~* '(i''?ll|i will|tomorrow|before breakfast|after work|setting my shoes|planning to|going to run|gonna run)' THEN 'plan_candidate'
      WHEN ib.inbound_body_preview ~* '(only did|half|started but didn''?t|did \d+ of \d+|some of it|part of it)' THEN 'partial_candidate'
      WHEN ib.inbound_body_preview ~* '(missed|didn''?t happen|did not happen|skipped|couldn''?t get|no run today|blew it|didn''?t hit)'
        AND ib.inbound_body_preview !~* '(didn''?t ask|onboarding matter)' THEN 'miss_candidate'
      WHEN ib.inbound_body_preview ~* '(got my|got it done|hit the goal|completed|finished|got my run in|ran this morning|miles done|steps today|knocked out|done this morning|did it)'
        AND ib.inbound_body_preview !~* '(should still|going to|tomorrow|plan to|gonna)' THEN 'completion_candidate'
      WHEN ib.inbound_body_preview ~* '(discouraged|struggling|overwhelmed|anxious|depressed|frustrated)' THEN 'emotional_state_candidate'
      WHEN ib.inbound_body_preview ~* '(my (wife|husband|mom|dad|daughter|son)|important person|identity)' THEN 'important_memory_candidate'
      ELSE 'other'
    END AS candidate_family,
    CASE
      WHEN ib.inbound_at < LEAST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= GREATEST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS fix_era,
    CASE
      WHEN ib.inbound_at < b.known_fix_cutover_at_user_yes THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= b.known_fix_cutover_at_user_yes THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS user_yes_fix_era,
    CASE
      WHEN ib.inbound_at < b.known_fix_cutover_at_meta_process THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= b.known_fix_cutover_at_meta_process THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS meta_process_fix_era,
    CASE
      WHEN ib.inbound_body_preview ILIKE '%got my distribution done today%' AND ib.inbound_body_preview ILIKE '%hit the goal%' THEN 'distribution_completion'
      WHEN ib.inbound_body_preview ~* '10[,]?000 steps today' THEN 'steps_completion'
      WHEN ib.inbound_body_preview ILIKE '%onboarding%' AND ib.inbound_body_preview ~* 'didn''?t ask' THEN 'onboarding_meta_dispute'
      WHEN ib.inbound_body_preview ~* '(going to run tomorrow|tomorrow i''?ll get it done)' THEN 'future_plan_negative'
      ELSE NULL
    END AS is_known_historical_fixture,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_relationship'), ''),
      NULLIF(BTRIM(tel.payload_json->>'turn_understanding_relationship_meaning'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning'->>'relationship_meaning'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning_facts'->>'relationship_meaning'), '')
    ) AS relationship_meaning,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning'->>'persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning_facts'->>'persistence_decision'), '')
    ) AS persistence_decision,
    NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), '') AS server_reconciled_persistence_decision,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'outcome_persist_skip_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->>'turn_understanding_persist_skip_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->'turn_understanding_persist_guard'->>'guard_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->>'outcome_persist_skip_reason_before_no_send'), '')
    ) AS persist_skip_reason,
    NULLIF(BTRIM(tel.payload_json->>'openai_turn_understanding_version'), '') AS prod_code_version,
    to_jsonb(tel.payload_json) AS raw_telemetry_json,
    COALESCE(sp.persisted_user_yes, FALSE) AS persisted_user_yes,
    COALESCE(sp.persisted_user_no, FALSE) AS persisted_user_no,
    COALESCE(sp.persisted_user_partial, FALSE) AS persisted_user_partial,
    COALESCE(sp.persisted_blocker, FALSE) AS persisted_blocker,
    COALESCE(sp.persisted_plan_signal, FALSE) AS persisted_plan_signal,
    COALESCE(sp.persisted_goal_change, FALSE) AS persisted_goal_change,
    COALESCE(sp.persisted_proof_moment, FALSE) AS persisted_proof_moment,
    COALESCE(sp.persisted_user_visible_proof_line, FALSE) AS persisted_user_visible_proof_line,
    sp.persisted_proof_moment_type,
    sp.persisted_outcome_event_types,
    sp.persisted_event_ids,
  CASE
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IN ('write_user_yes_today') THEN 'write_user_yes'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) = 'write_user_no' THEN 'write_user_no'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) = 'write_user_partial' THEN 'write_user_partial'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IN ('no_outcome_write', 'ack_only', 'defer_to_pending_resolution', 'defer_to_contract_consent') THEN 'no_outcome_write'
    WHEN ib.inbound_body_preview ~* '(onboarding|didn''?t ask me|did the onboarding matter)' THEN 'no_outcome_write'
    WHEN ib.inbound_body_preview ~* '(i''?ll|i will|tomorrow|going to run|planning to)' THEN 'no_outcome_write'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IS NULL THEN 'unknown'
    ELSE 'unknown'
  END AS expected_persistence_decision
  FROM inbound_base ib
  CROSS JOIN bounds b
  LEFT JOIN LATERAL (
    SELECT e.payload_json
    FROM v2_commitment_event e
    WHERE e.event_type = 'sms_memory_signal'
      AND e.payload_json->>'inbound_turn_telemetry' = 'true'
      AND COALESCE(
        NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
        SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
      ) = ib.inbound_message_sid
    ORDER BY e.occurred_at DESC
    LIMIT 1
  ) tel ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      BOOL_OR(ev.event_type = 'user_yes') AS persisted_user_yes,
      BOOL_OR(ev.event_type = 'user_no') AS persisted_user_no,
      BOOL_OR(ev.event_type = 'user_partial') AS persisted_user_partial,
      BOOL_OR(ev.event_type = 'blocker_captured') AS persisted_blocker,
      BOOL_OR(
        ev.event_type = 'sms_memory_signal'
        AND ev.payload_json->'memory_signal' IS NOT NULL
        AND COALESCE(ev.payload_json->'memory_signal'->>'memory_signal_detected', 'false') = 'true'
      ) AS persisted_plan_signal,
      BOOL_OR(ev.event_type IN ('contract_overlay_proposed', 'contract_overlay_activated', 'ask_shrunk')) AS persisted_goal_change,
      BOOL_OR(COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS persisted_proof_moment,
      BOOL_OR(COALESCE(ev.payload_json->>'user_visible_proof_line', '') <> '') AS persisted_user_visible_proof_line,
      MAX(ev.payload_json->>'proof_moment_type') FILTER (WHERE COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS persisted_proof_moment_type,
      ARRAY_AGG(DISTINCT ev.event_type ORDER BY ev.event_type) FILTER (WHERE ev.event_type IN ('user_yes', 'user_no', 'user_partial')) AS persisted_outcome_event_types,
      ARRAY_AGG(ev.id ORDER BY ev.occurred_at) FILTER (WHERE ev.event_type IN ('user_yes', 'user_no', 'user_partial')) AS persisted_event_ids
    FROM v2_commitment_event ev
    WHERE COALESCE(
      NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(ev.payload_json->>'inbound_resolution_message_sid'), ''),
      SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) = ib.inbound_message_sid
  ) sp ON TRUE
),
classified_with_diag AS (
  SELECT
    c.*,
    CASE
      WHEN c.fix_era = 'pre_known_fix_window' AND c.is_known_historical_fixture IS NOT NULL THEN 'historical_pre_fix_observation'
      WHEN c.candidate_family IN ('meta_process_candidate', 'plan_candidate', 'safety_or_support_candidate')
        AND (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'false_outcome_written'
      WHEN c.persistence_decision IS NULL AND c.server_reconciled_persistence_decision IS NULL
        AND c.candidate_family NOT IN ('other', 'emotional_state_candidate', 'important_memory_candidate') THEN 'telemetry_missing'
      WHEN c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision IN ('write_user_yes', 'write_user_no', 'write_user_partial')
        AND c.fix_era = 'post_known_fix_window'
        AND c.is_known_historical_fixture IS NOT NULL
        AND NOT (
          (c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes)
          OR (c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no)
          OR (c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial)
        ) THEN 'current_code_failure_candidate'
      WHEN c.expected_persistence_decision IN ('write_user_yes', 'write_user_no', 'write_user_partial')
        AND c.fix_era = 'post_known_fix_window'
        AND NOT (
          (c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes)
          OR (c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no)
          OR (c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial)
        ) THEN 'expected_write_but_missing'
      WHEN c.expected_persistence_decision = 'no_outcome_write'
        AND NOT (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'server_no_outcome_expected'
      WHEN c.expected_persistence_decision = 'no_outcome_write'
        AND NOT (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'expected_no_write_and_none_written'
      WHEN c.candidate_family = 'other' THEN 'regex_weak_manual_review'
      WHEN c.expected_persistence_decision = 'unknown' THEN 'cert_join_uncertain'
      ELSE 'cert_join_uncertain'
    END AS cert_diagnostic,
    CASE
      WHEN c.candidate_family = 'other' THEN 'regex_family_uncertain_review_body'
      WHEN c.persistence_decision IS NULL AND c.server_reconciled_persistence_decision IS NULL THEN 'missing_turn_telemetry'
      WHEN c.candidate_family = 'plan_candidate' THEN 'plan_manual_review_expected_no_outcome_proof'
      ELSE NULL
    END AS needs_human_review_reason
  FROM classified_inbound c
)
SELECT
  c.inbound_at,
  c.fix_era,
  c.clerk_user_id,
  c.inbound_message_sid,
  c.inbound_body_preview,
  c.is_known_historical_fixture,
  c.persistence_decision,
  c.expected_persistence_decision,
  c.cert_diagnostic,
  c.persisted_user_yes,
  c.persisted_proof_moment,
  c.persisted_user_visible_proof_line,
  c.needs_human_review_reason
FROM classified_with_diag c
WHERE c.candidate_family = 'completion_candidate'
   OR c.is_known_historical_fixture IN ('distribution_completion', 'steps_completion')
ORDER BY c.inbound_at DESC;



-- =============================================================================
-- QUERY 4 — user_no_certification
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_user_yes,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_meta_process,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_weekly_miss_count
),
inbound_base AS (
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
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
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
    ) AS inbound_body_preview,
    to_jsonb(m) AS raw_inbound_json,
    to_jsonb(j) AS raw_job_json
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j
    ON j.message_sid = to_jsonb(m)->>'message_sid'
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) < b.window_end
    AND COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')
    ) IS NOT NULL
),
classified_inbound AS (
  SELECT
    ib.inbound_message_sid,
    ib.clerk_user_id,
    ib.inbound_at,
    (ib.inbound_at AT TIME ZONE 'America/New_York')::date AS local_day,
    ib.inbound_body_preview,
    ib.raw_inbound_json,
    ib.raw_job_json,
    CASE
      WHEN ib.inbound_body_preview ~* '(^|\s)(stop|unsubscribe|help|start)\b' THEN 'safety_or_support_candidate'
      WHEN ib.inbound_body_preview ~* '(onboarding|didn''?t ask me|did not ask me|did the onboarding matter|you didn''?t ask|coach forgot|process dispute|you said.*didn''?t)' THEN 'meta_process_candidate'
      WHEN ib.inbound_body_preview ~* '(change my goal|lower the bar|raise the bar|shrink|replace.*goal|adjust my goal)' THEN 'goal_change_candidate'
      WHEN ib.inbound_body_preview ~* '(got in the way|threw me off|blocker|rain|meetings|forgot my shoes|travel|sick|kids)' THEN 'blocker_candidate'
      WHEN ib.inbound_body_preview ~* '(i''?ll|i will|tomorrow|before breakfast|after work|setting my shoes|planning to|going to run|gonna run)' THEN 'plan_candidate'
      WHEN ib.inbound_body_preview ~* '(only did|half|started but didn''?t|did \d+ of \d+|some of it|part of it)' THEN 'partial_candidate'
      WHEN ib.inbound_body_preview ~* '(missed|didn''?t happen|did not happen|skipped|couldn''?t get|no run today|blew it|didn''?t hit)'
        AND ib.inbound_body_preview !~* '(didn''?t ask|onboarding matter)' THEN 'miss_candidate'
      WHEN ib.inbound_body_preview ~* '(got my|got it done|hit the goal|completed|finished|got my run in|ran this morning|miles done|steps today|knocked out|done this morning|did it)'
        AND ib.inbound_body_preview !~* '(should still|going to|tomorrow|plan to|gonna)' THEN 'completion_candidate'
      WHEN ib.inbound_body_preview ~* '(discouraged|struggling|overwhelmed|anxious|depressed|frustrated)' THEN 'emotional_state_candidate'
      WHEN ib.inbound_body_preview ~* '(my (wife|husband|mom|dad|daughter|son)|important person|identity)' THEN 'important_memory_candidate'
      ELSE 'other'
    END AS candidate_family,
    CASE
      WHEN ib.inbound_at < LEAST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= GREATEST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS fix_era,
    CASE
      WHEN ib.inbound_at < b.known_fix_cutover_at_user_yes THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= b.known_fix_cutover_at_user_yes THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS user_yes_fix_era,
    CASE
      WHEN ib.inbound_at < b.known_fix_cutover_at_meta_process THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= b.known_fix_cutover_at_meta_process THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS meta_process_fix_era,
    CASE
      WHEN ib.inbound_body_preview ILIKE '%got my distribution done today%' AND ib.inbound_body_preview ILIKE '%hit the goal%' THEN 'distribution_completion'
      WHEN ib.inbound_body_preview ~* '10[,]?000 steps today' THEN 'steps_completion'
      WHEN ib.inbound_body_preview ILIKE '%onboarding%' AND ib.inbound_body_preview ~* 'didn''?t ask' THEN 'onboarding_meta_dispute'
      WHEN ib.inbound_body_preview ~* '(going to run tomorrow|tomorrow i''?ll get it done)' THEN 'future_plan_negative'
      ELSE NULL
    END AS is_known_historical_fixture,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_relationship'), ''),
      NULLIF(BTRIM(tel.payload_json->>'turn_understanding_relationship_meaning'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning'->>'relationship_meaning'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning_facts'->>'relationship_meaning'), '')
    ) AS relationship_meaning,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning'->>'persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning_facts'->>'persistence_decision'), '')
    ) AS persistence_decision,
    NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), '') AS server_reconciled_persistence_decision,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'outcome_persist_skip_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->>'turn_understanding_persist_skip_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->'turn_understanding_persist_guard'->>'guard_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->>'outcome_persist_skip_reason_before_no_send'), '')
    ) AS persist_skip_reason,
    NULLIF(BTRIM(tel.payload_json->>'openai_turn_understanding_version'), '') AS prod_code_version,
    to_jsonb(tel.payload_json) AS raw_telemetry_json,
    COALESCE(sp.persisted_user_yes, FALSE) AS persisted_user_yes,
    COALESCE(sp.persisted_user_no, FALSE) AS persisted_user_no,
    COALESCE(sp.persisted_user_partial, FALSE) AS persisted_user_partial,
    COALESCE(sp.persisted_blocker, FALSE) AS persisted_blocker,
    COALESCE(sp.persisted_plan_signal, FALSE) AS persisted_plan_signal,
    COALESCE(sp.persisted_goal_change, FALSE) AS persisted_goal_change,
    COALESCE(sp.persisted_proof_moment, FALSE) AS persisted_proof_moment,
    COALESCE(sp.persisted_user_visible_proof_line, FALSE) AS persisted_user_visible_proof_line,
    sp.persisted_proof_moment_type,
    sp.persisted_outcome_event_types,
    sp.persisted_event_ids,
  CASE
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IN ('write_user_yes_today') THEN 'write_user_yes'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) = 'write_user_no' THEN 'write_user_no'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) = 'write_user_partial' THEN 'write_user_partial'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IN ('no_outcome_write', 'ack_only', 'defer_to_pending_resolution', 'defer_to_contract_consent') THEN 'no_outcome_write'
    WHEN ib.inbound_body_preview ~* '(onboarding|didn''?t ask me|did the onboarding matter)' THEN 'no_outcome_write'
    WHEN ib.inbound_body_preview ~* '(i''?ll|i will|tomorrow|going to run|planning to)' THEN 'no_outcome_write'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IS NULL THEN 'unknown'
    ELSE 'unknown'
  END AS expected_persistence_decision
  FROM inbound_base ib
  CROSS JOIN bounds b
  LEFT JOIN LATERAL (
    SELECT e.payload_json
    FROM v2_commitment_event e
    WHERE e.event_type = 'sms_memory_signal'
      AND e.payload_json->>'inbound_turn_telemetry' = 'true'
      AND COALESCE(
        NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
        SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
      ) = ib.inbound_message_sid
    ORDER BY e.occurred_at DESC
    LIMIT 1
  ) tel ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      BOOL_OR(ev.event_type = 'user_yes') AS persisted_user_yes,
      BOOL_OR(ev.event_type = 'user_no') AS persisted_user_no,
      BOOL_OR(ev.event_type = 'user_partial') AS persisted_user_partial,
      BOOL_OR(ev.event_type = 'blocker_captured') AS persisted_blocker,
      BOOL_OR(
        ev.event_type = 'sms_memory_signal'
        AND ev.payload_json->'memory_signal' IS NOT NULL
        AND COALESCE(ev.payload_json->'memory_signal'->>'memory_signal_detected', 'false') = 'true'
      ) AS persisted_plan_signal,
      BOOL_OR(ev.event_type IN ('contract_overlay_proposed', 'contract_overlay_activated', 'ask_shrunk')) AS persisted_goal_change,
      BOOL_OR(COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS persisted_proof_moment,
      BOOL_OR(COALESCE(ev.payload_json->>'user_visible_proof_line', '') <> '') AS persisted_user_visible_proof_line,
      MAX(ev.payload_json->>'proof_moment_type') FILTER (WHERE COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS persisted_proof_moment_type,
      ARRAY_AGG(DISTINCT ev.event_type ORDER BY ev.event_type) FILTER (WHERE ev.event_type IN ('user_yes', 'user_no', 'user_partial')) AS persisted_outcome_event_types,
      ARRAY_AGG(ev.id ORDER BY ev.occurred_at) FILTER (WHERE ev.event_type IN ('user_yes', 'user_no', 'user_partial')) AS persisted_event_ids
    FROM v2_commitment_event ev
    WHERE COALESCE(
      NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(ev.payload_json->>'inbound_resolution_message_sid'), ''),
      SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) = ib.inbound_message_sid
  ) sp ON TRUE
),
classified_with_diag AS (
  SELECT
    c.*,
    CASE
      WHEN c.fix_era = 'pre_known_fix_window' AND c.is_known_historical_fixture IS NOT NULL THEN 'historical_pre_fix_observation'
      WHEN c.candidate_family IN ('meta_process_candidate', 'plan_candidate', 'safety_or_support_candidate')
        AND (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'false_outcome_written'
      WHEN c.persistence_decision IS NULL AND c.server_reconciled_persistence_decision IS NULL
        AND c.candidate_family NOT IN ('other', 'emotional_state_candidate', 'important_memory_candidate') THEN 'telemetry_missing'
      WHEN c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision IN ('write_user_yes', 'write_user_no', 'write_user_partial')
        AND c.fix_era = 'post_known_fix_window'
        AND c.is_known_historical_fixture IS NOT NULL
        AND NOT (
          (c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes)
          OR (c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no)
          OR (c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial)
        ) THEN 'current_code_failure_candidate'
      WHEN c.expected_persistence_decision IN ('write_user_yes', 'write_user_no', 'write_user_partial')
        AND c.fix_era = 'post_known_fix_window'
        AND NOT (
          (c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes)
          OR (c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no)
          OR (c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial)
        ) THEN 'expected_write_but_missing'
      WHEN c.expected_persistence_decision = 'no_outcome_write'
        AND NOT (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'server_no_outcome_expected'
      WHEN c.expected_persistence_decision = 'no_outcome_write'
        AND NOT (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'expected_no_write_and_none_written'
      WHEN c.candidate_family = 'other' THEN 'regex_weak_manual_review'
      WHEN c.expected_persistence_decision = 'unknown' THEN 'cert_join_uncertain'
      ELSE 'cert_join_uncertain'
    END AS cert_diagnostic,
    CASE
      WHEN c.candidate_family = 'other' THEN 'regex_family_uncertain_review_body'
      WHEN c.persistence_decision IS NULL AND c.server_reconciled_persistence_decision IS NULL THEN 'missing_turn_telemetry'
      WHEN c.candidate_family = 'plan_candidate' THEN 'plan_manual_review_expected_no_outcome_proof'
      ELSE NULL
    END AS needs_human_review_reason
  FROM classified_inbound c
)
SELECT
  c.inbound_at,
  c.fix_era,
  c.clerk_user_id,
  c.inbound_body_preview,
  c.candidate_family,
  c.is_known_historical_fixture,
  c.persistence_decision,
  c.expected_persistence_decision,
  c.cert_diagnostic,
  c.persisted_user_no,
  c.persisted_user_yes,
  c.needs_human_review_reason
FROM classified_with_diag c
WHERE c.candidate_family IN ('miss_candidate', 'meta_process_candidate')
   OR c.is_known_historical_fixture = 'onboarding_meta_dispute'
ORDER BY c.inbound_at DESC;



-- =============================================================================
-- QUERY 5 — user_partial_certification
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_user_yes,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_meta_process,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_weekly_miss_count
),
inbound_base AS (
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
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
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
    ) AS inbound_body_preview,
    to_jsonb(m) AS raw_inbound_json,
    to_jsonb(j) AS raw_job_json
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j
    ON j.message_sid = to_jsonb(m)->>'message_sid'
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) < b.window_end
    AND COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')
    ) IS NOT NULL
),
classified_inbound AS (
  SELECT
    ib.inbound_message_sid,
    ib.clerk_user_id,
    ib.inbound_at,
    (ib.inbound_at AT TIME ZONE 'America/New_York')::date AS local_day,
    ib.inbound_body_preview,
    ib.raw_inbound_json,
    ib.raw_job_json,
    CASE
      WHEN ib.inbound_body_preview ~* '(^|\s)(stop|unsubscribe|help|start)\b' THEN 'safety_or_support_candidate'
      WHEN ib.inbound_body_preview ~* '(onboarding|didn''?t ask me|did not ask me|did the onboarding matter|you didn''?t ask|coach forgot|process dispute|you said.*didn''?t)' THEN 'meta_process_candidate'
      WHEN ib.inbound_body_preview ~* '(change my goal|lower the bar|raise the bar|shrink|replace.*goal|adjust my goal)' THEN 'goal_change_candidate'
      WHEN ib.inbound_body_preview ~* '(got in the way|threw me off|blocker|rain|meetings|forgot my shoes|travel|sick|kids)' THEN 'blocker_candidate'
      WHEN ib.inbound_body_preview ~* '(i''?ll|i will|tomorrow|before breakfast|after work|setting my shoes|planning to|going to run|gonna run)' THEN 'plan_candidate'
      WHEN ib.inbound_body_preview ~* '(only did|half|started but didn''?t|did \d+ of \d+|some of it|part of it)' THEN 'partial_candidate'
      WHEN ib.inbound_body_preview ~* '(missed|didn''?t happen|did not happen|skipped|couldn''?t get|no run today|blew it|didn''?t hit)'
        AND ib.inbound_body_preview !~* '(didn''?t ask|onboarding matter)' THEN 'miss_candidate'
      WHEN ib.inbound_body_preview ~* '(got my|got it done|hit the goal|completed|finished|got my run in|ran this morning|miles done|steps today|knocked out|done this morning|did it)'
        AND ib.inbound_body_preview !~* '(should still|going to|tomorrow|plan to|gonna)' THEN 'completion_candidate'
      WHEN ib.inbound_body_preview ~* '(discouraged|struggling|overwhelmed|anxious|depressed|frustrated)' THEN 'emotional_state_candidate'
      WHEN ib.inbound_body_preview ~* '(my (wife|husband|mom|dad|daughter|son)|important person|identity)' THEN 'important_memory_candidate'
      ELSE 'other'
    END AS candidate_family,
    CASE
      WHEN ib.inbound_at < LEAST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= GREATEST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS fix_era,
    CASE
      WHEN ib.inbound_at < b.known_fix_cutover_at_user_yes THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= b.known_fix_cutover_at_user_yes THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS user_yes_fix_era,
    CASE
      WHEN ib.inbound_at < b.known_fix_cutover_at_meta_process THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= b.known_fix_cutover_at_meta_process THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS meta_process_fix_era,
    CASE
      WHEN ib.inbound_body_preview ILIKE '%got my distribution done today%' AND ib.inbound_body_preview ILIKE '%hit the goal%' THEN 'distribution_completion'
      WHEN ib.inbound_body_preview ~* '10[,]?000 steps today' THEN 'steps_completion'
      WHEN ib.inbound_body_preview ILIKE '%onboarding%' AND ib.inbound_body_preview ~* 'didn''?t ask' THEN 'onboarding_meta_dispute'
      WHEN ib.inbound_body_preview ~* '(going to run tomorrow|tomorrow i''?ll get it done)' THEN 'future_plan_negative'
      ELSE NULL
    END AS is_known_historical_fixture,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_relationship'), ''),
      NULLIF(BTRIM(tel.payload_json->>'turn_understanding_relationship_meaning'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning'->>'relationship_meaning'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning_facts'->>'relationship_meaning'), '')
    ) AS relationship_meaning,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning'->>'persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning_facts'->>'persistence_decision'), '')
    ) AS persistence_decision,
    NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), '') AS server_reconciled_persistence_decision,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'outcome_persist_skip_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->>'turn_understanding_persist_skip_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->'turn_understanding_persist_guard'->>'guard_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->>'outcome_persist_skip_reason_before_no_send'), '')
    ) AS persist_skip_reason,
    NULLIF(BTRIM(tel.payload_json->>'openai_turn_understanding_version'), '') AS prod_code_version,
    to_jsonb(tel.payload_json) AS raw_telemetry_json,
    COALESCE(sp.persisted_user_yes, FALSE) AS persisted_user_yes,
    COALESCE(sp.persisted_user_no, FALSE) AS persisted_user_no,
    COALESCE(sp.persisted_user_partial, FALSE) AS persisted_user_partial,
    COALESCE(sp.persisted_blocker, FALSE) AS persisted_blocker,
    COALESCE(sp.persisted_plan_signal, FALSE) AS persisted_plan_signal,
    COALESCE(sp.persisted_goal_change, FALSE) AS persisted_goal_change,
    COALESCE(sp.persisted_proof_moment, FALSE) AS persisted_proof_moment,
    COALESCE(sp.persisted_user_visible_proof_line, FALSE) AS persisted_user_visible_proof_line,
    sp.persisted_proof_moment_type,
    sp.persisted_outcome_event_types,
    sp.persisted_event_ids,
  CASE
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IN ('write_user_yes_today') THEN 'write_user_yes'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) = 'write_user_no' THEN 'write_user_no'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) = 'write_user_partial' THEN 'write_user_partial'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IN ('no_outcome_write', 'ack_only', 'defer_to_pending_resolution', 'defer_to_contract_consent') THEN 'no_outcome_write'
    WHEN ib.inbound_body_preview ~* '(onboarding|didn''?t ask me|did the onboarding matter)' THEN 'no_outcome_write'
    WHEN ib.inbound_body_preview ~* '(i''?ll|i will|tomorrow|going to run|planning to)' THEN 'no_outcome_write'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IS NULL THEN 'unknown'
    ELSE 'unknown'
  END AS expected_persistence_decision
  FROM inbound_base ib
  CROSS JOIN bounds b
  LEFT JOIN LATERAL (
    SELECT e.payload_json
    FROM v2_commitment_event e
    WHERE e.event_type = 'sms_memory_signal'
      AND e.payload_json->>'inbound_turn_telemetry' = 'true'
      AND COALESCE(
        NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
        SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
      ) = ib.inbound_message_sid
    ORDER BY e.occurred_at DESC
    LIMIT 1
  ) tel ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      BOOL_OR(ev.event_type = 'user_yes') AS persisted_user_yes,
      BOOL_OR(ev.event_type = 'user_no') AS persisted_user_no,
      BOOL_OR(ev.event_type = 'user_partial') AS persisted_user_partial,
      BOOL_OR(ev.event_type = 'blocker_captured') AS persisted_blocker,
      BOOL_OR(
        ev.event_type = 'sms_memory_signal'
        AND ev.payload_json->'memory_signal' IS NOT NULL
        AND COALESCE(ev.payload_json->'memory_signal'->>'memory_signal_detected', 'false') = 'true'
      ) AS persisted_plan_signal,
      BOOL_OR(ev.event_type IN ('contract_overlay_proposed', 'contract_overlay_activated', 'ask_shrunk')) AS persisted_goal_change,
      BOOL_OR(COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS persisted_proof_moment,
      BOOL_OR(COALESCE(ev.payload_json->>'user_visible_proof_line', '') <> '') AS persisted_user_visible_proof_line,
      MAX(ev.payload_json->>'proof_moment_type') FILTER (WHERE COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS persisted_proof_moment_type,
      ARRAY_AGG(DISTINCT ev.event_type ORDER BY ev.event_type) FILTER (WHERE ev.event_type IN ('user_yes', 'user_no', 'user_partial')) AS persisted_outcome_event_types,
      ARRAY_AGG(ev.id ORDER BY ev.occurred_at) FILTER (WHERE ev.event_type IN ('user_yes', 'user_no', 'user_partial')) AS persisted_event_ids
    FROM v2_commitment_event ev
    WHERE COALESCE(
      NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(ev.payload_json->>'inbound_resolution_message_sid'), ''),
      SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) = ib.inbound_message_sid
  ) sp ON TRUE
),
classified_with_diag AS (
  SELECT
    c.*,
    CASE
      WHEN c.fix_era = 'pre_known_fix_window' AND c.is_known_historical_fixture IS NOT NULL THEN 'historical_pre_fix_observation'
      WHEN c.candidate_family IN ('meta_process_candidate', 'plan_candidate', 'safety_or_support_candidate')
        AND (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'false_outcome_written'
      WHEN c.persistence_decision IS NULL AND c.server_reconciled_persistence_decision IS NULL
        AND c.candidate_family NOT IN ('other', 'emotional_state_candidate', 'important_memory_candidate') THEN 'telemetry_missing'
      WHEN c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision IN ('write_user_yes', 'write_user_no', 'write_user_partial')
        AND c.fix_era = 'post_known_fix_window'
        AND c.is_known_historical_fixture IS NOT NULL
        AND NOT (
          (c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes)
          OR (c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no)
          OR (c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial)
        ) THEN 'current_code_failure_candidate'
      WHEN c.expected_persistence_decision IN ('write_user_yes', 'write_user_no', 'write_user_partial')
        AND c.fix_era = 'post_known_fix_window'
        AND NOT (
          (c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes)
          OR (c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no)
          OR (c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial)
        ) THEN 'expected_write_but_missing'
      WHEN c.expected_persistence_decision = 'no_outcome_write'
        AND NOT (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'server_no_outcome_expected'
      WHEN c.expected_persistence_decision = 'no_outcome_write'
        AND NOT (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'expected_no_write_and_none_written'
      WHEN c.candidate_family = 'other' THEN 'regex_weak_manual_review'
      WHEN c.expected_persistence_decision = 'unknown' THEN 'cert_join_uncertain'
      ELSE 'cert_join_uncertain'
    END AS cert_diagnostic,
    CASE
      WHEN c.candidate_family = 'other' THEN 'regex_family_uncertain_review_body'
      WHEN c.persistence_decision IS NULL AND c.server_reconciled_persistence_decision IS NULL THEN 'missing_turn_telemetry'
      WHEN c.candidate_family = 'plan_candidate' THEN 'plan_manual_review_expected_no_outcome_proof'
      ELSE NULL
    END AS needs_human_review_reason
  FROM classified_inbound c
)
SELECT
  c.inbound_at,
  c.fix_era,
  c.inbound_body_preview,
  c.persistence_decision,
  c.expected_persistence_decision,
  c.cert_diagnostic,
  c.persisted_user_partial,
  c.needs_human_review_reason
FROM classified_with_diag c
WHERE c.candidate_family = 'partial_candidate'
ORDER BY c.inbound_at DESC;



-- =============================================================================
-- QUERY 6 — plan_memory_certification
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_user_yes,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_meta_process,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_weekly_miss_count
),
inbound_base AS (
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
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
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
    ) AS inbound_body_preview,
    to_jsonb(m) AS raw_inbound_json,
    to_jsonb(j) AS raw_job_json
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j
    ON j.message_sid = to_jsonb(m)->>'message_sid'
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) < b.window_end
    AND COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')
    ) IS NOT NULL
),
classified_inbound AS (
  SELECT
    ib.inbound_message_sid,
    ib.clerk_user_id,
    ib.inbound_at,
    (ib.inbound_at AT TIME ZONE 'America/New_York')::date AS local_day,
    ib.inbound_body_preview,
    ib.raw_inbound_json,
    ib.raw_job_json,
    CASE
      WHEN ib.inbound_body_preview ~* '(^|\s)(stop|unsubscribe|help|start)\b' THEN 'safety_or_support_candidate'
      WHEN ib.inbound_body_preview ~* '(onboarding|didn''?t ask me|did not ask me|did the onboarding matter|you didn''?t ask|coach forgot|process dispute|you said.*didn''?t)' THEN 'meta_process_candidate'
      WHEN ib.inbound_body_preview ~* '(change my goal|lower the bar|raise the bar|shrink|replace.*goal|adjust my goal)' THEN 'goal_change_candidate'
      WHEN ib.inbound_body_preview ~* '(got in the way|threw me off|blocker|rain|meetings|forgot my shoes|travel|sick|kids)' THEN 'blocker_candidate'
      WHEN ib.inbound_body_preview ~* '(i''?ll|i will|tomorrow|before breakfast|after work|setting my shoes|planning to|going to run|gonna run)' THEN 'plan_candidate'
      WHEN ib.inbound_body_preview ~* '(only did|half|started but didn''?t|did \d+ of \d+|some of it|part of it)' THEN 'partial_candidate'
      WHEN ib.inbound_body_preview ~* '(missed|didn''?t happen|did not happen|skipped|couldn''?t get|no run today|blew it|didn''?t hit)'
        AND ib.inbound_body_preview !~* '(didn''?t ask|onboarding matter)' THEN 'miss_candidate'
      WHEN ib.inbound_body_preview ~* '(got my|got it done|hit the goal|completed|finished|got my run in|ran this morning|miles done|steps today|knocked out|done this morning|did it)'
        AND ib.inbound_body_preview !~* '(should still|going to|tomorrow|plan to|gonna)' THEN 'completion_candidate'
      WHEN ib.inbound_body_preview ~* '(discouraged|struggling|overwhelmed|anxious|depressed|frustrated)' THEN 'emotional_state_candidate'
      WHEN ib.inbound_body_preview ~* '(my (wife|husband|mom|dad|daughter|son)|important person|identity)' THEN 'important_memory_candidate'
      ELSE 'other'
    END AS candidate_family,
    CASE
      WHEN ib.inbound_at < LEAST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= GREATEST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS fix_era,
    CASE
      WHEN ib.inbound_at < b.known_fix_cutover_at_user_yes THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= b.known_fix_cutover_at_user_yes THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS user_yes_fix_era,
    CASE
      WHEN ib.inbound_at < b.known_fix_cutover_at_meta_process THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= b.known_fix_cutover_at_meta_process THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS meta_process_fix_era,
    CASE
      WHEN ib.inbound_body_preview ILIKE '%got my distribution done today%' AND ib.inbound_body_preview ILIKE '%hit the goal%' THEN 'distribution_completion'
      WHEN ib.inbound_body_preview ~* '10[,]?000 steps today' THEN 'steps_completion'
      WHEN ib.inbound_body_preview ILIKE '%onboarding%' AND ib.inbound_body_preview ~* 'didn''?t ask' THEN 'onboarding_meta_dispute'
      WHEN ib.inbound_body_preview ~* '(going to run tomorrow|tomorrow i''?ll get it done)' THEN 'future_plan_negative'
      ELSE NULL
    END AS is_known_historical_fixture,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_relationship'), ''),
      NULLIF(BTRIM(tel.payload_json->>'turn_understanding_relationship_meaning'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning'->>'relationship_meaning'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning_facts'->>'relationship_meaning'), '')
    ) AS relationship_meaning,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning'->>'persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning_facts'->>'persistence_decision'), '')
    ) AS persistence_decision,
    NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), '') AS server_reconciled_persistence_decision,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'outcome_persist_skip_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->>'turn_understanding_persist_skip_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->'turn_understanding_persist_guard'->>'guard_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->>'outcome_persist_skip_reason_before_no_send'), '')
    ) AS persist_skip_reason,
    NULLIF(BTRIM(tel.payload_json->>'openai_turn_understanding_version'), '') AS prod_code_version,
    to_jsonb(tel.payload_json) AS raw_telemetry_json,
    COALESCE(sp.persisted_user_yes, FALSE) AS persisted_user_yes,
    COALESCE(sp.persisted_user_no, FALSE) AS persisted_user_no,
    COALESCE(sp.persisted_user_partial, FALSE) AS persisted_user_partial,
    COALESCE(sp.persisted_blocker, FALSE) AS persisted_blocker,
    COALESCE(sp.persisted_plan_signal, FALSE) AS persisted_plan_signal,
    COALESCE(sp.persisted_goal_change, FALSE) AS persisted_goal_change,
    COALESCE(sp.persisted_proof_moment, FALSE) AS persisted_proof_moment,
    COALESCE(sp.persisted_user_visible_proof_line, FALSE) AS persisted_user_visible_proof_line,
    sp.persisted_proof_moment_type,
    sp.persisted_outcome_event_types,
    sp.persisted_event_ids,
  CASE
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IN ('write_user_yes_today') THEN 'write_user_yes'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) = 'write_user_no' THEN 'write_user_no'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) = 'write_user_partial' THEN 'write_user_partial'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IN ('no_outcome_write', 'ack_only', 'defer_to_pending_resolution', 'defer_to_contract_consent') THEN 'no_outcome_write'
    WHEN ib.inbound_body_preview ~* '(onboarding|didn''?t ask me|did the onboarding matter)' THEN 'no_outcome_write'
    WHEN ib.inbound_body_preview ~* '(i''?ll|i will|tomorrow|going to run|planning to)' THEN 'no_outcome_write'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IS NULL THEN 'unknown'
    ELSE 'unknown'
  END AS expected_persistence_decision
  FROM inbound_base ib
  CROSS JOIN bounds b
  LEFT JOIN LATERAL (
    SELECT e.payload_json
    FROM v2_commitment_event e
    WHERE e.event_type = 'sms_memory_signal'
      AND e.payload_json->>'inbound_turn_telemetry' = 'true'
      AND COALESCE(
        NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
        SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
      ) = ib.inbound_message_sid
    ORDER BY e.occurred_at DESC
    LIMIT 1
  ) tel ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      BOOL_OR(ev.event_type = 'user_yes') AS persisted_user_yes,
      BOOL_OR(ev.event_type = 'user_no') AS persisted_user_no,
      BOOL_OR(ev.event_type = 'user_partial') AS persisted_user_partial,
      BOOL_OR(ev.event_type = 'blocker_captured') AS persisted_blocker,
      BOOL_OR(
        ev.event_type = 'sms_memory_signal'
        AND ev.payload_json->'memory_signal' IS NOT NULL
        AND COALESCE(ev.payload_json->'memory_signal'->>'memory_signal_detected', 'false') = 'true'
      ) AS persisted_plan_signal,
      BOOL_OR(ev.event_type IN ('contract_overlay_proposed', 'contract_overlay_activated', 'ask_shrunk')) AS persisted_goal_change,
      BOOL_OR(COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS persisted_proof_moment,
      BOOL_OR(COALESCE(ev.payload_json->>'user_visible_proof_line', '') <> '') AS persisted_user_visible_proof_line,
      MAX(ev.payload_json->>'proof_moment_type') FILTER (WHERE COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS persisted_proof_moment_type,
      ARRAY_AGG(DISTINCT ev.event_type ORDER BY ev.event_type) FILTER (WHERE ev.event_type IN ('user_yes', 'user_no', 'user_partial')) AS persisted_outcome_event_types,
      ARRAY_AGG(ev.id ORDER BY ev.occurred_at) FILTER (WHERE ev.event_type IN ('user_yes', 'user_no', 'user_partial')) AS persisted_event_ids
    FROM v2_commitment_event ev
    WHERE COALESCE(
      NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(ev.payload_json->>'inbound_resolution_message_sid'), ''),
      SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) = ib.inbound_message_sid
  ) sp ON TRUE
),
classified_with_diag AS (
  SELECT
    c.*,
    CASE
      WHEN c.fix_era = 'pre_known_fix_window' AND c.is_known_historical_fixture IS NOT NULL THEN 'historical_pre_fix_observation'
      WHEN c.candidate_family IN ('meta_process_candidate', 'plan_candidate', 'safety_or_support_candidate')
        AND (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'false_outcome_written'
      WHEN c.persistence_decision IS NULL AND c.server_reconciled_persistence_decision IS NULL
        AND c.candidate_family NOT IN ('other', 'emotional_state_candidate', 'important_memory_candidate') THEN 'telemetry_missing'
      WHEN c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision IN ('write_user_yes', 'write_user_no', 'write_user_partial')
        AND c.fix_era = 'post_known_fix_window'
        AND c.is_known_historical_fixture IS NOT NULL
        AND NOT (
          (c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes)
          OR (c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no)
          OR (c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial)
        ) THEN 'current_code_failure_candidate'
      WHEN c.expected_persistence_decision IN ('write_user_yes', 'write_user_no', 'write_user_partial')
        AND c.fix_era = 'post_known_fix_window'
        AND NOT (
          (c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes)
          OR (c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no)
          OR (c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial)
        ) THEN 'expected_write_but_missing'
      WHEN c.expected_persistence_decision = 'no_outcome_write'
        AND NOT (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'server_no_outcome_expected'
      WHEN c.expected_persistence_decision = 'no_outcome_write'
        AND NOT (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'expected_no_write_and_none_written'
      WHEN c.candidate_family = 'other' THEN 'regex_weak_manual_review'
      WHEN c.expected_persistence_decision = 'unknown' THEN 'cert_join_uncertain'
      ELSE 'cert_join_uncertain'
    END AS cert_diagnostic,
    CASE
      WHEN c.candidate_family = 'other' THEN 'regex_family_uncertain_review_body'
      WHEN c.persistence_decision IS NULL AND c.server_reconciled_persistence_decision IS NULL THEN 'missing_turn_telemetry'
      WHEN c.candidate_family = 'plan_candidate' THEN 'plan_manual_review_expected_no_outcome_proof'
      ELSE NULL
    END AS needs_human_review_reason
  FROM classified_inbound c
)
SELECT
  c.inbound_at,
  c.fix_era,
  c.inbound_body_preview,
  c.candidate_family,
  c.persistence_decision,
  c.expected_persistence_decision,
  c.cert_diagnostic,
  c.persisted_plan_signal,
  c.persisted_user_yes,
  c.persisted_user_no,
  CASE
    WHEN c.cert_diagnostic IN ('server_no_outcome_expected', 'expected_no_write_and_none_written') AND c.candidate_family = 'plan_candidate' THEN 'plan_expected_no_proof'
    WHEN c.persisted_plan_signal THEN 'plan_saved_ok'
    WHEN c.candidate_family = 'plan_candidate' AND NOT c.persisted_plan_signal THEN 'plan_without_memory_signal'
    ELSE COALESCE(c.needs_human_review_reason, 'plan_manual_review')
  END AS plan_cert_diagnostic,
  c.needs_human_review_reason
FROM classified_with_diag c
WHERE c.candidate_family = 'plan_candidate'
   OR c.is_known_historical_fixture = 'future_plan_negative'
ORDER BY c.inbound_at DESC;



-- =============================================================================
-- QUERY 7 — blocker_certification
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_user_yes,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_meta_process,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_weekly_miss_count
),
inbound_base AS (
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
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
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
    ) AS inbound_body_preview,
    to_jsonb(m) AS raw_inbound_json,
    to_jsonb(j) AS raw_job_json
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j
    ON j.message_sid = to_jsonb(m)->>'message_sid'
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) < b.window_end
    AND COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')
    ) IS NOT NULL
),
classified_inbound AS (
  SELECT
    ib.inbound_message_sid,
    ib.clerk_user_id,
    ib.inbound_at,
    (ib.inbound_at AT TIME ZONE 'America/New_York')::date AS local_day,
    ib.inbound_body_preview,
    ib.raw_inbound_json,
    ib.raw_job_json,
    CASE
      WHEN ib.inbound_body_preview ~* '(^|\s)(stop|unsubscribe|help|start)\b' THEN 'safety_or_support_candidate'
      WHEN ib.inbound_body_preview ~* '(onboarding|didn''?t ask me|did not ask me|did the onboarding matter|you didn''?t ask|coach forgot|process dispute|you said.*didn''?t)' THEN 'meta_process_candidate'
      WHEN ib.inbound_body_preview ~* '(change my goal|lower the bar|raise the bar|shrink|replace.*goal|adjust my goal)' THEN 'goal_change_candidate'
      WHEN ib.inbound_body_preview ~* '(got in the way|threw me off|blocker|rain|meetings|forgot my shoes|travel|sick|kids)' THEN 'blocker_candidate'
      WHEN ib.inbound_body_preview ~* '(i''?ll|i will|tomorrow|before breakfast|after work|setting my shoes|planning to|going to run|gonna run)' THEN 'plan_candidate'
      WHEN ib.inbound_body_preview ~* '(only did|half|started but didn''?t|did \d+ of \d+|some of it|part of it)' THEN 'partial_candidate'
      WHEN ib.inbound_body_preview ~* '(missed|didn''?t happen|did not happen|skipped|couldn''?t get|no run today|blew it|didn''?t hit)'
        AND ib.inbound_body_preview !~* '(didn''?t ask|onboarding matter)' THEN 'miss_candidate'
      WHEN ib.inbound_body_preview ~* '(got my|got it done|hit the goal|completed|finished|got my run in|ran this morning|miles done|steps today|knocked out|done this morning|did it)'
        AND ib.inbound_body_preview !~* '(should still|going to|tomorrow|plan to|gonna)' THEN 'completion_candidate'
      WHEN ib.inbound_body_preview ~* '(discouraged|struggling|overwhelmed|anxious|depressed|frustrated)' THEN 'emotional_state_candidate'
      WHEN ib.inbound_body_preview ~* '(my (wife|husband|mom|dad|daughter|son)|important person|identity)' THEN 'important_memory_candidate'
      ELSE 'other'
    END AS candidate_family,
    CASE
      WHEN ib.inbound_at < LEAST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= GREATEST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS fix_era,
    CASE
      WHEN ib.inbound_at < b.known_fix_cutover_at_user_yes THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= b.known_fix_cutover_at_user_yes THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS user_yes_fix_era,
    CASE
      WHEN ib.inbound_at < b.known_fix_cutover_at_meta_process THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= b.known_fix_cutover_at_meta_process THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS meta_process_fix_era,
    CASE
      WHEN ib.inbound_body_preview ILIKE '%got my distribution done today%' AND ib.inbound_body_preview ILIKE '%hit the goal%' THEN 'distribution_completion'
      WHEN ib.inbound_body_preview ~* '10[,]?000 steps today' THEN 'steps_completion'
      WHEN ib.inbound_body_preview ILIKE '%onboarding%' AND ib.inbound_body_preview ~* 'didn''?t ask' THEN 'onboarding_meta_dispute'
      WHEN ib.inbound_body_preview ~* '(going to run tomorrow|tomorrow i''?ll get it done)' THEN 'future_plan_negative'
      ELSE NULL
    END AS is_known_historical_fixture,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_relationship'), ''),
      NULLIF(BTRIM(tel.payload_json->>'turn_understanding_relationship_meaning'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning'->>'relationship_meaning'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning_facts'->>'relationship_meaning'), '')
    ) AS relationship_meaning,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning'->>'persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning_facts'->>'persistence_decision'), '')
    ) AS persistence_decision,
    NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), '') AS server_reconciled_persistence_decision,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'outcome_persist_skip_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->>'turn_understanding_persist_skip_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->'turn_understanding_persist_guard'->>'guard_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->>'outcome_persist_skip_reason_before_no_send'), '')
    ) AS persist_skip_reason,
    NULLIF(BTRIM(tel.payload_json->>'openai_turn_understanding_version'), '') AS prod_code_version,
    to_jsonb(tel.payload_json) AS raw_telemetry_json,
    COALESCE(sp.persisted_user_yes, FALSE) AS persisted_user_yes,
    COALESCE(sp.persisted_user_no, FALSE) AS persisted_user_no,
    COALESCE(sp.persisted_user_partial, FALSE) AS persisted_user_partial,
    COALESCE(sp.persisted_blocker, FALSE) AS persisted_blocker,
    COALESCE(sp.persisted_plan_signal, FALSE) AS persisted_plan_signal,
    COALESCE(sp.persisted_goal_change, FALSE) AS persisted_goal_change,
    COALESCE(sp.persisted_proof_moment, FALSE) AS persisted_proof_moment,
    COALESCE(sp.persisted_user_visible_proof_line, FALSE) AS persisted_user_visible_proof_line,
    sp.persisted_proof_moment_type,
    sp.persisted_outcome_event_types,
    sp.persisted_event_ids,
  CASE
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IN ('write_user_yes_today') THEN 'write_user_yes'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) = 'write_user_no' THEN 'write_user_no'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) = 'write_user_partial' THEN 'write_user_partial'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IN ('no_outcome_write', 'ack_only', 'defer_to_pending_resolution', 'defer_to_contract_consent') THEN 'no_outcome_write'
    WHEN ib.inbound_body_preview ~* '(onboarding|didn''?t ask me|did the onboarding matter)' THEN 'no_outcome_write'
    WHEN ib.inbound_body_preview ~* '(i''?ll|i will|tomorrow|going to run|planning to)' THEN 'no_outcome_write'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IS NULL THEN 'unknown'
    ELSE 'unknown'
  END AS expected_persistence_decision
  FROM inbound_base ib
  CROSS JOIN bounds b
  LEFT JOIN LATERAL (
    SELECT e.payload_json
    FROM v2_commitment_event e
    WHERE e.event_type = 'sms_memory_signal'
      AND e.payload_json->>'inbound_turn_telemetry' = 'true'
      AND COALESCE(
        NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
        SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
      ) = ib.inbound_message_sid
    ORDER BY e.occurred_at DESC
    LIMIT 1
  ) tel ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      BOOL_OR(ev.event_type = 'user_yes') AS persisted_user_yes,
      BOOL_OR(ev.event_type = 'user_no') AS persisted_user_no,
      BOOL_OR(ev.event_type = 'user_partial') AS persisted_user_partial,
      BOOL_OR(ev.event_type = 'blocker_captured') AS persisted_blocker,
      BOOL_OR(
        ev.event_type = 'sms_memory_signal'
        AND ev.payload_json->'memory_signal' IS NOT NULL
        AND COALESCE(ev.payload_json->'memory_signal'->>'memory_signal_detected', 'false') = 'true'
      ) AS persisted_plan_signal,
      BOOL_OR(ev.event_type IN ('contract_overlay_proposed', 'contract_overlay_activated', 'ask_shrunk')) AS persisted_goal_change,
      BOOL_OR(COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS persisted_proof_moment,
      BOOL_OR(COALESCE(ev.payload_json->>'user_visible_proof_line', '') <> '') AS persisted_user_visible_proof_line,
      MAX(ev.payload_json->>'proof_moment_type') FILTER (WHERE COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS persisted_proof_moment_type,
      ARRAY_AGG(DISTINCT ev.event_type ORDER BY ev.event_type) FILTER (WHERE ev.event_type IN ('user_yes', 'user_no', 'user_partial')) AS persisted_outcome_event_types,
      ARRAY_AGG(ev.id ORDER BY ev.occurred_at) FILTER (WHERE ev.event_type IN ('user_yes', 'user_no', 'user_partial')) AS persisted_event_ids
    FROM v2_commitment_event ev
    WHERE COALESCE(
      NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(ev.payload_json->>'inbound_resolution_message_sid'), ''),
      SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) = ib.inbound_message_sid
  ) sp ON TRUE
),
classified_with_diag AS (
  SELECT
    c.*,
    CASE
      WHEN c.fix_era = 'pre_known_fix_window' AND c.is_known_historical_fixture IS NOT NULL THEN 'historical_pre_fix_observation'
      WHEN c.candidate_family IN ('meta_process_candidate', 'plan_candidate', 'safety_or_support_candidate')
        AND (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'false_outcome_written'
      WHEN c.persistence_decision IS NULL AND c.server_reconciled_persistence_decision IS NULL
        AND c.candidate_family NOT IN ('other', 'emotional_state_candidate', 'important_memory_candidate') THEN 'telemetry_missing'
      WHEN c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision IN ('write_user_yes', 'write_user_no', 'write_user_partial')
        AND c.fix_era = 'post_known_fix_window'
        AND c.is_known_historical_fixture IS NOT NULL
        AND NOT (
          (c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes)
          OR (c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no)
          OR (c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial)
        ) THEN 'current_code_failure_candidate'
      WHEN c.expected_persistence_decision IN ('write_user_yes', 'write_user_no', 'write_user_partial')
        AND c.fix_era = 'post_known_fix_window'
        AND NOT (
          (c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes)
          OR (c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no)
          OR (c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial)
        ) THEN 'expected_write_but_missing'
      WHEN c.expected_persistence_decision = 'no_outcome_write'
        AND NOT (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'server_no_outcome_expected'
      WHEN c.expected_persistence_decision = 'no_outcome_write'
        AND NOT (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'expected_no_write_and_none_written'
      WHEN c.candidate_family = 'other' THEN 'regex_weak_manual_review'
      WHEN c.expected_persistence_decision = 'unknown' THEN 'cert_join_uncertain'
      ELSE 'cert_join_uncertain'
    END AS cert_diagnostic,
    CASE
      WHEN c.candidate_family = 'other' THEN 'regex_family_uncertain_review_body'
      WHEN c.persistence_decision IS NULL AND c.server_reconciled_persistence_decision IS NULL THEN 'missing_turn_telemetry'
      WHEN c.candidate_family = 'plan_candidate' THEN 'plan_manual_review_expected_no_outcome_proof'
      ELSE NULL
    END AS needs_human_review_reason
  FROM classified_inbound c
)
SELECT
  c.inbound_at,
  c.fix_era,
  c.inbound_body_preview,
  c.cert_diagnostic,
  c.persisted_blocker,
  c.persisted_plan_signal,
  CASE
    WHEN c.persisted_blocker THEN 'blocker_saved_ok'
    WHEN c.candidate_family = 'blocker_candidate' AND NOT c.persisted_blocker THEN 'blocker_without_memory_signal'
    ELSE 'blocker_manual_review'
  END AS blocker_cert_diagnostic,
  c.needs_human_review_reason
FROM classified_with_diag c
WHERE c.candidate_family = 'blocker_candidate'
ORDER BY c.inbound_at DESC;



-- =============================================================================
-- QUERY 8 — goal_change_raise_lower_certification
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_user_yes,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_meta_process,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_weekly_miss_count
),
inbound_base AS (
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
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
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
    ) AS inbound_body_preview,
    to_jsonb(m) AS raw_inbound_json,
    to_jsonb(j) AS raw_job_json
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j
    ON j.message_sid = to_jsonb(m)->>'message_sid'
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) < b.window_end
    AND COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')
    ) IS NOT NULL
),
classified_inbound AS (
  SELECT
    ib.inbound_message_sid,
    ib.clerk_user_id,
    ib.inbound_at,
    (ib.inbound_at AT TIME ZONE 'America/New_York')::date AS local_day,
    ib.inbound_body_preview,
    ib.raw_inbound_json,
    ib.raw_job_json,
    CASE
      WHEN ib.inbound_body_preview ~* '(^|\s)(stop|unsubscribe|help|start)\b' THEN 'safety_or_support_candidate'
      WHEN ib.inbound_body_preview ~* '(onboarding|didn''?t ask me|did not ask me|did the onboarding matter|you didn''?t ask|coach forgot|process dispute|you said.*didn''?t)' THEN 'meta_process_candidate'
      WHEN ib.inbound_body_preview ~* '(change my goal|lower the bar|raise the bar|shrink|replace.*goal|adjust my goal)' THEN 'goal_change_candidate'
      WHEN ib.inbound_body_preview ~* '(got in the way|threw me off|blocker|rain|meetings|forgot my shoes|travel|sick|kids)' THEN 'blocker_candidate'
      WHEN ib.inbound_body_preview ~* '(i''?ll|i will|tomorrow|before breakfast|after work|setting my shoes|planning to|going to run|gonna run)' THEN 'plan_candidate'
      WHEN ib.inbound_body_preview ~* '(only did|half|started but didn''?t|did \d+ of \d+|some of it|part of it)' THEN 'partial_candidate'
      WHEN ib.inbound_body_preview ~* '(missed|didn''?t happen|did not happen|skipped|couldn''?t get|no run today|blew it|didn''?t hit)'
        AND ib.inbound_body_preview !~* '(didn''?t ask|onboarding matter)' THEN 'miss_candidate'
      WHEN ib.inbound_body_preview ~* '(got my|got it done|hit the goal|completed|finished|got my run in|ran this morning|miles done|steps today|knocked out|done this morning|did it)'
        AND ib.inbound_body_preview !~* '(should still|going to|tomorrow|plan to|gonna)' THEN 'completion_candidate'
      WHEN ib.inbound_body_preview ~* '(discouraged|struggling|overwhelmed|anxious|depressed|frustrated)' THEN 'emotional_state_candidate'
      WHEN ib.inbound_body_preview ~* '(my (wife|husband|mom|dad|daughter|son)|important person|identity)' THEN 'important_memory_candidate'
      ELSE 'other'
    END AS candidate_family,
    CASE
      WHEN ib.inbound_at < LEAST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= GREATEST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS fix_era,
    CASE
      WHEN ib.inbound_at < b.known_fix_cutover_at_user_yes THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= b.known_fix_cutover_at_user_yes THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS user_yes_fix_era,
    CASE
      WHEN ib.inbound_at < b.known_fix_cutover_at_meta_process THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= b.known_fix_cutover_at_meta_process THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS meta_process_fix_era,
    CASE
      WHEN ib.inbound_body_preview ILIKE '%got my distribution done today%' AND ib.inbound_body_preview ILIKE '%hit the goal%' THEN 'distribution_completion'
      WHEN ib.inbound_body_preview ~* '10[,]?000 steps today' THEN 'steps_completion'
      WHEN ib.inbound_body_preview ILIKE '%onboarding%' AND ib.inbound_body_preview ~* 'didn''?t ask' THEN 'onboarding_meta_dispute'
      WHEN ib.inbound_body_preview ~* '(going to run tomorrow|tomorrow i''?ll get it done)' THEN 'future_plan_negative'
      ELSE NULL
    END AS is_known_historical_fixture,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_relationship'), ''),
      NULLIF(BTRIM(tel.payload_json->>'turn_understanding_relationship_meaning'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning'->>'relationship_meaning'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning_facts'->>'relationship_meaning'), '')
    ) AS relationship_meaning,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning'->>'persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning_facts'->>'persistence_decision'), '')
    ) AS persistence_decision,
    NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), '') AS server_reconciled_persistence_decision,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'outcome_persist_skip_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->>'turn_understanding_persist_skip_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->'turn_understanding_persist_guard'->>'guard_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->>'outcome_persist_skip_reason_before_no_send'), '')
    ) AS persist_skip_reason,
    NULLIF(BTRIM(tel.payload_json->>'openai_turn_understanding_version'), '') AS prod_code_version,
    to_jsonb(tel.payload_json) AS raw_telemetry_json,
    COALESCE(sp.persisted_user_yes, FALSE) AS persisted_user_yes,
    COALESCE(sp.persisted_user_no, FALSE) AS persisted_user_no,
    COALESCE(sp.persisted_user_partial, FALSE) AS persisted_user_partial,
    COALESCE(sp.persisted_blocker, FALSE) AS persisted_blocker,
    COALESCE(sp.persisted_plan_signal, FALSE) AS persisted_plan_signal,
    COALESCE(sp.persisted_goal_change, FALSE) AS persisted_goal_change,
    COALESCE(sp.persisted_proof_moment, FALSE) AS persisted_proof_moment,
    COALESCE(sp.persisted_user_visible_proof_line, FALSE) AS persisted_user_visible_proof_line,
    sp.persisted_proof_moment_type,
    sp.persisted_outcome_event_types,
    sp.persisted_event_ids,
  CASE
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IN ('write_user_yes_today') THEN 'write_user_yes'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) = 'write_user_no' THEN 'write_user_no'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) = 'write_user_partial' THEN 'write_user_partial'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IN ('no_outcome_write', 'ack_only', 'defer_to_pending_resolution', 'defer_to_contract_consent') THEN 'no_outcome_write'
    WHEN ib.inbound_body_preview ~* '(onboarding|didn''?t ask me|did the onboarding matter)' THEN 'no_outcome_write'
    WHEN ib.inbound_body_preview ~* '(i''?ll|i will|tomorrow|going to run|planning to)' THEN 'no_outcome_write'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IS NULL THEN 'unknown'
    ELSE 'unknown'
  END AS expected_persistence_decision
  FROM inbound_base ib
  CROSS JOIN bounds b
  LEFT JOIN LATERAL (
    SELECT e.payload_json
    FROM v2_commitment_event e
    WHERE e.event_type = 'sms_memory_signal'
      AND e.payload_json->>'inbound_turn_telemetry' = 'true'
      AND COALESCE(
        NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
        SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
      ) = ib.inbound_message_sid
    ORDER BY e.occurred_at DESC
    LIMIT 1
  ) tel ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      BOOL_OR(ev.event_type = 'user_yes') AS persisted_user_yes,
      BOOL_OR(ev.event_type = 'user_no') AS persisted_user_no,
      BOOL_OR(ev.event_type = 'user_partial') AS persisted_user_partial,
      BOOL_OR(ev.event_type = 'blocker_captured') AS persisted_blocker,
      BOOL_OR(
        ev.event_type = 'sms_memory_signal'
        AND ev.payload_json->'memory_signal' IS NOT NULL
        AND COALESCE(ev.payload_json->'memory_signal'->>'memory_signal_detected', 'false') = 'true'
      ) AS persisted_plan_signal,
      BOOL_OR(ev.event_type IN ('contract_overlay_proposed', 'contract_overlay_activated', 'ask_shrunk')) AS persisted_goal_change,
      BOOL_OR(COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS persisted_proof_moment,
      BOOL_OR(COALESCE(ev.payload_json->>'user_visible_proof_line', '') <> '') AS persisted_user_visible_proof_line,
      MAX(ev.payload_json->>'proof_moment_type') FILTER (WHERE COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS persisted_proof_moment_type,
      ARRAY_AGG(DISTINCT ev.event_type ORDER BY ev.event_type) FILTER (WHERE ev.event_type IN ('user_yes', 'user_no', 'user_partial')) AS persisted_outcome_event_types,
      ARRAY_AGG(ev.id ORDER BY ev.occurred_at) FILTER (WHERE ev.event_type IN ('user_yes', 'user_no', 'user_partial')) AS persisted_event_ids
    FROM v2_commitment_event ev
    WHERE COALESCE(
      NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(ev.payload_json->>'inbound_resolution_message_sid'), ''),
      SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) = ib.inbound_message_sid
  ) sp ON TRUE
),
classified_with_diag AS (
  SELECT
    c.*,
    CASE
      WHEN c.fix_era = 'pre_known_fix_window' AND c.is_known_historical_fixture IS NOT NULL THEN 'historical_pre_fix_observation'
      WHEN c.candidate_family IN ('meta_process_candidate', 'plan_candidate', 'safety_or_support_candidate')
        AND (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'false_outcome_written'
      WHEN c.persistence_decision IS NULL AND c.server_reconciled_persistence_decision IS NULL
        AND c.candidate_family NOT IN ('other', 'emotional_state_candidate', 'important_memory_candidate') THEN 'telemetry_missing'
      WHEN c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision IN ('write_user_yes', 'write_user_no', 'write_user_partial')
        AND c.fix_era = 'post_known_fix_window'
        AND c.is_known_historical_fixture IS NOT NULL
        AND NOT (
          (c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes)
          OR (c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no)
          OR (c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial)
        ) THEN 'current_code_failure_candidate'
      WHEN c.expected_persistence_decision IN ('write_user_yes', 'write_user_no', 'write_user_partial')
        AND c.fix_era = 'post_known_fix_window'
        AND NOT (
          (c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes)
          OR (c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no)
          OR (c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial)
        ) THEN 'expected_write_but_missing'
      WHEN c.expected_persistence_decision = 'no_outcome_write'
        AND NOT (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'server_no_outcome_expected'
      WHEN c.expected_persistence_decision = 'no_outcome_write'
        AND NOT (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'expected_no_write_and_none_written'
      WHEN c.candidate_family = 'other' THEN 'regex_weak_manual_review'
      WHEN c.expected_persistence_decision = 'unknown' THEN 'cert_join_uncertain'
      ELSE 'cert_join_uncertain'
    END AS cert_diagnostic,
    CASE
      WHEN c.candidate_family = 'other' THEN 'regex_family_uncertain_review_body'
      WHEN c.persistence_decision IS NULL AND c.server_reconciled_persistence_decision IS NULL THEN 'missing_turn_telemetry'
      WHEN c.candidate_family = 'plan_candidate' THEN 'plan_manual_review_expected_no_outcome_proof'
      ELSE NULL
    END AS needs_human_review_reason
  FROM classified_inbound c
)
SELECT
  c.inbound_at,
  c.fix_era,
  c.inbound_body_preview,
  c.persistence_decision,
  c.cert_diagnostic,
  c.persisted_goal_change,
  CASE
    WHEN c.persisted_goal_change THEN 'goal_change_state_event_ok'
    WHEN c.candidate_family = 'goal_change_candidate' AND NOT c.persisted_goal_change THEN 'goal_change_without_state_event'
    ELSE 'goal_change_manual_review'
  END AS goal_change_cert_diagnostic,
  c.needs_human_review_reason
FROM classified_with_diag c
WHERE c.candidate_family = 'goal_change_candidate'
ORDER BY c.inbound_at DESC;



-- =============================================================================
-- QUERY 9 — victory_room_projection_certification
-- Spine proof fields → Victory Room display eligibility (loader reads spine live).
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_user_yes,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_meta_process,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_weekly_miss_count
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
      SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]32)$')
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
  (s.occurred_at AT TIME ZONE 'America/New_York')::date AS local_day,
  CASE
    WHEN s.occurred_at < LEAST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'pre_known_fix_window'
    WHEN s.occurred_at >= GREATEST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'post_known_fix_window'
    ELSE 'unknown_fix_era'
  END AS fix_era,
  s.clerk_user_id,
  s.commitment_id,
  s.event_type,
  s.message_sid,
  s.inbound_body_preview,
  s.proof_moment AS spine_has_proof,
  (COALESCE(s.user_visible_proof_line, '') <> '') AS proof_has_display_line,
  (
    s.proof_moment
    AND COALESCE(s.user_visible_proof_line, '') <> ''
    AND NOT s.season_lifecycle
    AND NOT s.exclude_from_proof_curation
    AND COALESCE(s.proof_moment_type, '') NOT IN ('memory_updated')
    AND s.inbound_body_preview !~* '(onboarding|didn''?t ask me|plan to|tomorrow|going to)'
  ) AS should_display_in_vr,
  (
    s.event_type IN ('user_yes', 'user_no', 'user_partial')
    AND s.proof_moment
    AND COALESCE(s.user_visible_proof_line, '') <> ''
    AND NOT (
      s.proof_moment
      AND COALESCE(s.user_visible_proof_line, '') <> ''
      AND NOT s.season_lifecycle
      AND NOT s.exclude_from_proof_curation
      AND COALESCE(s.proof_moment_type, '') NOT IN ('memory_updated')
      AND s.inbound_body_preview !~* '(onboarding|didn''?t ask me|plan to|tomorrow|going to)'
    )
  ) AS likely_vr_missing_projection,
  CASE
    WHEN s.inbound_body_preview ~* '(onboarding|didn''?t ask)' THEN 'meta_process_should_not_display'
    WHEN s.inbound_body_preview ~* '(plan to|tomorrow|going to)' THEN 'future_plan_should_not_display'
    WHEN s.proof_moment_type = 'memory_updated' THEN 'memory_updated_should_not_display'
    WHEN NOT s.proof_moment AND s.event_type IN ('user_yes','user_no','user_partial') THEN 'spine_missing_truth_not_vr_bug'
    ELSE NULL
  END AS negative_control_reason,
  (
    s.inbound_body_preview ~* '(onboarding|plan to|tomorrow|going to)'
    OR s.proof_moment_type = 'memory_updated'
  ) AS plan_meta_future_should_not_display,
  s.proof_moment_type,
  s.user_visible_proof_line,
  CASE
    WHEN s.proof_moment AND COALESCE(s.user_visible_proof_line, '') <> '' THEN 'victory_room_projection_candidate'
    WHEN NOT s.proof_moment AND s.event_type IN ('user_yes','user_no','user_partial') THEN 'victory_room_missing_projection_candidate'
    ELSE 'non_proof_expected'
  END AS cert_diagnostic,
  s.raw_payload_json
FROM spine s
CROSS JOIN bounds b
ORDER BY s.occurred_at DESC, s.clerk_user_id;


-- =============================================================================
-- QUERY 10 — next_sms_truth_usage_certification
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_user_yes,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_meta_process,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_weekly_miss_count
),
truth_events AS (
  SELECT
    ev.occurred_at AS truth_at,
    ev.clerk_user_id,
    ev.event_type AS truth_event_type,
    COALESCE(
      NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''),
      SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]32)$')
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
    CASE
      WHEN t.truth_at < LEAST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'pre_known_fix_window'
      WHEN t.truth_at >= GREATEST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS fix_era,
    nd.next_outbound_at,
    nd.next_outbound_body_preview,
    nd.next_outbound_status
  FROM truth_events t
  CROSS JOIN bounds b
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
  p.fix_era,
  p.clerk_user_id,
  p.message_sid,
  p.inbound_body_preview AS inbound_body,
  p.truth_event_type AS truth_event_written,
  p.next_outbound_body_preview AS next_outbound_sms_body,
  p.next_outbound_status,
  CASE
    WHEN p.next_outbound_body_preview IS NULL THEN 'no_next_sms_yet'
    WHEN p.truth_event_type = 'user_yes' AND p.next_outbound_body_preview ~* '(missed|didn''?t hit)' THEN 'next_sms_contradicts_truth'
    WHEN p.truth_event_type = 'user_no' AND p.next_outbound_body_preview ~* '(great job|completed every|perfect)' THEN 'next_sms_contradicts_truth'
    WHEN p.next_outbound_body_preview IS NOT NULL THEN 'next_sms_uses_truth'
    ELSE 'manual_review'
  END AS cert_diagnostic
FROM paired p
ORDER BY p.truth_at DESC;


-- =============================================================================
-- QUERY 11 — no_send_truth_loss_certification
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_user_yes,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_meta_process,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_weekly_miss_count
),
inbound_base AS (
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
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
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
    ) AS inbound_body_preview,
    to_jsonb(m) AS raw_inbound_json,
    to_jsonb(j) AS raw_job_json
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j
    ON j.message_sid = to_jsonb(m)->>'message_sid'
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) < b.window_end
    AND COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')
    ) IS NOT NULL
),
classified_inbound AS (
  SELECT ib.*, b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count
  FROM inbound_base ib CROSS JOIN bounds b
),
inbound AS (
  SELECT
    c.inbound_message_sid AS message_sid,
    c.clerk_user_id,
    c.inbound_at,
    c.inbound_body_preview,
    CASE
      WHEN c.inbound_at < LEAST(c.known_fix_cutover_at_user_yes, c.known_fix_cutover_at_meta_process, c.known_fix_cutover_at_weekly_miss_count) THEN 'pre_known_fix_window'
      WHEN c.inbound_at >= GREATEST(c.known_fix_cutover_at_user_yes, c.known_fix_cutover_at_meta_process, c.known_fix_cutover_at_weekly_miss_count) THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS fix_era,
    to_jsonb(c.raw_job_json)->>'status' AS job_status,
    LEFT(COALESCE(NULLIF(BTRIM(to_jsonb(c.raw_job_json)->>'reply_body'), ''), ''), 280) AS reply_body_preview
  FROM classified_inbound c
)
SELECT
  i.inbound_at,
  i.fix_era,
  i.clerk_user_id,
  i.message_sid,
  i.inbound_body_preview,
  i.job_status,
  COALESCE(tel.no_send_reason, tel.unified_final_guard_no_send_reason, '') AS no_send_reason,
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
      AND i.fix_era = 'post_known_fix_window'
      THEN 'current_code_failure_candidate'
    WHEN tel.persistence_decision = 'no_outcome_write' AND NOT COALESCE(truth.any_truth_row, FALSE) THEN 'server_no_outcome_expected'
    ELSE 'manual_review'
  END AS cert_diagnostic
FROM inbound i
LEFT JOIN LATERAL (
  SELECT
    NULLIF(BTRIM(e.payload_json->>'no_send_reason'), '') AS no_send_reason,
    NULLIF(BTRIM(e.payload_json->>'unified_final_guard_no_send_reason'), '') AS unified_final_guard_no_send_reason,
    NULLIF(BTRIM(e.payload_json->>'inbound_meaning_persistence'), '') AS persistence_decision
  FROM v2_commitment_event e
  WHERE e.event_type = 'sms_memory_signal'
    AND e.payload_json->>'inbound_turn_telemetry' = 'true'
    AND COALESCE(NULLIF(BTRIM(e.payload_json->>'message_sid'), ''), SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]32)$')) = i.message_sid
  ORDER BY e.occurred_at DESC LIMIT 1
) tel ON TRUE
LEFT JOIN LATERAL (
  SELECT
    BOOL_OR(ev.event_type IN ('user_yes','user_no','user_partial','blocker_captured')) AS any_truth_row,
    string_agg(DISTINCT ev.event_type, ', ' ORDER BY ev.event_type) AS truth_event_types
  FROM v2_commitment_event ev
  WHERE COALESCE(NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''), SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]32)$')) = i.message_sid
) truth ON TRUE
WHERE i.inbound_body_preview ~* '(hit the goal|got my|missed|didn''?t|did half|blocker|change my goal|onboarding)'
  AND (i.job_status IS DISTINCT FROM 'sent' OR tel.no_send_reason IS NOT NULL)
ORDER BY i.inbound_at DESC;


-- =============================================================================
-- QUERY 12 — certification_scoreboard
-- Start here. Mismatch = post-fix failures only (not historical_pre_fix_observation).
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_user_yes,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_meta_process,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_weekly_miss_count
),
inbound_base AS (
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
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
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
    ) AS inbound_body_preview,
    to_jsonb(m) AS raw_inbound_json,
    to_jsonb(j) AS raw_job_json
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j
    ON j.message_sid = to_jsonb(m)->>'message_sid'
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) < b.window_end
    AND COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')
    ) IS NOT NULL
),
classified_inbound AS (
  SELECT
    ib.inbound_message_sid,
    ib.clerk_user_id,
    ib.inbound_at,
    (ib.inbound_at AT TIME ZONE 'America/New_York')::date AS local_day,
    ib.inbound_body_preview,
    ib.raw_inbound_json,
    ib.raw_job_json,
    CASE
      WHEN ib.inbound_body_preview ~* '(^|\s)(stop|unsubscribe|help|start)\b' THEN 'safety_or_support_candidate'
      WHEN ib.inbound_body_preview ~* '(onboarding|didn''?t ask me|did not ask me|did the onboarding matter|you didn''?t ask|coach forgot|process dispute|you said.*didn''?t)' THEN 'meta_process_candidate'
      WHEN ib.inbound_body_preview ~* '(change my goal|lower the bar|raise the bar|shrink|replace.*goal|adjust my goal)' THEN 'goal_change_candidate'
      WHEN ib.inbound_body_preview ~* '(got in the way|threw me off|blocker|rain|meetings|forgot my shoes|travel|sick|kids)' THEN 'blocker_candidate'
      WHEN ib.inbound_body_preview ~* '(i''?ll|i will|tomorrow|before breakfast|after work|setting my shoes|planning to|going to run|gonna run)' THEN 'plan_candidate'
      WHEN ib.inbound_body_preview ~* '(only did|half|started but didn''?t|did \d+ of \d+|some of it|part of it)' THEN 'partial_candidate'
      WHEN ib.inbound_body_preview ~* '(missed|didn''?t happen|did not happen|skipped|couldn''?t get|no run today|blew it|didn''?t hit)'
        AND ib.inbound_body_preview !~* '(didn''?t ask|onboarding matter)' THEN 'miss_candidate'
      WHEN ib.inbound_body_preview ~* '(got my|got it done|hit the goal|completed|finished|got my run in|ran this morning|miles done|steps today|knocked out|done this morning|did it)'
        AND ib.inbound_body_preview !~* '(should still|going to|tomorrow|plan to|gonna)' THEN 'completion_candidate'
      WHEN ib.inbound_body_preview ~* '(discouraged|struggling|overwhelmed|anxious|depressed|frustrated)' THEN 'emotional_state_candidate'
      WHEN ib.inbound_body_preview ~* '(my (wife|husband|mom|dad|daughter|son)|important person|identity)' THEN 'important_memory_candidate'
      ELSE 'other'
    END AS candidate_family,
    CASE
      WHEN ib.inbound_at < LEAST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= GREATEST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS fix_era,
    CASE
      WHEN ib.inbound_at < b.known_fix_cutover_at_user_yes THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= b.known_fix_cutover_at_user_yes THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS user_yes_fix_era,
    CASE
      WHEN ib.inbound_at < b.known_fix_cutover_at_meta_process THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= b.known_fix_cutover_at_meta_process THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS meta_process_fix_era,
    CASE
      WHEN ib.inbound_body_preview ILIKE '%got my distribution done today%' AND ib.inbound_body_preview ILIKE '%hit the goal%' THEN 'distribution_completion'
      WHEN ib.inbound_body_preview ~* '10[,]?000 steps today' THEN 'steps_completion'
      WHEN ib.inbound_body_preview ILIKE '%onboarding%' AND ib.inbound_body_preview ~* 'didn''?t ask' THEN 'onboarding_meta_dispute'
      WHEN ib.inbound_body_preview ~* '(going to run tomorrow|tomorrow i''?ll get it done)' THEN 'future_plan_negative'
      ELSE NULL
    END AS is_known_historical_fixture,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_relationship'), ''),
      NULLIF(BTRIM(tel.payload_json->>'turn_understanding_relationship_meaning'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning'->>'relationship_meaning'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning_facts'->>'relationship_meaning'), '')
    ) AS relationship_meaning,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning'->>'persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning_facts'->>'persistence_decision'), '')
    ) AS persistence_decision,
    NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), '') AS server_reconciled_persistence_decision,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'outcome_persist_skip_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->>'turn_understanding_persist_skip_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->'turn_understanding_persist_guard'->>'guard_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->>'outcome_persist_skip_reason_before_no_send'), '')
    ) AS persist_skip_reason,
    NULLIF(BTRIM(tel.payload_json->>'openai_turn_understanding_version'), '') AS prod_code_version,
    to_jsonb(tel.payload_json) AS raw_telemetry_json,
    COALESCE(sp.persisted_user_yes, FALSE) AS persisted_user_yes,
    COALESCE(sp.persisted_user_no, FALSE) AS persisted_user_no,
    COALESCE(sp.persisted_user_partial, FALSE) AS persisted_user_partial,
    COALESCE(sp.persisted_blocker, FALSE) AS persisted_blocker,
    COALESCE(sp.persisted_plan_signal, FALSE) AS persisted_plan_signal,
    COALESCE(sp.persisted_goal_change, FALSE) AS persisted_goal_change,
    COALESCE(sp.persisted_proof_moment, FALSE) AS persisted_proof_moment,
    COALESCE(sp.persisted_user_visible_proof_line, FALSE) AS persisted_user_visible_proof_line,
    sp.persisted_proof_moment_type,
    sp.persisted_outcome_event_types,
    sp.persisted_event_ids,
  CASE
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IN ('write_user_yes_today') THEN 'write_user_yes'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) = 'write_user_no' THEN 'write_user_no'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) = 'write_user_partial' THEN 'write_user_partial'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IN ('no_outcome_write', 'ack_only', 'defer_to_pending_resolution', 'defer_to_contract_consent') THEN 'no_outcome_write'
    WHEN ib.inbound_body_preview ~* '(onboarding|didn''?t ask me|did the onboarding matter)' THEN 'no_outcome_write'
    WHEN ib.inbound_body_preview ~* '(i''?ll|i will|tomorrow|going to run|planning to)' THEN 'no_outcome_write'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IS NULL THEN 'unknown'
    ELSE 'unknown'
  END AS expected_persistence_decision
  FROM inbound_base ib
  CROSS JOIN bounds b
  LEFT JOIN LATERAL (
    SELECT e.payload_json
    FROM v2_commitment_event e
    WHERE e.event_type = 'sms_memory_signal'
      AND e.payload_json->>'inbound_turn_telemetry' = 'true'
      AND COALESCE(
        NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
        SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
      ) = ib.inbound_message_sid
    ORDER BY e.occurred_at DESC
    LIMIT 1
  ) tel ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      BOOL_OR(ev.event_type = 'user_yes') AS persisted_user_yes,
      BOOL_OR(ev.event_type = 'user_no') AS persisted_user_no,
      BOOL_OR(ev.event_type = 'user_partial') AS persisted_user_partial,
      BOOL_OR(ev.event_type = 'blocker_captured') AS persisted_blocker,
      BOOL_OR(
        ev.event_type = 'sms_memory_signal'
        AND ev.payload_json->'memory_signal' IS NOT NULL
        AND COALESCE(ev.payload_json->'memory_signal'->>'memory_signal_detected', 'false') = 'true'
      ) AS persisted_plan_signal,
      BOOL_OR(ev.event_type IN ('contract_overlay_proposed', 'contract_overlay_activated', 'ask_shrunk')) AS persisted_goal_change,
      BOOL_OR(COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS persisted_proof_moment,
      BOOL_OR(COALESCE(ev.payload_json->>'user_visible_proof_line', '') <> '') AS persisted_user_visible_proof_line,
      MAX(ev.payload_json->>'proof_moment_type') FILTER (WHERE COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS persisted_proof_moment_type,
      ARRAY_AGG(DISTINCT ev.event_type ORDER BY ev.event_type) FILTER (WHERE ev.event_type IN ('user_yes', 'user_no', 'user_partial')) AS persisted_outcome_event_types,
      ARRAY_AGG(ev.id ORDER BY ev.occurred_at) FILTER (WHERE ev.event_type IN ('user_yes', 'user_no', 'user_partial')) AS persisted_event_ids
    FROM v2_commitment_event ev
    WHERE COALESCE(
      NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(ev.payload_json->>'inbound_resolution_message_sid'), ''),
      SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) = ib.inbound_message_sid
  ) sp ON TRUE
),
classified_with_diag AS (
  SELECT
    c.*,
    CASE
      WHEN c.fix_era = 'pre_known_fix_window' AND c.is_known_historical_fixture IS NOT NULL THEN 'historical_pre_fix_observation'
      WHEN c.candidate_family IN ('meta_process_candidate', 'plan_candidate', 'safety_or_support_candidate')
        AND (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'false_outcome_written'
      WHEN c.persistence_decision IS NULL AND c.server_reconciled_persistence_decision IS NULL
        AND c.candidate_family NOT IN ('other', 'emotional_state_candidate', 'important_memory_candidate') THEN 'telemetry_missing'
      WHEN c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision IN ('write_user_yes', 'write_user_no', 'write_user_partial')
        AND c.fix_era = 'post_known_fix_window'
        AND c.is_known_historical_fixture IS NOT NULL
        AND NOT (
          (c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes)
          OR (c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no)
          OR (c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial)
        ) THEN 'current_code_failure_candidate'
      WHEN c.expected_persistence_decision IN ('write_user_yes', 'write_user_no', 'write_user_partial')
        AND c.fix_era = 'post_known_fix_window'
        AND NOT (
          (c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes)
          OR (c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no)
          OR (c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial)
        ) THEN 'expected_write_but_missing'
      WHEN c.expected_persistence_decision = 'no_outcome_write'
        AND NOT (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'server_no_outcome_expected'
      WHEN c.expected_persistence_decision = 'no_outcome_write'
        AND NOT (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'expected_no_write_and_none_written'
      WHEN c.candidate_family = 'other' THEN 'regex_weak_manual_review'
      WHEN c.expected_persistence_decision = 'unknown' THEN 'cert_join_uncertain'
      ELSE 'cert_join_uncertain'
    END AS cert_diagnostic,
    CASE
      WHEN c.candidate_family = 'other' THEN 'regex_family_uncertain_review_body'
      WHEN c.persistence_decision IS NULL AND c.server_reconciled_persistence_decision IS NULL THEN 'missing_turn_telemetry'
      WHEN c.candidate_family = 'plan_candidate' THEN 'plan_manual_review_expected_no_outcome_proof'
      ELSE NULL
    END AS needs_human_review_reason
  FROM classified_inbound c
)
SELECT
  c.fix_era,
  c.candidate_family,
  c.cert_diagnostic,
  c.expected_persistence_decision,
  COUNT(*) AS total_candidates,
  COUNT(*) FILTER (WHERE c.cert_diagnostic = 'outcome_written_ok') AS outcome_written_ok_count,
  COUNT(*) FILTER (WHERE c.cert_diagnostic = 'expected_write_but_missing') AS expected_write_but_missing_count,
  COUNT(*) FILTER (WHERE c.cert_diagnostic = 'false_outcome_written') AS false_outcome_written_count,
  COUNT(*) FILTER (WHERE c.cert_diagnostic = 'historical_pre_fix_observation') AS historical_pre_fix_observation_count,
  COUNT(*) FILTER (WHERE c.cert_diagnostic = 'regex_weak_manual_review') AS regex_weak_manual_review_count,
  COUNT(*) FILTER (WHERE c.cert_diagnostic IN ('cert_join_uncertain', 'telemetry_missing')) AS cert_join_uncertain_count,
  COUNT(*) FILTER (WHERE c.cert_diagnostic = 'current_code_failure_candidate') AS current_code_failure_candidate_count,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE c.cert_diagnostic IN ('expected_write_but_missing', 'false_outcome_written', 'current_code_failure_candidate'))
    / NULLIF(COUNT(*) FILTER (WHERE c.fix_era = 'post_known_fix_window'), 0),
    2
  ) AS post_fix_mismatch_rate_pct,
  (
    SELECT ARRAY_AGG(ex.inbound_body_preview ORDER BY ex.inbound_body_preview)
    FROM (
      SELECT DISTINCT c2.inbound_body_preview
      FROM classified_with_diag c2
      WHERE c2.fix_era = c.fix_era
        AND c2.candidate_family = c.candidate_family
        AND c2.cert_diagnostic IN ('expected_write_but_missing', 'false_outcome_written', 'current_code_failure_candidate')
      LIMIT 5
    ) ex
  ) AS top_mismatch_examples
FROM classified_with_diag c
GROUP BY c.fix_era, c.candidate_family, c.cert_diagnostic, c.expected_persistence_decision
ORDER BY c.fix_era DESC, current_code_failure_candidate_count DESC NULLS LAST, false_outcome_written_count DESC NULLS LAST, total_candidates DESC;



-- =============================================================================
-- QUERY 13 — Q13_known_fixture_drilldown
-- Known historical certification fixtures + post-fix verification.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_user_yes,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_meta_process,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_weekly_miss_count
),
inbound_base AS (
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
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
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
    ) AS inbound_body_preview,
    to_jsonb(m) AS raw_inbound_json,
    to_jsonb(j) AS raw_job_json
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j
    ON j.message_sid = to_jsonb(m)->>'message_sid'
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) < b.window_end
    AND COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')
    ) IS NOT NULL
),
classified_inbound AS (
  SELECT
    ib.inbound_message_sid,
    ib.clerk_user_id,
    ib.inbound_at,
    (ib.inbound_at AT TIME ZONE 'America/New_York')::date AS local_day,
    ib.inbound_body_preview,
    ib.raw_inbound_json,
    ib.raw_job_json,
    CASE
      WHEN ib.inbound_body_preview ~* '(^|\s)(stop|unsubscribe|help|start)\b' THEN 'safety_or_support_candidate'
      WHEN ib.inbound_body_preview ~* '(onboarding|didn''?t ask me|did not ask me|did the onboarding matter|you didn''?t ask|coach forgot|process dispute|you said.*didn''?t)' THEN 'meta_process_candidate'
      WHEN ib.inbound_body_preview ~* '(change my goal|lower the bar|raise the bar|shrink|replace.*goal|adjust my goal)' THEN 'goal_change_candidate'
      WHEN ib.inbound_body_preview ~* '(got in the way|threw me off|blocker|rain|meetings|forgot my shoes|travel|sick|kids)' THEN 'blocker_candidate'
      WHEN ib.inbound_body_preview ~* '(i''?ll|i will|tomorrow|before breakfast|after work|setting my shoes|planning to|going to run|gonna run)' THEN 'plan_candidate'
      WHEN ib.inbound_body_preview ~* '(only did|half|started but didn''?t|did \d+ of \d+|some of it|part of it)' THEN 'partial_candidate'
      WHEN ib.inbound_body_preview ~* '(missed|didn''?t happen|did not happen|skipped|couldn''?t get|no run today|blew it|didn''?t hit)'
        AND ib.inbound_body_preview !~* '(didn''?t ask|onboarding matter)' THEN 'miss_candidate'
      WHEN ib.inbound_body_preview ~* '(got my|got it done|hit the goal|completed|finished|got my run in|ran this morning|miles done|steps today|knocked out|done this morning|did it)'
        AND ib.inbound_body_preview !~* '(should still|going to|tomorrow|plan to|gonna)' THEN 'completion_candidate'
      WHEN ib.inbound_body_preview ~* '(discouraged|struggling|overwhelmed|anxious|depressed|frustrated)' THEN 'emotional_state_candidate'
      WHEN ib.inbound_body_preview ~* '(my (wife|husband|mom|dad|daughter|son)|important person|identity)' THEN 'important_memory_candidate'
      ELSE 'other'
    END AS candidate_family,
    CASE
      WHEN ib.inbound_at < LEAST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= GREATEST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS fix_era,
    CASE
      WHEN ib.inbound_at < b.known_fix_cutover_at_user_yes THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= b.known_fix_cutover_at_user_yes THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS user_yes_fix_era,
    CASE
      WHEN ib.inbound_at < b.known_fix_cutover_at_meta_process THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= b.known_fix_cutover_at_meta_process THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS meta_process_fix_era,
    CASE
      WHEN ib.inbound_body_preview ILIKE '%got my distribution done today%' AND ib.inbound_body_preview ILIKE '%hit the goal%' THEN 'distribution_completion'
      WHEN ib.inbound_body_preview ~* '10[,]?000 steps today' THEN 'steps_completion'
      WHEN ib.inbound_body_preview ILIKE '%onboarding%' AND ib.inbound_body_preview ~* 'didn''?t ask' THEN 'onboarding_meta_dispute'
      WHEN ib.inbound_body_preview ~* '(going to run tomorrow|tomorrow i''?ll get it done)' THEN 'future_plan_negative'
      ELSE NULL
    END AS is_known_historical_fixture,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_relationship'), ''),
      NULLIF(BTRIM(tel.payload_json->>'turn_understanding_relationship_meaning'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning'->>'relationship_meaning'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning_facts'->>'relationship_meaning'), '')
    ) AS relationship_meaning,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning'->>'persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning_facts'->>'persistence_decision'), '')
    ) AS persistence_decision,
    NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), '') AS server_reconciled_persistence_decision,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'outcome_persist_skip_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->>'turn_understanding_persist_skip_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->'turn_understanding_persist_guard'->>'guard_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->>'outcome_persist_skip_reason_before_no_send'), '')
    ) AS persist_skip_reason,
    NULLIF(BTRIM(tel.payload_json->>'openai_turn_understanding_version'), '') AS prod_code_version,
    to_jsonb(tel.payload_json) AS raw_telemetry_json,
    COALESCE(sp.persisted_user_yes, FALSE) AS persisted_user_yes,
    COALESCE(sp.persisted_user_no, FALSE) AS persisted_user_no,
    COALESCE(sp.persisted_user_partial, FALSE) AS persisted_user_partial,
    COALESCE(sp.persisted_blocker, FALSE) AS persisted_blocker,
    COALESCE(sp.persisted_plan_signal, FALSE) AS persisted_plan_signal,
    COALESCE(sp.persisted_goal_change, FALSE) AS persisted_goal_change,
    COALESCE(sp.persisted_proof_moment, FALSE) AS persisted_proof_moment,
    COALESCE(sp.persisted_user_visible_proof_line, FALSE) AS persisted_user_visible_proof_line,
    sp.persisted_proof_moment_type,
    sp.persisted_outcome_event_types,
    sp.persisted_event_ids,
  CASE
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IN ('write_user_yes_today') THEN 'write_user_yes'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) = 'write_user_no' THEN 'write_user_no'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) = 'write_user_partial' THEN 'write_user_partial'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IN ('no_outcome_write', 'ack_only', 'defer_to_pending_resolution', 'defer_to_contract_consent') THEN 'no_outcome_write'
    WHEN ib.inbound_body_preview ~* '(onboarding|didn''?t ask me|did the onboarding matter)' THEN 'no_outcome_write'
    WHEN ib.inbound_body_preview ~* '(i''?ll|i will|tomorrow|going to run|planning to)' THEN 'no_outcome_write'
    WHEN COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
    ) IS NULL THEN 'unknown'
    ELSE 'unknown'
  END AS expected_persistence_decision
  FROM inbound_base ib
  CROSS JOIN bounds b
  LEFT JOIN LATERAL (
    SELECT e.payload_json
    FROM v2_commitment_event e
    WHERE e.event_type = 'sms_memory_signal'
      AND e.payload_json->>'inbound_turn_telemetry' = 'true'
      AND COALESCE(
        NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
        SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
      ) = ib.inbound_message_sid
    ORDER BY e.occurred_at DESC
    LIMIT 1
  ) tel ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      BOOL_OR(ev.event_type = 'user_yes') AS persisted_user_yes,
      BOOL_OR(ev.event_type = 'user_no') AS persisted_user_no,
      BOOL_OR(ev.event_type = 'user_partial') AS persisted_user_partial,
      BOOL_OR(ev.event_type = 'blocker_captured') AS persisted_blocker,
      BOOL_OR(
        ev.event_type = 'sms_memory_signal'
        AND ev.payload_json->'memory_signal' IS NOT NULL
        AND COALESCE(ev.payload_json->'memory_signal'->>'memory_signal_detected', 'false') = 'true'
      ) AS persisted_plan_signal,
      BOOL_OR(ev.event_type IN ('contract_overlay_proposed', 'contract_overlay_activated', 'ask_shrunk')) AS persisted_goal_change,
      BOOL_OR(COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS persisted_proof_moment,
      BOOL_OR(COALESCE(ev.payload_json->>'user_visible_proof_line', '') <> '') AS persisted_user_visible_proof_line,
      MAX(ev.payload_json->>'proof_moment_type') FILTER (WHERE COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)) AS persisted_proof_moment_type,
      ARRAY_AGG(DISTINCT ev.event_type ORDER BY ev.event_type) FILTER (WHERE ev.event_type IN ('user_yes', 'user_no', 'user_partial')) AS persisted_outcome_event_types,
      ARRAY_AGG(ev.id ORDER BY ev.occurred_at) FILTER (WHERE ev.event_type IN ('user_yes', 'user_no', 'user_partial')) AS persisted_event_ids
    FROM v2_commitment_event ev
    WHERE COALESCE(
      NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(ev.payload_json->>'inbound_resolution_message_sid'), ''),
      SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) = ib.inbound_message_sid
  ) sp ON TRUE
),
classified_with_diag AS (
  SELECT
    c.*,
    CASE
      WHEN c.fix_era = 'pre_known_fix_window' AND c.is_known_historical_fixture IS NOT NULL THEN 'historical_pre_fix_observation'
      WHEN c.candidate_family IN ('meta_process_candidate', 'plan_candidate', 'safety_or_support_candidate')
        AND (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'false_outcome_written'
      WHEN c.persistence_decision IS NULL AND c.server_reconciled_persistence_decision IS NULL
        AND c.candidate_family NOT IN ('other', 'emotional_state_candidate', 'important_memory_candidate') THEN 'telemetry_missing'
      WHEN c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision IN ('write_user_yes', 'write_user_no', 'write_user_partial')
        AND c.fix_era = 'post_known_fix_window'
        AND c.is_known_historical_fixture IS NOT NULL
        AND NOT (
          (c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes)
          OR (c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no)
          OR (c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial)
        ) THEN 'current_code_failure_candidate'
      WHEN c.expected_persistence_decision IN ('write_user_yes', 'write_user_no', 'write_user_partial')
        AND c.fix_era = 'post_known_fix_window'
        AND NOT (
          (c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes)
          OR (c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no)
          OR (c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial)
        ) THEN 'expected_write_but_missing'
      WHEN c.expected_persistence_decision = 'no_outcome_write'
        AND NOT (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'server_no_outcome_expected'
      WHEN c.expected_persistence_decision = 'no_outcome_write'
        AND NOT (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'expected_no_write_and_none_written'
      WHEN c.candidate_family = 'other' THEN 'regex_weak_manual_review'
      WHEN c.expected_persistence_decision = 'unknown' THEN 'cert_join_uncertain'
      ELSE 'cert_join_uncertain'
    END AS cert_diagnostic,
    CASE
      WHEN c.candidate_family = 'other' THEN 'regex_family_uncertain_review_body'
      WHEN c.persistence_decision IS NULL AND c.server_reconciled_persistence_decision IS NULL THEN 'missing_turn_telemetry'
      WHEN c.candidate_family = 'plan_candidate' THEN 'plan_manual_review_expected_no_outcome_proof'
      ELSE NULL
    END AS needs_human_review_reason
  FROM classified_inbound c
)
SELECT
  c.inbound_message_sid,
  c.inbound_at,
  c.local_day,
  c.fix_era,
  c.user_yes_fix_era,
  c.meta_process_fix_era,
  c.is_known_historical_fixture,
  c.inbound_body_preview,
  c.candidate_family,
  c.relationship_meaning,
  c.persistence_decision,
  c.server_reconciled_persistence_decision,
  c.expected_persistence_decision,
  c.cert_diagnostic,
  c.needs_human_review_reason,
  c.persisted_user_yes,
  c.persisted_user_no,
  c.persisted_user_partial,
  c.persisted_outcome_event_types,
  c.persisted_event_ids,
  c.persist_skip_reason,
  c.prod_code_version,
  c.raw_telemetry_json,
  c.raw_inbound_json,
  c.raw_job_json
FROM classified_with_diag c
WHERE c.is_known_historical_fixture IS NOT NULL
   OR c.inbound_body_preview ~* '(got my distribution done today|10[,]?000 steps today|onboarding.*didn''?t ask|going to run tomorrow)'
ORDER BY c.inbound_at DESC;
