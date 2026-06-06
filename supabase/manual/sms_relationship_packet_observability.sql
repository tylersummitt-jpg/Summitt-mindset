-- Manual read-only reports for Relationship Packet / Repair Snapshot observability.
-- Run in Supabase SQL editor. Does not mutate data.
--
-- Replace :day_start / :day_end with timestamps, e.g.:
--   :day_start => '2026-06-05 00:00:00+00'
--   :day_end   => '2026-06-06 00:00:00+00'
--
-- sms_send_events.status semantics (daily cron — do NOT count only status = 'sent'):
--   reserved                         — row reserved before build/send; not user-visible SMS yet
--   accepted / queued / sending      — common Twilio message.status after sendSMS success
--   sent / delivered                 — Twilio delivery progression (when present)
--   skipped_* / skipped_no_safe_v3_voice — intentional no-send (lane, FVG, prefs, cutover, …)
--   send_failed                      — build/Twilio/record failure
--   dry_run / skipped_missing_twilio — non-production send paths
-- After Twilio accept, cron sets message_sid and metadata.note = 'sent_to_twilio'.
-- Treat outbound as sent/accepted when ANY of:
--   status IN ('sent','delivered','queued','accepted','sending')
--   OR message_sid IS NOT NULL
--   OR metadata->>'note' = 'sent_to_twilio'
-- Skipped/no-send: status LIKE 'skipped_%' OR voice_decision LIKE 'skipped%'
-- Failed: status IN ('send_failed','failed','cancelled') on send events
--
-- JSON paths (post observability wiring):
--   Daily sent/skipped: sms_send_events.metadata->relationship_packet_observability
--   Daily no-send lane: sms_send_events.metadata->daily_v3_lane (legacy full lane blob)
--   Weekly: sms_weekly_send_events.metadata->relationship_packet_observability
--   Inbound spine: v2_commitment_event.payload_json->relationship_packet_observability
--                  (also under payload_json->ai and payload_json->v3_brain)
--   FVG: metadata->final_voice_gate (daily/weekly) or payload_json->final_voice_gate (inbound)

-- ---------------------------------------------------------------------------
-- A) Daily / inbound / weekly packet coverage (union view)
-- ---------------------------------------------------------------------------

-- A1) Daily outbound (sms_send_events)
SELECT
  'daily' AS lane,
  e.clerk_user_id,
  e.created_at,
  e.day_key AS period_key,
  e.status,
  e.message_sid,
  COALESCE(
    e.metadata->'relationship_packet_observability'->>'relationship_packet_version',
    e.metadata->'daily_v3_lane'->>'relationship_packet_version'
  ) AS relationship_packet_version,
  COALESCE(
    e.metadata->'relationship_packet_observability'->>'relationship_packet_truncated',
    e.metadata->'daily_v3_lane'->>'relationship_packet_truncated'
  ) AS relationship_packet_truncated,
  COALESCE(
    e.metadata->'relationship_packet_observability'->'truncated_sections',
    e.metadata->'daily_v3_lane'->'truncated_sections'
  ) AS truncated_sections,
  COALESCE(
    (e.metadata->'relationship_packet_observability'->>'included_thread_message_count')::int,
    (e.metadata->'daily_v3_lane'->>'included_thread_message_count')::int
  ) AS included_thread_message_count,
  COALESCE(
    (e.metadata->'relationship_packet_observability'->>'included_thread_window_hours')::int,
    (e.metadata->'daily_v3_lane'->>'included_thread_window_hours')::int
  ) AS included_thread_window_hours,
  COALESCE(
    (e.metadata->'relationship_packet_observability'->>'included_memory_7d_item_count')::int,
    (e.metadata->'daily_v3_lane'->>'included_memory_7d_item_count')::int
  ) AS included_memory_7d_item_count,
  COALESCE(
    (e.metadata->'relationship_packet_observability'->>'included_memory_30d_item_count')::int,
    (e.metadata->'daily_v3_lane'->>'included_memory_30d_item_count')::int
  ) AS included_memory_30d_item_count,
  COALESCE(
    e.metadata->>'skip_reason',
    e.metadata->'voice_send_decision'->>'skip_reason',
    e.metadata->'daily_v3_lane'->>'no_send_reason'
  ) AS no_send_reason,
  e.metadata->>'skip_source' AS skip_source,
  e.metadata->>'note' AS note,
  e.metadata->'daily_v3_lane'->>'no_send_reason' AS daily_v3_lane_no_send_reason,
  e.metadata->'final_voice_gate'->>'skip_reason' AS final_voice_gate_skip_reason,
  (COALESCE(
    (e.metadata->'final_voice_gate'->>'daily_stale_ask_detected')::boolean,
    (e.metadata->'daily_v3_lane'->>'daily_stale_ask_detected')::boolean
  )) AS daily_stale_ask_detected,
  (COALESCE(
    (e.metadata->'final_voice_gate'->>'daily_stale_ask_repair_attempted')::boolean,
    (e.metadata->'daily_v3_lane'->>'daily_stale_ask_repair_attempted')::boolean
  )) AS daily_stale_ask_repair_attempted,
  (COALESCE(
    (e.metadata->'final_voice_gate'->>'daily_stale_ask_repair_succeeded')::boolean,
    (e.metadata->'daily_v3_lane'->>'daily_stale_ask_repair_succeeded')::boolean
  )) AS daily_stale_ask_repair_succeeded,
  COALESCE(
    e.metadata->'final_voice_gate'->>'daily_stale_ask_no_send_reason',
    e.metadata->'daily_v3_lane'->>'daily_stale_ask_no_send_reason'
  ) AS daily_stale_ask_no_send_reason,
  COALESCE(
    e.metadata->'voice_send_decision'->>'daily_satisfied_ask_context_source',
    e.metadata->'daily_v3_lane'->>'daily_satisfied_ask_context_source',
    e.metadata->'relationship_packet_observability'->>'daily_satisfied_ask_context_source'
  ) AS daily_satisfied_ask_context_source,
  COALESCE(
    (e.metadata->'voice_send_decision'->>'do_not_repeat_asks_count')::int,
    (e.metadata->'daily_v3_lane'->>'do_not_repeat_asks_count')::int
  ) AS do_not_repeat_asks_count,
  e.metadata->>'voice_decision' AS voice_decision,
  e.metadata->'final_voice_gate'->>'final_voice_source' AS final_voice_source
FROM sms_send_events e
WHERE e.created_at >= :day_start
  AND e.created_at < :day_end
ORDER BY e.created_at DESC
LIMIT 500;

-- A2) Weekly outbound (sms_weekly_send_events)
SELECT
  'weekly' AS lane,
  w.clerk_user_id,
  w.created_at,
  w.week_key AS period_key,
  w.status,
  w.message_sid,
  COALESCE(
    w.metadata->'relationship_packet_observability'->>'relationship_packet_version',
    w.metadata->'weekly_lane_metadata'->>'relationship_packet_version'
  ) AS relationship_packet_version,
  COALESCE(
    w.metadata->'relationship_packet_observability'->>'relationship_packet_truncated',
    w.metadata->'weekly_lane_metadata'->>'relationship_packet_truncated'
  ) AS relationship_packet_truncated,
  COALESCE(
    w.metadata->'relationship_packet_observability'->'truncated_sections',
    w.metadata->'weekly_lane_metadata'->'truncated_sections'
  ) AS truncated_sections,
  COALESCE(
    (w.metadata->'relationship_packet_observability'->>'included_thread_message_count')::int,
    (w.metadata->'weekly_lane_metadata'->>'included_thread_message_count')::int
  ) AS included_thread_message_count,
  COALESCE(
    (w.metadata->'relationship_packet_observability'->>'included_thread_window_hours')::int,
    (w.metadata->'weekly_lane_metadata'->>'included_thread_window_hours')::int
  ) AS included_thread_window_hours,
  COALESCE(
    (w.metadata->'relationship_packet_observability'->>'included_memory_7d_item_count')::int,
    (w.metadata->'weekly_lane_metadata'->>'included_memory_7d_item_count')::int
  ) AS included_memory_7d_item_count,
  COALESCE(
    (w.metadata->'relationship_packet_observability'->>'included_memory_30d_item_count')::int,
    (w.metadata->'weekly_lane_metadata'->>'included_memory_30d_item_count')::int
  ) AS included_memory_30d_item_count,
  COALESCE(
    w.metadata->>'no_send_reason',
    w.metadata->'voice_send_decision'->>'skip_reason'
  ) AS no_send_reason,
  w.metadata->>'voice_decision' AS voice_decision,
  w.metadata->'final_voice_gate'->>'final_voice_source' AS final_voice_source
FROM sms_weekly_send_events w
WHERE w.created_at >= :day_start
  AND w.created_at < :day_end
ORDER BY w.created_at DESC
LIMIT 200;

-- A3) Inbound coach replies (v2_commitment_event spine + job status)
SELECT
  'inbound' AS lane,
  j.clerk_user_id,
  j.updated_at AS created_at,
  j.message_sid AS period_key,
  j.status,
  j.outbound_message_sid AS message_sid,
  COALESCE(
    ev.payload_json->'relationship_packet_observability'->>'relationship_packet_version',
    ev.payload_json->'v3_brain'->'relationship_packet_observability'->>'relationship_packet_version',
    ev.payload_json->'ai'->'relationship_packet_observability'->>'relationship_packet_version'
  ) AS relationship_packet_version,
  COALESCE(
    ev.payload_json->'relationship_packet_observability'->>'relationship_packet_truncated',
    ev.payload_json->'v3_brain'->'relationship_packet_observability'->>'relationship_packet_truncated'
  ) AS relationship_packet_truncated,
  COALESCE(
    ev.payload_json->'relationship_packet_observability'->'truncated_sections',
    ev.payload_json->'v3_brain'->'relationship_packet_observability'->'truncated_sections'
  ) AS truncated_sections,
  (ev.payload_json->'relationship_packet_observability'->>'included_thread_message_count')::int
    AS included_thread_message_count,
  (ev.payload_json->'relationship_packet_observability'->>'included_thread_window_hours')::int
    AS included_thread_window_hours,
  (ev.payload_json->'relationship_packet_observability'->>'included_memory_7d_item_count')::int
    AS included_memory_7d_item_count,
  (ev.payload_json->'relationship_packet_observability'->>'included_memory_30d_item_count')::int
    AS included_memory_30d_item_count,
  COALESCE(
    ev.payload_json->'relationship_packet_observability'->>'no_send_reason',
    ev.payload_json->'ai'->'reply_resolution'->>'reply_source'
  ) AS no_send_reason,
  ev.payload_json->'ai'->'reply_resolution'->>'reply_source' AS reply_source,
  ev.payload_json->'final_voice_gate'->>'final_voice_source' AS final_voice_source
FROM sms_inbound_coach_jobs j
LEFT JOIN v2_commitment_event ev
  ON ev.idempotency_key = 'v2_user_reply:' || j.message_sid
  OR ev.payload_json->>'message_sid' = j.message_sid
WHERE j.updated_at >= :day_start
  AND j.updated_at < :day_end
ORDER BY j.updated_at DESC
LIMIT 500;

-- ---------------------------------------------------------------------------
-- B) Packet truncation report (daily + weekly aggregates)
-- ---------------------------------------------------------------------------

WITH daily_obs AS (
  SELECT
    'daily' AS lane,
    COALESCE(
      metadata->'relationship_packet_observability'->>'relationship_packet_version',
      metadata->'daily_v3_lane'->>'relationship_packet_version',
      'missing'
    ) AS relationship_packet_version,
    COALESCE(
      (metadata->'relationship_packet_observability'->>'relationship_packet_truncated')::boolean,
      (metadata->'daily_v3_lane'->>'relationship_packet_truncated')::boolean,
      false
    ) AS truncated,
    COALESCE(
      metadata->'relationship_packet_observability'->'truncated_sections',
      metadata->'daily_v3_lane'->'truncated_sections',
      '[]'::jsonb
    ) AS truncated_sections,
    COALESCE(
      (metadata->'relationship_packet_observability'->>'included_thread_message_count')::float,
      (metadata->'daily_v3_lane'->>'included_thread_message_count')::float
    ) AS thread_msg_count
  FROM sms_send_events
  WHERE created_at >= :day_start AND created_at < :day_end
),
weekly_obs AS (
  SELECT
    'weekly' AS lane,
    COALESCE(
      metadata->'relationship_packet_observability'->>'relationship_packet_version',
      metadata->'weekly_lane_metadata'->>'relationship_packet_version',
      'missing'
    ) AS relationship_packet_version,
    COALESCE(
      (metadata->'relationship_packet_observability'->>'relationship_packet_truncated')::boolean,
      (metadata->'weekly_lane_metadata'->>'relationship_packet_truncated')::boolean,
      false
    ) AS truncated,
    COALESCE(
      metadata->'relationship_packet_observability'->'truncated_sections',
      metadata->'weekly_lane_metadata'->'truncated_sections',
      '[]'::jsonb
    ) AS truncated_sections,
    COALESCE(
      (metadata->'relationship_packet_observability'->>'included_thread_message_count')::float,
      (metadata->'weekly_lane_metadata'->>'included_thread_message_count')::float
    ) AS thread_msg_count
  FROM sms_weekly_send_events
  WHERE created_at >= :day_start AND created_at < :day_end
),
combined AS (
  SELECT * FROM daily_obs
  UNION ALL
  SELECT * FROM weekly_obs
)
SELECT
  lane,
  relationship_packet_version,
  truncated,
  truncated_sections,
  COUNT(*) AS row_count,
  ROUND(AVG(thread_msg_count), 2) AS avg_thread_message_count
FROM combined
GROUP BY lane, relationship_packet_version, truncated, truncated_sections
ORDER BY lane, row_count DESC;

-- ---------------------------------------------------------------------------
-- C) Repair snapshot usage (from lane observability blobs)
-- ---------------------------------------------------------------------------

WITH repair_rows AS (
  SELECT
    'daily' AS lane,
    metadata->'relationship_packet_observability'->>'repair_snapshot_kind' AS repair_snapshot_kind,
    (metadata->'relationship_packet_observability'->>'repair_snapshot_chars')::int AS repair_snapshot_chars,
    COALESCE(
      (metadata->'relationship_packet_observability'->>'repair_snapshot_truncated')::boolean,
      false
    ) AS repair_snapshot_truncated,
    (metadata->'relationship_packet_observability'->>'repair_snapshot_repair_succeeded')::boolean
      AS repair_succeeded,
    metadata->'relationship_packet_observability'->>'lane_stage' AS lane_stage
  FROM sms_send_events
  WHERE created_at >= :day_start AND created_at < :day_end
    AND metadata->'relationship_packet_observability'->>'repair_snapshot_kind' IS NOT NULL

  UNION ALL

  SELECT
    'daily' AS lane,
    metadata->'daily_v3_lane'->>'repair_snapshot_kind',
    (metadata->'daily_v3_lane'->>'repair_snapshot_chars')::int,
    COALESCE((metadata->'daily_v3_lane'->>'repair_snapshot_truncated')::boolean, false),
    COALESCE(
      (metadata->'daily_v3_lane'->>'repair_snapshot_repair_succeeded')::boolean,
      (metadata->'daily_v3_lane'->>'thread_freshness_repair_succeeded')::boolean,
      (metadata->'daily_v3_lane'->>'memory_repeat_guard_succeeded')::boolean
    ),
    metadata->'daily_v3_lane'->>'lane_stage'
  FROM sms_send_events
  WHERE created_at >= :day_start AND created_at < :day_end
    AND metadata->'daily_v3_lane'->>'repair_snapshot_kind' IS NOT NULL

  UNION ALL

  SELECT
    'weekly' AS lane,
    metadata->'relationship_packet_observability'->>'repair_snapshot_kind',
    (metadata->'relationship_packet_observability'->>'repair_snapshot_chars')::int,
    COALESCE(
      (metadata->'relationship_packet_observability'->>'repair_snapshot_truncated')::boolean,
      false
    ),
    (metadata->'relationship_packet_observability'->>'repair_snapshot_repair_succeeded')::boolean,
    metadata->'relationship_packet_observability'->>'lane_stage'
  FROM sms_weekly_send_events
  WHERE created_at >= :day_start AND created_at < :day_end
    AND metadata->'relationship_packet_observability'->>'repair_snapshot_kind' IS NOT NULL

  UNION ALL

  SELECT
    'inbound' AS lane,
    payload_json->'relationship_packet_observability'->>'repair_snapshot_kind',
    (payload_json->'relationship_packet_observability'->>'repair_snapshot_chars')::int,
    COALESCE(
      (payload_json->'relationship_packet_observability'->>'repair_snapshot_truncated')::boolean,
      false
    ),
    (payload_json->'relationship_packet_observability'->>'repair_snapshot_repair_succeeded')::boolean,
    payload_json->'relationship_packet_observability'->>'lane_stage'
  FROM v2_commitment_event
  WHERE occurred_at >= :day_start AND occurred_at < :day_end
    AND payload_json->'relationship_packet_observability'->>'repair_snapshot_kind' IS NOT NULL
)
SELECT
  lane,
  repair_snapshot_kind,
  COUNT(*) AS attempts,
  COUNT(*) FILTER (WHERE repair_succeeded IS TRUE) AS successes,
  COUNT(*) FILTER (WHERE repair_succeeded IS FALSE) AS failures,
  COUNT(*) FILTER (WHERE repair_snapshot_truncated IS TRUE) AS truncated_snapshots,
  ROUND(AVG(repair_snapshot_chars), 0) AS avg_repair_snapshot_chars,
  COUNT(*) FILTER (WHERE lane_stage ILIKE '%no_send%' OR lane_stage ILIKE '%failed%') AS no_send_after_repair
FROM repair_rows
GROUP BY lane, repair_snapshot_kind
ORDER BY lane, attempts DESC;

-- ---------------------------------------------------------------------------
-- D) FVG repair report (Final Voice Gate scalar OpenAI repair)
-- ---------------------------------------------------------------------------

-- D1) Daily FVG
SELECT
  'daily' AS lane,
  e.created_at,
  e.clerk_user_id,
  e.status,
  (e.metadata->'final_voice_gate'->>'v3_repair_attempted')::boolean AS v3_repair_attempted,
  (e.metadata->'final_voice_gate'->>'v3_repair_succeeded')::boolean AS v3_repair_succeeded,
  e.metadata->'final_voice_gate'->'final_voice_blocked_reasons' AS final_voice_blocked_reasons,
  e.metadata->'final_voice_gate'->>'final_voice_source' AS final_voice_source,
  e.metadata->'final_voice_gate'->>'skip_reason' AS skip_reason
FROM sms_send_events e
WHERE e.created_at >= :day_start
  AND e.created_at < :day_end
  AND (
    (e.metadata->'final_voice_gate'->>'v3_repair_attempted')::boolean IS TRUE
    OR e.status = 'skipped_no_safe_v3_voice'
  )
ORDER BY e.created_at DESC
LIMIT 200;

-- D2) Weekly FVG
SELECT
  'weekly' AS lane,
  w.created_at,
  w.clerk_user_id,
  w.status,
  (w.metadata->'final_voice_gate'->>'v3_repair_attempted')::boolean AS v3_repair_attempted,
  (w.metadata->'final_voice_gate'->>'v3_repair_succeeded')::boolean AS v3_repair_succeeded,
  w.metadata->'final_voice_gate'->'final_voice_blocked_reasons' AS final_voice_blocked_reasons,
  w.metadata->'final_voice_gate'->>'final_voice_source' AS final_voice_source,
  w.metadata->'final_voice_gate'->>'skip_reason' AS skip_reason
FROM sms_weekly_send_events w
WHERE w.created_at >= :day_start
  AND w.created_at < :day_end
  AND (
    (w.metadata->'final_voice_gate'->>'v3_repair_attempted')::boolean IS TRUE
    OR w.status = 'skipped_no_safe_v3_voice'
  )
ORDER BY w.created_at DESC
LIMIT 100;

-- D3) Inbound FVG
SELECT
  'inbound' AS lane,
  j.updated_at AS created_at,
  j.clerk_user_id,
  j.status,
  (ev.payload_json->'final_voice_gate'->>'v3_repair_attempted')::boolean AS v3_repair_attempted,
  (ev.payload_json->'final_voice_gate'->>'v3_repair_succeeded')::boolean AS v3_repair_succeeded,
  ev.payload_json->'final_voice_gate'->'final_voice_blocked_reasons' AS final_voice_blocked_reasons,
  ev.payload_json->'final_voice_gate'->>'final_voice_source' AS final_voice_source,
  ev.payload_json->'final_voice_gate'->>'skip_reason' AS skip_reason
FROM sms_inbound_coach_jobs j
LEFT JOIN v2_commitment_event ev ON ev.idempotency_key = 'v2_user_reply:' || j.message_sid
WHERE j.updated_at >= :day_start
  AND j.updated_at < :day_end
  AND (
    (ev.payload_json->'final_voice_gate'->>'v3_repair_attempted')::boolean IS TRUE
    OR j.status = 'cancelled'
  )
ORDER BY j.updated_at DESC
LIMIT 200;

-- ---------------------------------------------------------------------------
-- E) No-send / skipped health report
-- ---------------------------------------------------------------------------

SELECT
  'daily' AS lane,
  e.created_at,
  e.clerk_user_id,
  e.status,
  e.metadata->>'note' AS note,
  e.metadata->>'skip_source' AS skip_source,
  e.metadata->>'voice_decision' AS voice_decision,
  COALESCE(
    e.metadata->>'skip_reason',
    e.metadata->'voice_send_decision'->>'skip_reason',
    e.metadata->'daily_v3_lane'->>'no_send_reason'
  ) AS no_send_reason,
  e.metadata->'daily_v3_lane'->>'no_send_reason' AS daily_v3_lane_no_send_reason,
  e.metadata->'final_voice_gate'->>'skip_reason' AS final_voice_gate_skip_reason,
  (COALESCE(
    (e.metadata->'final_voice_gate'->>'daily_stale_ask_detected')::boolean,
    (e.metadata->'daily_v3_lane'->>'daily_stale_ask_detected')::boolean
  )) AS daily_stale_ask_detected,
  (COALESCE(
    (e.metadata->'final_voice_gate'->>'daily_stale_ask_repair_attempted')::boolean,
    (e.metadata->'daily_v3_lane'->>'daily_stale_ask_repair_attempted')::boolean
  )) AS daily_stale_ask_repair_attempted,
  (COALESCE(
    (e.metadata->'final_voice_gate'->>'daily_stale_ask_repair_succeeded')::boolean,
    (e.metadata->'daily_v3_lane'->>'daily_stale_ask_repair_succeeded')::boolean
  )) AS daily_stale_ask_repair_succeeded,
  COALESCE(
    e.metadata->'final_voice_gate'->>'daily_stale_ask_no_send_reason',
    e.metadata->'daily_v3_lane'->>'daily_stale_ask_no_send_reason'
  ) AS daily_stale_ask_no_send_reason,
  e.metadata->'final_voice_gate'->>'daily_stale_ask_phrase' AS daily_stale_ask_phrase,
  COALESCE(
    e.metadata->'voice_send_decision'->>'daily_satisfied_ask_context_source',
    e.metadata->'daily_v3_lane'->>'daily_satisfied_ask_context_source'
  ) AS daily_satisfied_ask_context_source,
  COALESCE(
    (e.metadata->'voice_send_decision'->>'do_not_repeat_asks_count')::int,
    (e.metadata->'daily_v3_lane'->>'do_not_repeat_asks_count')::int
  ) AS do_not_repeat_asks_count,
  e.metadata->'relationship_packet_observability' AS packet_obs,
  e.metadata->'final_voice_gate' AS final_voice_gate
FROM sms_send_events e
WHERE e.created_at >= :day_start
  AND e.created_at < :day_end
  AND (
    e.status LIKE 'skipped_%'
    OR e.status IN ('skipped_no_safe_v3_voice', 'send_failed', 'failed')
    OR e.metadata->>'voice_decision' LIKE 'skipped%'
    OR e.metadata->'daily_v3_lane'->>'no_send_reason' IS NOT NULL
    OR (e.metadata->'final_voice_gate'->>'daily_stale_ask_detected')::boolean IS TRUE
  )
ORDER BY e.created_at DESC
LIMIT 200;

SELECT
  'weekly' AS lane,
  w.created_at,
  w.clerk_user_id,
  w.status,
  w.metadata->>'no_send_tag' AS note,
  w.metadata->>'voice_decision' AS voice_decision,
  w.metadata->>'no_send_reason' AS no_send_reason,
  w.metadata->'relationship_packet_observability' AS packet_obs,
  w.metadata->'final_voice_gate' AS final_voice_gate
FROM sms_weekly_send_events w
WHERE w.created_at >= :day_start
  AND w.created_at < :day_end
  AND (
    w.status = 'skipped_no_safe_v3_voice'
    OR w.metadata->>'no_send_reason' IS NOT NULL
  )
ORDER BY w.created_at DESC
LIMIT 100;

SELECT
  'inbound' AS lane,
  j.updated_at AS created_at,
  j.clerk_user_id,
  j.status,
  j.last_error,
  left(j.reply_body, 120) AS reply_preview
FROM sms_inbound_coach_jobs j
WHERE j.updated_at >= :day_start
  AND j.updated_at < :day_end
  AND j.status = 'cancelled'
ORDER BY j.updated_at DESC
LIMIT 200;

-- Specific guard failures (memory repeat / thread freshness) across daily no-send blobs
SELECT
  e.created_at,
  e.clerk_user_id,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'no_send_reason',
    e.metadata->'relationship_packet_observability'->>'no_send_reason'
  ) AS no_send_reason,
  e.metadata->'relationship_packet_observability'->>'memory_repeat_no_send_reason' AS memory_repeat_no_send_reason,
  e.metadata->'relationship_packet_observability'->>'thread_freshness_violation_reason' AS thread_freshness_violation_reason,
  e.metadata->'relationship_packet_observability'->>'still_repeated_after_repair' AS still_repeated_after_repair
FROM sms_send_events e
WHERE e.created_at >= :day_start
  AND e.created_at < :day_end
  AND (
    COALESCE(
      e.metadata->'daily_v3_lane'->>'no_send_reason',
      e.metadata->'relationship_packet_observability'->>'no_send_reason',
      ''
    ) ILIKE '%thread_freshness%'
    OR COALESCE(
      e.metadata->'daily_v3_lane'->>'no_send_reason',
      e.metadata->'relationship_packet_observability'->>'no_send_reason',
      ''
    ) ILIKE '%memory_repeat%'
  )
ORDER BY e.created_at DESC
LIMIT 100;

-- Contract consent fallback / failure markers (inbound jobs + events)
SELECT
  j.message_sid,
  j.status,
  j.updated_at,
  j.last_error,
  ev.payload_json->>'contract_consent_human_voice_ack' AS contract_consent_human_voice_ack,
  ev.payload_json->>'contract_consent_ack_fallback' AS contract_consent_ack_fallback,
  ev.payload_json->'relationship_packet_observability' AS packet_obs
FROM sms_inbound_coach_jobs j
LEFT JOIN v2_commitment_event ev ON ev.idempotency_key LIKE '%' || j.message_sid || '%'
WHERE j.updated_at >= :day_start
  AND j.updated_at < :day_end
  AND (
    j.last_error ILIKE '%contract_consent%'
    OR ev.payload_json->>'contract_consent_human_voice_ack' = 'true'
  )
ORDER BY j.updated_at DESC
LIMIT 100;

-- ---------------------------------------------------------------------------
-- H) Daily SMS dashboard rollup (sent vs skipped vs failed vs reserved/unknown)
-- ---------------------------------------------------------------------------
-- Replaces misleading counts that used only status = 'sent'.
-- sms_inbound_coach_jobs uses different status vocabulary (sent/cancelled/…) — not mixed here.

WITH daily_rows AS (
  SELECT
    e.*,
    (
      e.status IN ('sent', 'delivered', 'queued', 'accepted', 'sending')
      OR NULLIF(BTRIM(e.message_sid), '') IS NOT NULL
      OR e.metadata->>'note' = 'sent_to_twilio'
    ) AS is_sent_or_accepted,
    (
      e.status LIKE 'skipped_%'
      OR e.metadata->>'voice_decision' LIKE 'skipped%'
      OR COALESCE(e.metadata->'voice_send_decision'->>'should_send', '') = 'false'
    ) AS is_skipped,
    (
      e.status IN ('send_failed', 'failed')
      OR e.metadata->>'note' IN ('new_delivery_body_failed', 'send_failed')
    ) AS is_failed,
    (
      e.status IN ('reserved', 'dry_run', 'skipped_missing_twilio')
      OR (
        NOT (
          e.status IN ('sent', 'delivered', 'queued', 'accepted', 'sending')
          OR NULLIF(BTRIM(e.message_sid), '') IS NOT NULL
          OR e.metadata->>'note' = 'sent_to_twilio'
        )
        AND NOT (e.status LIKE 'skipped_%' OR e.metadata->>'voice_decision' LIKE 'skipped%')
        AND e.status NOT IN ('send_failed', 'failed')
      )
    ) AS is_unknown_or_in_progress
  FROM sms_send_events e
  WHERE e.created_at >= :day_start
    AND e.created_at < :day_end
)
SELECT
  COUNT(*) AS daily_rows_total,
  COUNT(*) FILTER (WHERE is_sent_or_accepted) AS daily_sent_or_accepted,
  COUNT(*) FILTER (WHERE is_skipped) AS daily_skipped_or_not_sent,
  COUNT(*) FILTER (WHERE is_failed) AS daily_failed,
  COUNT(*) FILTER (WHERE is_unknown_or_in_progress) AS daily_unknown_or_in_progress,
  COUNT(*) FILTER (WHERE status = 'reserved') AS daily_reserved,
  COUNT(*) FILTER (WHERE status = 'skipped_no_safe_v3_voice') AS daily_skipped_no_safe_v3_voice_status,
  COUNT(*) FILTER (WHERE metadata->>'skip_source' = 'lane_no_send') AS daily_skip_source_lane_no_send,
  COUNT(*) FILTER (WHERE metadata->>'skip_source' = 'FVG_no_send') AS daily_skip_source_fvg_no_send,
  COUNT(*) FILTER (WHERE metadata->>'skip_source' = 'stale_ask_no_send') AS daily_skip_source_stale_ask_no_send,
  COUNT(*) FILTER (WHERE metadata->>'skip_source' = 'memory_repeat_no_send') AS daily_skip_source_memory_repeat_no_send,
  COUNT(*) FILTER (WHERE metadata->>'skip_source' = 'post_validate_repair_failed') AS daily_skip_source_post_validate_repair_failed,
  COUNT(*) FILTER (
    WHERE COALESCE(
      (metadata->'final_voice_gate'->>'daily_stale_ask_detected')::boolean,
      (metadata->'daily_v3_lane'->>'daily_stale_ask_detected')::boolean,
      false
    )
  ) AS daily_stale_ask_detected_rows,
  COUNT(*) FILTER (
    WHERE COALESCE(
      (metadata->'final_voice_gate'->>'daily_stale_ask_repair_attempted')::boolean,
      (metadata->'daily_v3_lane'->>'daily_stale_ask_repair_attempted')::boolean,
      false
    )
  ) AS daily_stale_ask_repair_attempted_rows,
  COUNT(*) FILTER (
    WHERE COALESCE(
      (metadata->'final_voice_gate'->>'daily_stale_ask_repair_succeeded')::boolean,
      (metadata->'daily_v3_lane'->>'daily_stale_ask_repair_succeeded')::boolean,
      false
    )
  ) AS daily_stale_ask_repair_succeeded_rows
FROM daily_rows;

-- H2) Daily status breakdown (debug bucket assignment)
SELECT
  e.status,
  e.metadata->>'note' AS note,
  e.metadata->>'skip_source' AS skip_source,
  e.metadata->>'voice_decision' AS voice_decision,
  (NULLIF(BTRIM(e.message_sid), '') IS NOT NULL) AS has_message_sid,
  COUNT(*) AS row_count
FROM sms_send_events e
WHERE e.created_at >= :day_start
  AND e.created_at < :day_end
GROUP BY 1, 2, 3, 4, 5
ORDER BY row_count DESC, e.status;

-- H3) Stale-ask / satisfied-ask no-send detail (post daily satisfied-ask wiring)
SELECT
  e.created_at,
  e.clerk_user_id,
  e.status,
  e.metadata->>'skip_source' AS skip_source,
  e.metadata->>'note' AS note,
  e.metadata->'daily_v3_lane'->>'no_send_reason' AS daily_v3_lane_no_send_reason,
  e.metadata->'final_voice_gate'->>'skip_reason' AS final_voice_gate_skip_reason,
  COALESCE(
    e.metadata->'final_voice_gate'->>'daily_stale_ask_guard_stage',
    e.metadata->'daily_v3_lane'->>'daily_stale_ask_guard_stage'
  ) AS daily_stale_ask_guard_stage,
  COALESCE(
    e.metadata->'final_voice_gate'->>'daily_stale_ask_phrase',
    e.metadata->'daily_v3_lane'->>'daily_stale_ask_phrase'
  ) AS daily_stale_ask_phrase,
  COALESCE(
    e.metadata->'final_voice_gate'->>'daily_stale_ask_no_send_reason',
    e.metadata->'daily_v3_lane'->>'daily_stale_ask_no_send_reason'
  ) AS daily_stale_ask_no_send_reason,
  COALESCE(
    e.metadata->'voice_send_decision'->>'daily_satisfied_ask_context_source',
    e.metadata->'daily_v3_lane'->>'daily_satisfied_ask_context_source'
  ) AS daily_satisfied_ask_context_source,
  LEFT(COALESCE(e.metadata->>'sms_body', e.sms_body, ''), 160) AS body_preview
FROM sms_send_events e
WHERE e.created_at >= :day_start
  AND e.created_at < :day_end
  AND (
    e.metadata->>'skip_source' = 'stale_ask_no_send'
    OR COALESCE(
      (e.metadata->'final_voice_gate'->>'daily_stale_ask_detected')::boolean,
      (e.metadata->'daily_v3_lane'->>'daily_stale_ask_detected')::boolean,
      false
    )
    OR e.metadata->'daily_v3_lane'->>'no_send_reason' = 'daily_stale_ask_blocked'
  )
ORDER BY e.created_at DESC
LIMIT 200;

-- ---------------------------------------------------------------------------
-- F) Legacy / fallback user-visible SMS report
-- ---------------------------------------------------------------------------

-- Daily: rows missing packet version (possible non-V3 lane)
SELECT
  e.created_at,
  e.clerk_user_id,
  e.status,
  e.metadata->'final_voice_gate'->>'final_voice_source' AS final_voice_source,
  e.metadata->'relationship_packet_observability'->>'relationship_packet_version' AS packet_version,
  e.metadata->'daily_v3_lane'->>'v3_lane_reply_source' AS lane_reply_source,
  e.metadata->>'note' AS note
FROM sms_send_events e
WHERE e.created_at >= :day_start
  AND e.created_at < :day_end
  AND e.metadata->'relationship_packet_observability'->>'relationship_packet_version' IS NULL
  AND e.metadata->'daily_v3_lane'->>'relationship_packet_version' IS NULL
  AND e.status NOT IN ('dry_run', 'skipped_missing_twilio')
ORDER BY e.created_at DESC
LIMIT 100;

-- Inbound: legacy reply sources (should be rare for active coaching)
SELECT
  j.updated_at,
  j.message_sid,
  j.status,
  ev.payload_json->'ai'->'reply_resolution'->>'reply_source' AS reply_source,
  ev.payload_json->'v3_brain'->>'v3_coach_reply_source' AS v3_coach_reply_source,
  ev.payload_json->'conversation_brain_v1'->>'enabled' AS conversation_brain_enabled,
  ev.payload_json->>'contract_consent_human_voice_ack' AS contract_consent_fallback,
  ev.payload_json->'relationship_packet_observability'->>'relationship_packet_version' AS packet_version
FROM sms_inbound_coach_jobs j
LEFT JOIN v2_commitment_event ev ON ev.idempotency_key = 'v2_user_reply:' || j.message_sid
WHERE j.updated_at >= :day_start
  AND j.updated_at < :day_end
  AND j.status = 'sent'
  AND COALESCE(
    ev.payload_json->'ai'->'reply_resolution'->>'reply_source',
    ev.payload_json->'v3_brain'->>'v3_coach_reply_source',
    ''
  ) NOT IN ('v3_inbound_relationship_lane', '')
ORDER BY j.updated_at DESC
LIMIT 100;

-- Weekly: old preview vs V3 lane (preview should not be final body)
SELECT
  w.created_at,
  w.clerk_user_id,
  w.status,
  w.metadata->>'v3_lane_reply_source' AS v3_lane_reply_source,
  w.metadata->>'old_weekly_proof_body_preview' IS NOT NULL AS has_old_preview,
  w.metadata->'relationship_packet_observability'->>'relationship_packet_version' AS packet_version,
  left(w.metadata->>'old_weekly_proof_body_preview', 120) AS old_preview_snippet
FROM sms_weekly_send_events w
WHERE w.created_at >= :day_start
  AND w.created_at < :day_end
ORDER BY w.created_at DESC
LIMIT 100;

-- ---------------------------------------------------------------------------
-- G) Shadow + packet disagreement companion (optional)
-- ---------------------------------------------------------------------------

SELECT
  s.created_at,
  s.inbound_message_sid,
  s.deterministic_route,
  s.primary_intent,
  s.disagreement,
  s.disagreement_flags,
  s.outcome_sent,
  j.status AS job_status,
  ev.payload_json->'relationship_packet_observability'->>'relationship_packet_version' AS packet_version,
  ev.payload_json->'relationship_packet_observability'->>'relationship_packet_truncated' AS packet_truncated,
  ev.payload_json->'relationship_packet_observability'->>'lane_stage' AS lane_stage
FROM v2_sms_meaning_interpretation_shadow s
LEFT JOIN sms_inbound_coach_jobs j ON j.message_sid = s.inbound_message_sid
LEFT JOIN v2_commitment_event ev ON ev.idempotency_key = 'v2_user_reply:' || s.inbound_message_sid
WHERE s.created_at >= :day_start
  AND s.created_at < :day_end
  AND (s.disagreement IS TRUE OR s.outcome_sent IS FALSE)
ORDER BY s.created_at DESC
LIMIT 100;
