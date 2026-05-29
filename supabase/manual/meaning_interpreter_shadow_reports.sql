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
