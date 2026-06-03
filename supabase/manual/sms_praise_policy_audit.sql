-- Read-only: Earned Praise Policy v1.1 observability.
-- Run in Supabase SQL editor. SELECT-only; does not mutate data.
-- App cadence: cross-family warm praise in last 5 coach bodies (72h thread + last_5_coach_questions).
-- 14-day enforcement remains SQL monitoring only (no app DB query in generation path).

-- PRAISE-A: Sent SMS with warm praise OR momentum variants (last 30 days)
SELECT
  e.created_at,
  e.clerk_user_id,
  e.status,
  LEFT(COALESCE(e.metadata->>'sms_body', e.metadata->>'final_voice_gate_body', ''), 240) AS body_preview,
  CASE
    WHEN COALESCE(e.metadata->>'sms_body', e.metadata->>'final_voice_gate_body', '') ~*
      '\b(great job|good job|good work|nice work|proud of you|proud of this|strong work|well done)\b'
      THEN 'warm_praise'
    WHEN COALESCE(e.metadata->>'sms_body', e.metadata->>'final_voice_gate_body', '') ~*
      '\b(keep (the |this )?momentum|continue (this )?momentum|continuing (this )?momentum|as you continue (this )?momentum|build(ing)? on (this )?momentum|carrying (this )?momentum|momentum going|your momentum|this momentum)\b'
      THEN 'momentum_variant'
    ELSE 'other'
  END AS praise_group
FROM sms_send_events e
WHERE e.created_at >= NOW() - INTERVAL '30 days'
  AND e.status IN ('sent', 'delivered', 'queued')
  AND (
    COALESCE(e.metadata->>'sms_body', e.metadata->>'final_voice_gate_body', '') ~*
      '\b(great job|good job|good work|nice work|proud of you|proud of this|strong work|well done)\b'
    OR COALESCE(e.metadata->>'sms_body', e.metadata->>'final_voice_gate_body', '') ~*
      '\b(keep (the |this )?momentum|continue (this )?momentum|continuing (this )?momentum|as you continue (this )?momentum|build(ing)? on (this )?momentum|carrying (this )?momentum|momentum going|your momentum|this momentum)\b'
  )
ORDER BY e.created_at DESC
LIMIT 500;

-- PRAISE-B: No-sends blocked by generic_praise_* / generic_momentum
SELECT
  e.created_at,
  e.clerk_user_id,
  e.status,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'no_send_reason',
    e.metadata->'inbound_v3_lane'->>'no_send_reason',
    e.metadata->'weekly_v3_lane'->>'no_send_reason',
    e.metadata->>'skip_reason',
    ''
  ) AS no_send_reason,
  COALESCE(
    e.metadata->'daily_v3_lane'->'blocked_reasons',
    e.metadata->'inbound_v3_lane'->'blocked_reasons',
    e.metadata->'weekly_v3_lane'->'blocked_reasons',
    e.metadata->'final_voice_gate'->'final_voice_blocked_reasons',
    '[]'::jsonb
  ) AS blocked_reasons,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'praise_blocked_reason',
    e.metadata->'inbound_v3_lane'->>'praise_blocked_reason',
    e.metadata->'weekly_v3_lane'->>'praise_blocked_reason',
    e.metadata->>'praise_blocked_reason'
  ) AS praise_blocked_reason,
  LEFT(COALESCE(
    e.metadata->'daily_v3_lane'->>'v3_candidate_body',
    e.metadata->'inbound_v3_lane'->>'v3_candidate_body',
    e.metadata->'weekly_v3_lane'->>'v3_candidate_body',
    e.metadata->>'original_pre_voice_gate_body',
    ''
  ), 240) AS candidate_preview
FROM sms_send_events e
WHERE e.created_at >= NOW() - INTERVAL '30 days'
  AND e.status IN ('cancelled', 'failed', 'skipped_no_safe_v3_voice')
  AND (
    COALESCE(e.metadata->'daily_v3_lane'->'blocked_reasons', '[]'::jsonb)::text ~ 'generic_praise_'
    OR COALESCE(e.metadata->'inbound_v3_lane'->'blocked_reasons', '[]'::jsonb)::text ~ 'generic_praise_'
    OR COALESCE(e.metadata->'weekly_v3_lane'->'blocked_reasons', '[]'::jsonb)::text ~ 'generic_praise_'
    OR COALESCE(e.metadata->'final_voice_gate'->'final_voice_blocked_reasons', '[]'::jsonb)::text ~ 'generic_praise_'
    OR COALESCE(e.metadata->'daily_v3_lane'->'blocked_reasons', '[]'::jsonb)::text ~ 'generic_momentum'
    OR COALESCE(e.metadata->>'praise_blocked_reason', '') LIKE 'generic_praise_%'
    OR COALESCE(e.metadata->>'praise_blocked_reason', '') = 'generic_momentum'
  )
ORDER BY e.created_at DESC
LIMIT 300;

-- PRAISE-C: great_job / keep_momentum / warm-family repair attempts
SELECT
  e.created_at,
  e.clerk_user_id,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'lane_stage',
    e.metadata->'inbound_v3_lane'->>'lane_stage',
    e.metadata->'weekly_v3_lane'->>'lane_stage'
  ) AS lane_stage,
  COALESCE(
    e.metadata->'daily_v3_lane'->'original_blocked_reasons',
    e.metadata->'inbound_v3_lane'->'original_blocked_reasons',
    e.metadata->'weekly_v3_lane'->'original_blocked_reasons',
    '[]'::jsonb
  ) AS original_blocked_reasons,
  LEFT(COALESCE(
    e.metadata->'daily_v3_lane'->>'original_candidate_body_preview',
    e.metadata->'inbound_v3_lane'->>'original_candidate_body_preview',
    e.metadata->'weekly_v3_lane'->>'original_candidate_body_preview',
    ''
  ), 180) AS original_preview,
  LEFT(COALESCE(
    e.metadata->'daily_v3_lane'->>'repaired_candidate_body',
    e.metadata->'inbound_v3_lane'->>'repaired_candidate_body',
    e.metadata->'weekly_v3_lane'->>'repaired_candidate_body',
    ''
  ), 180) AS repaired_preview,
  COALESCE(
    e.metadata->'daily_v3_lane'->'repaired_blocked_reasons',
    e.metadata->'inbound_v3_lane'->'repaired_blocked_reasons',
    e.metadata->'weekly_v3_lane'->'repaired_blocked_reasons',
    '[]'::jsonb
  ) AS repaired_blocked_reasons
FROM sms_send_events e
WHERE e.created_at >= NOW() - INTERVAL '30 days'
  AND (
    COALESCE(e.metadata->'daily_v3_lane'->'original_blocked_reasons', '[]'::jsonb)::text ~
      '(great_job|keep_momentum|generic_praise_|generic_momentum|generic_keep_momentum)'
    OR COALESCE(e.metadata->'daily_v3_lane'->'repaired_blocked_reasons', '[]'::jsonb)::text ~
      '(great_job|keep_momentum|generic_praise_|generic_momentum|generic_keep_momentum)'
  )
ORDER BY e.created_at DESC
LIMIT 300;

-- PRAISE-D: Repeated WARM praise (any family grouped) per user — 7/14/30 days
WITH warm_sends AS (
  SELECT
    e.clerk_user_id,
    e.created_at
  FROM sms_send_events e
  WHERE e.created_at >= NOW() - INTERVAL '30 days'
    AND e.status IN ('sent', 'delivered', 'queued')
    AND COALESCE(e.metadata->>'sms_body', '') ~*
      '\b(great job|good job|good work|nice work|proud of you|proud of this|strong work|well done)\b'
)
SELECT
  clerk_user_id,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS warm_praise_sends_7d,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '14 days') AS warm_praise_sends_14d,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS warm_praise_sends_30d
FROM warm_sends
GROUP BY clerk_user_id
HAVING COUNT(*) >= 2
ORDER BY warm_praise_sends_30d DESC, clerk_user_id
LIMIT 200;

-- PRAISE-E: Specific acknowledgment without warm phrase (heuristic)
SELECT
  e.created_at,
  e.clerk_user_id,
  LEFT(COALESCE(e.metadata->>'sms_body', ''), 220) AS body_preview,
  e.metadata->>'specific_acknowledgment_detected' AS specific_acknowledgment_detected,
  e.metadata->>'warm_praise_recently_used' AS warm_praise_recently_used
FROM sms_send_events e
WHERE e.created_at >= NOW() - INTERVAL '14 days'
  AND e.status IN ('sent', 'delivered', 'queued')
  AND COALESCE(e.metadata->>'sms_body', '') !~*
    '\b(great job|good job|good work|nice work|proud of you|proud of this|strong work|well done)\b'
  AND COALESCE(e.metadata->>'sms_body', '') ~*
    '\b(days? in a row|two days in a row|followed through|real rep|becoming a standard|back-to-back)\b'
ORDER BY e.created_at DESC
LIMIT 200;

-- PRAISE-F: Praise metadata on sends
SELECT
  e.created_at,
  e.clerk_user_id,
  e.metadata->>'earned_praise_allowed' AS earned_praise_allowed,
  e.metadata->>'praise_policy_reason' AS praise_policy_reason,
  e.metadata->>'praise_blocked_reason' AS praise_blocked_reason,
  e.metadata->'detected_warm_praise_phrases' AS detected_warm_praise_phrases,
  e.metadata->>'warm_praise_recently_used' AS warm_praise_recently_used,
  LEFT(COALESCE(e.metadata->>'sms_body', ''), 200) AS body_preview
FROM sms_send_events e
WHERE e.created_at >= NOW() - INTERVAL '14 days'
  AND e.metadata ? 'earned_praise_allowed'
ORDER BY e.created_at DESC
LIMIT 200;

-- PRAISE-G: Sent warm praise after user_yes / proof hints
SELECT
  e.created_at,
  e.clerk_user_id,
  LEFT(COALESCE(e.metadata->>'sms_body', ''), 200) AS body_preview,
  COALESCE(
    e.metadata->'daily_v3_lane'->>'prior_outcome',
    e.metadata->>'latest_outcome_type',
    e.metadata->'context_packet'->>'latestOutcomeType'
  ) AS prior_outcome_hint,
  e.metadata->>'earned_praise_allowed' AS earned_praise_allowed,
  e.metadata->>'praise_policy_reason' AS praise_policy_reason
FROM sms_send_events e
WHERE e.created_at >= NOW() - INTERVAL '30 days'
  AND e.status IN ('sent', 'delivered', 'queued')
  AND COALESCE(e.metadata->>'sms_body', '') ~*
    '\b(great job|good job|good work|nice work|proud of you|proud of this|strong work|well done)\b'
  AND COALESCE(
    e.metadata->'daily_v3_lane'->>'prior_outcome',
    e.metadata->>'latest_outcome_type',
    'unknown'
  ) IN ('user_yes', 'true')
ORDER BY e.created_at DESC
LIMIT 200;

-- PRAISE-H: Sent warm praise without earned metadata (review queue)
SELECT
  e.created_at,
  e.clerk_user_id,
  LEFT(COALESCE(e.metadata->>'sms_body', ''), 220) AS body_preview,
  e.metadata->>'earned_praise_allowed' AS earned_praise_allowed,
  e.metadata->>'praise_policy_reason' AS praise_policy_reason
FROM sms_send_events e
WHERE e.created_at >= NOW() - INTERVAL '30 days'
  AND e.status IN ('sent', 'delivered', 'queued')
  AND COALESCE(e.metadata->>'sms_body', '') ~*
    '\b(great job|good job|good work|nice work|proud of you|proud of this|strong work|well done)\b'
  AND COALESCE(e.metadata->>'earned_praise_allowed', 'unknown') NOT IN ('true', '1')
ORDER BY e.created_at DESC
LIMIT 200;

-- PRAISE-I: User reply rate after warm praise — future (requires inbound join; placeholder)
-- SELECT ... FROM sms_send_events JOIN sms_inbound ... WHERE prior send had warm_praise ...
