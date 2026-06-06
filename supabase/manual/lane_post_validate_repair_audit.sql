-- Lane post-validate repair observability (SELECT-only).
-- Monitors one- vs two-pass post-validate repair outcomes across daily/inbound/weekly lanes.

-- REPAIR-A: attempt counts and second-pass outcomes
SELECT
  e.created_at,
  e.clerk_user_id,
  e.status,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'lane_post_validate_repair_attempt_count',
    e.metadata->'inbound_v3_lane'->>'lane_post_validate_repair_attempt_count',
    e.metadata->'weekly_v3_lane'->>'lane_post_validate_repair_attempt_count'
  ) AS repair_attempt_count,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'lane_post_validate_second_repair_attempted',
    e.metadata->'inbound_v3_lane'->>'lane_post_validate_second_repair_attempted',
    e.metadata->'weekly_v3_lane'->>'lane_post_validate_second_repair_attempted'
  ) AS second_repair_attempted,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'lane_post_validate_second_repair_succeeded',
    e.metadata->'inbound_v3_lane'->>'lane_post_validate_second_repair_succeeded',
    e.metadata->'weekly_v3_lane'->>'lane_post_validate_second_repair_succeeded'
  ) AS second_repair_succeeded,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'lane_post_validate_repair_failed_reason',
    e.metadata->'inbound_v3_lane'->>'lane_post_validate_repair_failed_reason',
    e.metadata->'weekly_v3_lane'->>'lane_post_validate_repair_failed_reason'
  ) AS repair_failed_reason,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'lane_stage',
    e.metadata->'inbound_v3_lane'->>'lane_stage',
    e.metadata->'weekly_v3_lane'->>'lane_stage'
  ) AS lane_stage
FROM sms_send_events e
WHERE e.created_at >= NOW() - INTERVAL '30 days'
  AND (
    e.metadata ? 'daily_v3_lane'
    OR e.metadata ? 'inbound_v3_lane'
    OR e.metadata ? 'weekly_v3_lane'
  )
  AND (
    COALESCE(
      e.metadata->'daily_v3_lane'->>'lane_post_validate_repair_attempt_count',
      e.metadata->'inbound_v3_lane'->>'lane_post_validate_repair_attempt_count',
      e.metadata->'weekly_v3_lane'->>'lane_post_validate_repair_attempt_count'
    ) IS NOT NULL
    OR COALESCE(
      e.metadata->'daily_v3_lane'->>'lane_stage',
      e.metadata->'inbound_v3_lane'->>'lane_stage',
      e.metadata->'weekly_v3_lane'->>'lane_stage'
    ) = 'post_validate_repair_failed'
  )
ORDER BY e.created_at DESC
LIMIT 300;

-- REPAIR-B: blocked reasons by attempt
SELECT
  e.created_at,
  e.clerk_user_id,
  COALESCE(
    e.metadata->'daily_v3_lane'->'lane_post_validate_blocked_reasons_initial',
    e.metadata->'inbound_v3_lane'->'lane_post_validate_blocked_reasons_initial',
    e.metadata->'weekly_v3_lane'->'lane_post_validate_blocked_reasons_initial'
  ) AS blocked_initial,
  COALESCE(
    e.metadata->'daily_v3_lane'->'lane_post_validate_blocked_reasons_after_attempt_1',
    e.metadata->'inbound_v3_lane'->'lane_post_validate_blocked_reasons_after_attempt_1',
    e.metadata->'weekly_v3_lane'->'lane_post_validate_blocked_reasons_after_attempt_1'
  ) AS blocked_after_1,
  COALESCE(
    e.metadata->'daily_v3_lane'->'lane_post_validate_blocked_reasons_after_attempt_2',
    e.metadata->'inbound_v3_lane'->'lane_post_validate_blocked_reasons_after_attempt_2',
    e.metadata->'weekly_v3_lane'->'lane_post_validate_blocked_reasons_after_attempt_2'
  ) AS blocked_after_2,
  COALESCE(
    e.metadata->'daily_v3_lane'->'lane_post_validate_introduced_repairable_reasons',
    e.metadata->'inbound_v3_lane'->'lane_post_validate_introduced_repairable_reasons',
    e.metadata->'weekly_v3_lane'->'lane_post_validate_introduced_repairable_reasons'
  ) AS introduced_repairable
FROM sms_send_events e
WHERE e.created_at >= NOW() - INTERVAL '30 days'
  AND (
    e.metadata->'daily_v3_lane' ? 'lane_post_validate_blocked_reasons_initial'
    OR e.metadata->'inbound_v3_lane' ? 'lane_post_validate_blocked_reasons_initial'
    OR e.metadata->'weekly_v3_lane' ? 'lane_post_validate_blocked_reasons_initial'
  )
ORDER BY e.created_at DESC
LIMIT 300;

-- REPAIR-C: praise/momentum second-repair outcomes
SELECT
  e.created_at,
  e.clerk_user_id,
  e.status,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'lane_post_validate_repair_failed_reason',
    e.metadata->'inbound_v3_lane'->>'lane_post_validate_repair_failed_reason',
    e.metadata->'weekly_v3_lane'->>'lane_post_validate_repair_failed_reason'
  ) AS repair_failed_reason,
  COALESCE(
    e.metadata->'daily_v3_lane'->'lane_post_validate_blocked_reasons_after_attempt_1',
    e.metadata->'inbound_v3_lane'->'lane_post_validate_blocked_reasons_after_attempt_1',
    e.metadata->'weekly_v3_lane'->'lane_post_validate_blocked_reasons_after_attempt_1',
    '[]'::jsonb
  )::text AS blocked_after_1,
  COALESCE(
    e.metadata->'daily_v3_lane'->'lane_post_validate_blocked_reasons_after_attempt_2',
    e.metadata->'inbound_v3_lane'->'lane_post_validate_blocked_reasons_after_attempt_2',
    e.metadata->'weekly_v3_lane'->'lane_post_validate_blocked_reasons_after_attempt_2',
    '[]'::jsonb
  )::text AS blocked_after_2
FROM sms_send_events e
WHERE e.created_at >= NOW() - INTERVAL '30 days'
  AND (
    COALESCE(
      e.metadata->'daily_v3_lane'->'lane_post_validate_blocked_reasons_after_attempt_1',
      e.metadata->'inbound_v3_lane'->'lane_post_validate_blocked_reasons_after_attempt_1',
      e.metadata->'weekly_v3_lane'->'lane_post_validate_blocked_reasons_after_attempt_1',
      '[]'::jsonb
    )::text ~ '(generic_praise_|generic_momentum|generic_keep_momentum|great_job|keep_momentum)'
    OR COALESCE(
      e.metadata->'daily_v3_lane'->'lane_post_validate_blocked_reasons_after_attempt_2',
      e.metadata->'inbound_v3_lane'->'lane_post_validate_blocked_reasons_after_attempt_2',
      e.metadata->'weekly_v3_lane'->'lane_post_validate_blocked_reasons_after_attempt_2',
      '[]'::jsonb
    )::text ~ '(generic_praise_|generic_momentum|generic_keep_momentum|great_job|keep_momentum)'
  )
ORDER BY e.created_at DESC
LIMIT 300;

-- REPAIR-D: skipped_no_safe_v3_voice tied to post_validate_repair_failed
SELECT
  e.created_at,
  e.clerk_user_id,
  e.status,
  e.metadata->>'voice_decision' AS voice_decision,
  e.metadata->>'skip_source' AS skip_source,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'lane_stage',
    e.metadata->'inbound_v3_lane'->>'lane_stage',
    e.metadata->'weekly_v3_lane'->>'lane_stage'
  ) AS lane_stage,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'lane_post_validate_repair_failed_reason',
    e.metadata->'inbound_v3_lane'->>'lane_post_validate_repair_failed_reason',
    e.metadata->'weekly_v3_lane'->>'lane_post_validate_repair_failed_reason'
  ) AS repair_failed_reason
FROM sms_send_events e
WHERE e.created_at >= NOW() - INTERVAL '30 days'
  AND (
    e.status = 'skipped_no_safe_v3_voice'
    OR e.metadata->>'voice_decision' = 'skipped_no_safe_v3_voice'
  )
  AND COALESCE(
    e.metadata->'daily_v3_lane'->>'lane_stage',
    e.metadata->'inbound_v3_lane'->>'lane_stage',
    e.metadata->'weekly_v3_lane'->>'lane_stage'
  ) = 'post_validate_repair_failed'
ORDER BY e.created_at DESC
LIMIT 300;
