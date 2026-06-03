-- Manual read-only reports for Unified SMS Meaning Interpreter Shadow Mode (Phase 1 daily audit).
-- Run in Supabase SQL editor. Does not mutate data.
-- Replace :day_start / :day_end with timestamps, e.g.:
--   :day_start => '2026-05-27 00:00:00+00'
--   :day_end   => '2026-05-28 00:00:00+00'

-- A) Daily inbound jobs + deterministic outcome + shadow interpretation
SELECT
  j.message_sid,
  j.status AS job_status,
  j.sent_at,
  j.last_error,
  left(m.raw_body, 160) AS inbound_raw_preview,
  s.created_at AS shadow_created_at,
  s.deterministic_route,
  s.shadow_status,
  s.skipped_reason,
  s.outcome_sent,
  s.primary_intent,
  s.shadow_json ->> 'answer_type' AS answer_type,
  s.shadow_json -> 'secondary_intents' AS secondary_intents,
  s.confidence,
  s.disagreement,
  s.disagreement_flags,
  s.deterministic_facts
FROM sms_inbound_coach_jobs j
LEFT JOIN sms_inbound_messages m ON m.message_sid = j.message_sid
LEFT JOIN v2_sms_meaning_interpretation_shadow s ON s.inbound_message_sid = j.message_sid
WHERE j.created_at >= :day_start
  AND j.created_at < :day_end
ORDER BY j.created_at DESC
LIMIT 500;

-- B) Cancelled / no-send jobs with shadow interpretation
SELECT
  j.message_sid,
  j.status,
  j.last_error,
  s.deterministic_route,
  s.shadow_status,
  s.skipped_reason,
  s.outcome_sent,
  s.primary_intent,
  s.shadow_json,
  s.deterministic_facts ->> 'v3_no_send_reason' AS v3_no_send_reason,
  s.deterministic_facts ->> 'last_error_tag' AS last_error_tag,
  s.body_preview,
  left(m.raw_body, 160) AS inbound_raw_preview
FROM sms_inbound_coach_jobs j
LEFT JOIN sms_inbound_messages m ON m.message_sid = j.message_sid
INNER JOIN v2_sms_meaning_interpretation_shadow s ON s.inbound_message_sid = j.message_sid
WHERE j.created_at >= :day_start
  AND j.created_at < :day_end
  AND (j.status = 'cancelled' OR s.outcome_sent = false)
ORDER BY j.created_at DESC
LIMIT 200;

-- C) Disagreements: OpenAI answered prior question but deterministic cancelled / wrong route
SELECT
  s.created_at,
  s.inbound_message_sid,
  s.deterministic_route,
  s.outcome_sent,
  s.primary_intent,
  s.shadow_json -> 'secondary_intents' AS secondary_intents,
  s.shadow_json ->> 'answered_prior_open_question' AS answered_prior_open_question,
  s.disagreement_flags,
  s.deterministic_facts ->> 'open_question_text' AS open_question_text,
  s.deterministic_facts ->> 'expected_reply_semantics' AS expected_reply_semantics,
  s.deterministic_facts ->> 'open_question_routing_miss' AS open_question_routing_miss,
  s.body_preview
FROM v2_sms_meaning_interpretation_shadow s
WHERE s.created_at >= :day_start
  AND s.created_at < :day_end
  AND (
    'shadow_answered_prior_question_but_cancelled' = ANY(s.disagreement_flags)
    OR 'shadow_time_answer_vs_open_question_routing_miss' = ANY(s.disagreement_flags)
    OR 'shadow_open_question_answer_vs_route' = ANY(s.disagreement_flags)
  )
ORDER BY s.created_at DESC
LIMIT 100;

-- D) Short numeric replies after open questions
SELECT
  s.created_at,
  s.inbound_message_sid,
  s.body_preview,
  s.deterministic_facts ->> 'open_question_text' AS open_question_text,
  s.deterministic_facts ->> 'expected_reply_semantics' AS expected_reply_semantics,
  s.shadow_json -> 'secondary_intents' AS secondary_intents,
  s.shadow_json ->> 'answer_type' AS answer_type,
  s.primary_intent,
  s.deterministic_route,
  s.outcome_sent,
  left(m.raw_body, 80) AS inbound_raw
FROM v2_sms_meaning_interpretation_shadow s
LEFT JOIN sms_inbound_messages m ON m.message_sid = s.inbound_message_sid
WHERE s.created_at >= :day_start
  AND s.created_at < :day_end
  AND (
    s.deterministic_facts ->> 'expected_reply_semantics' ILIKE '%time%'
    OR COALESCE(s.shadow_json -> 'secondary_intents', '[]'::jsonb) @> '["short_numeric_time_answer"]'::jsonb
    OR COALESCE(s.shadow_json -> 'secondary_intents', '[]'::jsonb) @> '["time_answer_to_prior_question"]'::jsonb
  )
ORDER BY s.created_at DESC
LIMIT 100;

-- E) Contract yes/no and support/cancel-like requests
SELECT
  s.created_at,
  s.inbound_message_sid,
  s.deterministic_route,
  s.outcome_sent,
  s.primary_intent,
  s.shadow_json -> 'secondary_intents' AS secondary_intents,
  s.shadow_json ->> 'answer_type' AS answer_type,
  s.deterministic_facts ->> 'gate_reason' AS gate_reason,
  s.deterministic_facts ->> 'contract_consent_gate_miss' AS contract_consent_gate_miss,
  s.disagreement_flags,
  s.body_preview,
  left(m.raw_body, 160) AS inbound_raw
FROM v2_sms_meaning_interpretation_shadow s
LEFT JOIN sms_inbound_messages m ON m.message_sid = s.inbound_message_sid
WHERE s.created_at >= :day_start
  AND s.created_at < :day_end
  AND (
    COALESCE(s.shadow_json -> 'secondary_intents', '[]'::jsonb) @> '["contract_yes_answer"]'::jsonb
    OR COALESCE(s.shadow_json -> 'secondary_intents', '[]'::jsonb) @> '["contract_no_answer"]'::jsonb
    OR COALESCE(s.shadow_json -> 'secondary_intents', '[]'::jsonb) @> '["cancellation_request"]'::jsonb
    OR COALESCE(s.shadow_json -> 'secondary_intents', '[]'::jsonb) @> '["support_request"]'::jsonb
    OR s.deterministic_route IN ('contract_consent', 'contract_ambiguous_consent', 'contract_consent_gate_miss')
  )
ORDER BY s.created_at DESC
LIMIT 100;

-- =============================================================================
-- S1 observability reports (read-only; use now() - interval or :day_start/:day_end)
-- =============================================================================

-- S1-A) Last 24h shadow rows by status
SELECT shadow_status, COUNT(*) AS n
FROM v2_sms_meaning_interpretation_shadow
WHERE created_at >= now() - interval '24 hours'
GROUP BY 1
ORDER BY n DESC;

-- S1-B) openai_failed by error_code (granular taxonomy)
SELECT error_code, COUNT(*) AS n
FROM v2_sms_meaning_interpretation_shadow
WHERE created_at >= now() - interval '24 hours'
  AND shadow_status = 'openai_failed'
GROUP BY 1
ORDER BY n DESC;

-- S1-C) schema_validation_failed samples with validation detail + job context
SELECT
  s.created_at,
  s.inbound_message_sid,
  s.error_code,
  s.model,
  s.deterministic_route,
  s.deterministic_facts -> 'shadow_failure_detail' AS validation_detail,
  s.deterministic_facts ->> 'classifier_event_type' AS classifier_event_type,
  s.body_preview,
  left(m.raw_body, 160) AS inbound_raw,
  j.status AS job_status,
  j.last_error IS NOT NULL AS job_has_last_error
FROM v2_sms_meaning_interpretation_shadow s
LEFT JOIN sms_inbound_messages m ON m.message_sid = s.inbound_message_sid
LEFT JOIN sms_inbound_coach_jobs j ON j.message_sid = s.inbound_message_sid
WHERE s.created_at >= now() - interval '24 hours'
  AND s.error_code = 'schema_validation_failed'
ORDER BY s.created_at DESC
LIMIT 50;

-- S1-D) Skipped rows by skipped_reason
SELECT skipped_reason, COUNT(*) AS n
FROM v2_sms_meaning_interpretation_shadow
WHERE created_at >= now() - interval '24 hours'
  AND shadow_status = 'skipped'
GROUP BY 1
ORDER BY n DESC;

-- S1-E) Safety/compliance/suppressed routes that incorrectly attempted OpenAI
SELECT
  s.deterministic_route,
  s.shadow_status,
  s.skipped_reason,
  s.error_code,
  s.deterministic_facts ->> 'skip_reason' AS facts_skip_reason,
  COUNT(*) AS n
FROM v2_sms_meaning_interpretation_shadow s
WHERE s.created_at >= now() - interval '7 days'
  AND s.deterministic_route IN (
    'safety_short_circuit_skipped',
    'compliance_skipped',
    'suppressed_tapback',
    'suppressed_no_send'
  )
GROUP BY 1, 2, 3, 4, 5
ORDER BY n DESC;

-- S1-F) openai_ok disagreement rate (7d)
SELECT
  COUNT(*) FILTER (WHERE shadow_status = 'openai_ok') AS openai_ok,
  COUNT(*) FILTER (WHERE shadow_status = 'openai_ok' AND disagreement = true) AS disagreed,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE shadow_status = 'openai_ok' AND disagreement = true)
    / NULLIF(COUNT(*) FILTER (WHERE shadow_status = 'openai_ok'), 0),
    1
  ) AS disagreement_pct
FROM v2_sms_meaning_interpretation_shadow
WHERE created_at >= now() - interval '7 days';

-- S1-G) Latency by status / error_code / model (24h)
SELECT
  shadow_status,
  error_code,
  model,
  COUNT(*) AS n,
  ROUND(AVG(latency_ms)) AS avg_latency_ms,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms)) AS p50_latency_ms,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)) AS p95_latency_ms
FROM v2_sms_meaning_interpretation_shadow
WHERE created_at >= now() - interval '24 hours'
  AND latency_ms IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY n DESC;
