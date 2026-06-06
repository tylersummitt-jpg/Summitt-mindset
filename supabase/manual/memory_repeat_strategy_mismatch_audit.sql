-- Read-only: monitor memory-repeat strategy label mismatch vs real guard failures.
-- Run in Supabase SQL editor. Does not mutate data.
-- Daily sent rows: status IN ('sent','delivered','queued','accepted','sending') OR message_sid OR note='sent_to_twilio'.

-- Remaining no-sends where strategy mismatch was the recorded failure (should drop after soft-accept deploy)
SELECT
  e.created_at,
  e.clerk_user_id,
  e.status,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'no_send_reason',
    e.metadata->'relationship_packet_observability'->>'no_send_reason'
  ) AS lane_no_send_reason,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'memory_repeat_no_send_reason',
    e.metadata->'relationship_packet_observability'->>'memory_repeat_no_send_reason'
  ) AS memory_repeat_no_send_reason,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'repeat_repair_failed_reason',
    e.metadata->'relationship_packet_observability'->>'repeat_repair_failed_reason'
  ) AS repeat_repair_failed_reason,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'repeat_repair_attempt_1_strategy',
    e.metadata->'relationship_packet_observability'->>'repeat_repair_attempt_1_strategy'
  ) AS attempt_1_strategy,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'repeat_repair_attempt_2_strategy',
    e.metadata->'relationship_packet_observability'->>'repeat_repair_attempt_2_strategy'
  ) AS attempt_2_strategy,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'repeated_question',
    e.metadata->'relationship_packet_observability'->>'repeated_question'
  ) AS repeated_question,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'memory_repeat_repaired_body_preview',
    e.metadata->'relationship_packet_observability'->>'memory_repeat_repaired_body_preview'
  ) AS repair_preview
FROM sms_send_events e
WHERE e.created_at >= NOW() - INTERVAL '7 days'
  AND e.status IN ('cancelled', 'failed')
  AND (
    COALESCE(
      e.metadata->'daily_v3_lane'->>'memory_repeat_no_send_reason',
      e.metadata->'relationship_packet_observability'->>'memory_repeat_no_send_reason',
      ''
    ) = 'repair_strategy_body_mismatch'
    OR COALESCE(
      e.metadata->'daily_v3_lane'->>'repeat_repair_failed_reason',
      e.metadata->'relationship_packet_observability'->>'repeat_repair_failed_reason',
      ''
    ) = 'repair_strategy_body_mismatch'
  )
ORDER BY e.created_at DESC
LIMIT 200;

-- Sent rows with strategy label soft-accepted (post-deploy)
SELECT
  e.created_at,
  e.clerk_user_id,
  e.status,
  e.metadata->>'sms_body' AS sent_body,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'repeat_repair_strategy_label_soft_accepted',
    e.metadata->'relationship_packet_observability'->>'repeat_repair_strategy_label_soft_accepted'
  ) AS strategy_label_soft_accepted,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'repeat_repair_strategy_label_requested',
    e.metadata->'relationship_packet_observability'->>'repeat_repair_strategy_label_requested'
  ) AS strategy_label_requested,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'repeat_repair_final_strategy',
    e.metadata->'relationship_packet_observability'->>'repeat_repair_final_strategy'
  ) AS final_strategy,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'memory_repeat_repaired_body_preview',
    e.metadata->'relationship_packet_observability'->>'memory_repeat_repaired_body_preview'
  ) AS repair_preview
FROM sms_send_events e
WHERE e.created_at >= NOW() - INTERVAL '7 days'
  AND (
    e.status IN ('sent', 'delivered', 'queued', 'accepted', 'sending')
    OR NULLIF(BTRIM(e.message_sid), '') IS NOT NULL
    OR e.metadata->>'note' = 'sent_to_twilio'
  )
  AND (
    (e.metadata->'daily_v3_lane'->>'repeat_repair_strategy_label_soft_accepted')::boolean IS TRUE
    OR (e.metadata->'relationship_packet_observability'->>'repeat_repair_strategy_label_soft_accepted')::boolean IS TRUE
  )
ORDER BY e.created_at DESC
LIMIT 200;

-- Memory repeat no-sends by failure class (7d)
SELECT
  COALESCE(
    e.metadata->'daily_v3_lane'->>'memory_repeat_no_send_reason',
    e.metadata->'relationship_packet_observability'->>'memory_repeat_no_send_reason',
    'unknown'
  ) AS memory_repeat_no_send_reason,
  COUNT(*) AS event_count
FROM sms_send_events e
WHERE e.created_at >= NOW() - INTERVAL '7 days'
  AND e.status IN ('cancelled', 'failed')
  AND (
    COALESCE(e.metadata->'daily_v3_lane'->>'memory_repeat_guard_attempted', '') = 'true'
    OR COALESCE(
      e.metadata->'relationship_packet_observability'->>'memory_repeat_guard_attempted',
      ''
    ) = 'true'
    OR COALESCE(
      e.metadata->'daily_v3_lane'->>'no_send_reason',
      e.metadata->'relationship_packet_observability'->>'no_send_reason',
      ''
    ) ILIKE '%memory_repeat%'
  )
GROUP BY 1
ORDER BY event_count DESC;
