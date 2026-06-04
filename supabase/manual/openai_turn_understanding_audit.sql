-- OpenAI Relationship Turn Understanding V1 — SELECT-only observability (no migration).
-- Inspect v2_commitment_event.payload_json and sms_inbound job metadata after deploy.

-- Recent inbound events with turn-understanding spine fields
SELECT
  e.created_at,
  e.event_type,
  e.message_sid,
  e.payload_json ->> 'server_reconciled_persistence_decision' AS server_reconciled_persistence,
  e.payload_json ->> 'persistence_narrowed_by_turn_understanding' AS persistence_narrowed,
  e.payload_json ->> 'persistence_narrowed_from' AS narrowed_from,
  e.payload_json ->> 'persistence_narrowed_to' AS narrowed_to,
  e.payload_json ->> 'turn_understanding_persistence_guard_reason' AS guard_reason,
  e.payload_json -> 'inbound_meaning' ->> 'relationship_meaning' AS deterministic_meaning
FROM v2_commitment_event e
WHERE e.created_at > now() - interval '14 days'
  AND e.payload_json ? 'openai_turn_understanding_version'
ORDER BY e.created_at DESC
LIMIT 200;

-- Interpreter failure rate (lane metadata on jobs — adjust table/column if your store differs)
-- SELECT
--   count(*) FILTER (WHERE metadata->>'interpreter_failed_reason' IS NOT NULL) AS failed,
--   count(*) FILTER (WHERE metadata->>'interpreter_failed_reason' IS NULL) AS ok,
--   avg((metadata->>'interpreter_latency_ms')::numeric) AS avg_latency_ms
-- FROM sms_inbound_coach_jobs
-- WHERE created_at > now() - interval '7 days';

-- OpenAI wanted write but server declined (disagreement on spine payload)
SELECT
  e.created_at,
  e.message_sid,
  e.payload_json ->> 'turn_understanding_persistence_recommendation' AS openai_rec,
  e.payload_json ->> 'server_reconciled_persistence_decision' AS server_decision,
  e.payload_json -> 'disagreement_flags' AS disagreement_flags
FROM v2_commitment_event e
WHERE e.created_at > now() - interval '14 days'
  AND e.payload_json -> 'disagreement_flags' ? 'server_rejected_openai_persistence'
ORDER BY e.created_at DESC
LIMIT 100;

-- last_ask_satisfied yes with narrowed persistence
SELECT
  e.created_at,
  e.message_sid,
  e.payload_json ->> 'turn_understanding_last_ask_satisfied' AS last_ask_satisfied,
  e.payload_json ->> 'stale_ask_avoided' AS stale_ask_avoided,
  e.payload_json ->> 'persistence_narrowed_by_turn_understanding' AS narrowed
FROM v2_commitment_event e
WHERE e.created_at > now() - interval '14 days'
  AND e.payload_json ->> 'turn_understanding_last_ask_satisfied' = 'yes'
ORDER BY e.created_at DESC
LIMIT 100;

-- Relationship meaning distribution (telemetry)
SELECT
  e.payload_json ->> 'turn_understanding_relationship_meaning' AS relationship_meaning,
  count(*) AS n
FROM v2_commitment_event e
WHERE e.created_at > now() - interval '30 days'
  AND e.payload_json ? 'turn_understanding_relationship_meaning'
GROUP BY 1
ORDER BY n DESC;

-- TU reconciled on spine but persist guard not applied (trump suspect)
SELECT
  e.created_at,
  e.message_sid,
  e.payload_json ->> 'turn_understanding_applied_to_persist' AS applied_to_persist,
  e.payload_json ->> 'turn_understanding_persist_skip_reason' AS persist_skip_reason,
  e.payload_json ->> 'server_reconciled_persistence_decision' AS server_decision,
  e.event_type
FROM v2_commitment_event e
WHERE e.created_at > now() - interval '14 days'
  AND e.payload_json ? 'openai_turn_understanding_version'
  AND coalesce(e.payload_json ->> 'turn_understanding_applied_to_persist', 'false') = 'false'
  AND e.event_type IN ('user_yes', 'user_no', 'user_partial')
ORDER BY e.created_at DESC
LIMIT 100;

-- Final body guard telemetry on outbound (job ai payload — adjust table if needed)
-- SELECT
--   created_at,
--   message_sid,
--   metadata -> 'ai' ->> 'turn_understanding_final_body_guard_ran' AS guard_ran,
--   metadata -> 'ai' ->> 'final_body_stale_ask_blocked' AS stale_blocked
-- FROM sms_inbound_coach_jobs
-- WHERE created_at > now() - interval '7 days';

-- Persistence narrowed rows
SELECT
  e.created_at,
  e.message_sid,
  e.payload_json ->> 'persistence_narrowed_by_turn_understanding' AS narrowed,
  e.payload_json ->> 'persistence_narrowed_from' AS narrowed_from,
  e.payload_json ->> 'persistence_narrowed_to' AS narrowed_to,
  e.payload_json ->> 'turn_understanding_persistence_guard_reason' AS guard_reason
FROM v2_commitment_event e
WHERE e.created_at > now() - interval '14 days'
  AND e.payload_json ->> 'persistence_narrowed_by_turn_understanding' = 'true'
ORDER BY e.created_at DESC
LIMIT 100;

-- Failed-safe fallback rows (interpreter failed but server conservative reconciled)
SELECT
  e.created_at,
  e.message_sid,
  e.payload_json ->> 'turn_understanding_failed_safe_fallback' AS failed_safe_fallback,
  e.payload_json ->> 'turn_understanding_failed_safe_reason' AS failed_safe_reason,
  e.payload_json ->> 'interpreter_failed_reason' AS interpreter_failed_reason,
  e.payload_json ->> 'server_reconciled_persistence_decision' AS server_persist
FROM v2_commitment_event e
WHERE e.created_at > now() - interval '14 days'
  AND e.payload_json ->> 'turn_understanding_failed_safe_fallback' = 'true'
ORDER BY e.created_at DESC
LIMIT 100;

-- Failed-safe but outbound still looks like stale calendar re-ask (manual review)
SELECT
  e.created_at,
  e.message_sid,
  e.payload_json ->> 'turn_understanding_failed_safe_reason' AS failed_safe_reason,
  e.payload_json -> 'do_not_repeat_asks' AS do_not_repeat_asks
FROM v2_commitment_event e
WHERE e.created_at > now() - interval '14 days'
  AND e.payload_json ->> 'turn_understanding_failed_safe_fallback' = 'true'
  AND e.payload_json ->> 'final_body_stale_ask_blocked' = 'true'
ORDER BY e.created_at DESC
LIMIT 50;

-- Final body guard did not run on sent normal inbound (spine metadata)
SELECT
  e.created_at,
  e.message_sid,
  e.payload_json ->> 'turn_understanding_final_body_guard_ran' AS guard_ran,
  e.payload_json ->> 'turn_understanding_skip_reason' AS skip_reason,
  e.payload_json ->> 'turn_understanding_applied' AS tu_applied
FROM v2_commitment_event e
WHERE e.created_at > now() - interval '14 days'
  AND e.payload_json ? 'openai_turn_understanding_version'
  AND coalesce(e.payload_json ->> 'turn_understanding_final_body_guard_ran', 'false') = 'false'
  AND coalesce(e.payload_json ->> 'turn_understanding_skip_reason', '') NOT LIKE 'hard_route_%'
ORDER BY e.created_at DESC
LIMIT 100;

-- Open-question vs TU intent (coaching move telemetry when both present)
SELECT
  e.created_at,
  e.message_sid,
  e.payload_json ->> 'turn_understanding_response_intent' AS tu_intent,
  e.payload_json ->> 'turn_understanding_last_ask_satisfied' AS last_ask_satisfied,
  e.payload_json -> 'inbound_meaning' ->> 'relationship_meaning' AS deterministic_meaning
FROM v2_commitment_event e
WHERE e.created_at > now() - interval '14 days'
  AND e.payload_json ->> 'turn_understanding_last_ask_satisfied' = 'yes'
  AND e.payload_json -> 'inbound_meaning' ->> 'relationship_meaning' = 'answer_to_prior_question'
ORDER BY e.created_at DESC
LIMIT 100;

-- Legacy fallback branch + final guard metadata
SELECT
  e.created_at,
  e.message_sid,
  e.payload_json -> 'ai' ->> 'fallback_reason' AS fallback_reason,
  e.payload_json -> 'ai' -> 'turn_understanding_final_body_guard' ->> 'turn_understanding_final_body_guard_ran' AS guard_ran
FROM v2_commitment_event e
WHERE e.created_at > now() - interval '14 days'
  AND e.payload_json -> 'ai' ->> 'fallback_reason' LIKE '%conversation_brain_legacy_fallback%'
ORDER BY e.created_at DESC
LIMIT 100;

-- Conversation brain skipped for authoritative TU (job logs — adjust if stored elsewhere)
-- SELECT message_sid, metadata
-- FROM sms_inbound_coach_jobs
-- WHERE metadata::text LIKE '%brain_gate_skipped_turn_understanding_authoritative%'
-- ORDER BY created_at DESC LIMIT 50;

-- Persistence by branch label
SELECT
  e.payload_json ->> 'inbound_outcome_persist_branch' AS persist_branch,
  count(*) AS n,
  count(*) FILTER (
    WHERE e.payload_json ->> 'turn_understanding_applied_to_persist' = 'true'
  ) AS tu_applied_n
FROM v2_commitment_event e
WHERE e.created_at > now() - interval '30 days'
  AND e.payload_json ? 'inbound_outcome_persist_branch'
GROUP BY 1
ORDER BY n DESC;

-- Deterministic classifier wanted outcome write but TU narrowed (no insert on narrowed skip)
SELECT
  e.created_at,
  e.message_sid,
  e.payload_json -> 'inbound_meaning' ->> 'persistence_decision' AS deterministic_persist,
  e.payload_json ->> 'server_reconciled_persistence_decision' AS tu_persist,
  e.payload_json ->> 'turn_understanding_persistence_guard_reason' AS guard_reason
FROM v2_commitment_event e
WHERE e.created_at > now() - interval '14 days'
  AND e.payload_json ? 'turn_understanding_persistence_guard_reason'
  AND e.payload_json ->> 'persistence_narrowed_by_turn_understanding' = 'true'
ORDER BY e.created_at DESC
LIMIT 100;
