-- Manual read-only reports for Durable SMS Pattern Correction Table.
-- Run in Supabase SQL editor. SELECT reports do not mutate data.
-- Commented INSERT/UPDATE templates at bottom are labeled DO NOT RUN WITHOUT REVIEW.

-- 1) Shadow disagreements not yet linked to corrections
SELECT
  s.id AS shadow_id,
  s.created_at,
  s.clerk_user_id,
  s.commitment_id,
  s.inbound_message_sid,
  s.deterministic_route,
  s.primary_intent,
  s.confidence AS shadow_confidence,
  s.disagreement_flags,
  s.body_preview,
  s.shadow_status
FROM v2_sms_meaning_interpretation_shadow s
LEFT JOIN v2_sms_pattern_correction c ON c.source_shadow_id = s.id
WHERE s.disagreement = true
  AND c.id IS NULL
ORDER BY s.created_at DESC
LIMIT 200;

-- 2) Potential correction candidates from shadow disagreements (last 14 days)
SELECT
  s.id AS shadow_id,
  s.created_at,
  s.clerk_user_id,
  s.commitment_id,
  s.deterministic_route,
  s.primary_intent,
  s.disagreement_flags,
  s.body_preview,
  CASE
    WHEN s.deterministic_route ILIKE '%open%' THEN 'open_question_answer_style'
    WHEN 'blocker' = ANY (s.disagreement_flags) THEN 'blocker_phrase_pattern'
    WHEN s.disagreement_flags && ARRAY['route_mismatch', 'false_positive']::text[]
      THEN 'false_positive_route'
    WHEN s.disagreement_flags && ARRAY['false_negative']::text[]
      THEN 'false_negative_route'
    ELSE 'shadow_disagreement_reviewed'
  END AS suggested_correction_type
FROM v2_sms_meaning_interpretation_shadow s
LEFT JOIN v2_sms_pattern_correction c ON c.source_shadow_id = s.id
WHERE s.disagreement = true
  AND s.created_at >= now() - interval '14 days'
  AND c.id IS NULL
ORDER BY s.created_at DESC
LIMIT 200;

-- 3) Approved corrections by user
SELECT
  clerk_user_id,
  count(*) AS approved_count,
  max(updated_at) AS last_updated
FROM v2_sms_pattern_correction
WHERE status = 'approved'
GROUP BY clerk_user_id
ORDER BY approved_count DESC, last_updated DESC;

-- 4) Approved corrections by correction_type
SELECT
  correction_type,
  count(*) AS approved_count,
  count(DISTINCT clerk_user_id) FILTER (WHERE clerk_user_id IS NOT NULL) AS distinct_users
FROM v2_sms_pattern_correction
WHERE status = 'approved'
GROUP BY correction_type
ORDER BY approved_count DESC;

-- 5) Corrections linked to shadow rows
SELECT
  c.id AS correction_id,
  c.status,
  c.correction_type,
  c.meaning_label,
  c.normalized_pattern,
  c.source_shadow_id,
  s.deterministic_route,
  s.disagreement,
  s.created_at AS shadow_created_at,
  c.created_at AS correction_created_at
FROM v2_sms_pattern_correction c
JOIN v2_sms_meaning_interpretation_shadow s ON s.id = c.source_shadow_id
ORDER BY c.created_at DESC
LIMIT 200;

-- 6) Route-specific candidates (pending / contract / blocker / open-question routes)
SELECT
  s.id AS shadow_id,
  s.created_at,
  s.clerk_user_id,
  s.deterministic_route,
  s.primary_intent,
  s.disagreement_flags,
  s.body_preview
FROM v2_sms_meaning_interpretation_shadow s
LEFT JOIN v2_sms_pattern_correction c ON c.source_shadow_id = s.id
WHERE s.disagreement = true
  AND c.id IS NULL
  AND (
    s.deterministic_route ILIKE '%pending%'
    OR s.deterministic_route ILIKE '%contract%'
    OR s.deterministic_route ILIKE '%blocker%'
    OR s.deterministic_route ILIKE '%open%'
  )
ORDER BY s.created_at DESC
LIMIT 200;

-- 7) Open-question answer style candidates
SELECT
  s.id AS shadow_id,
  s.created_at,
  s.clerk_user_id,
  s.commitment_id,
  s.deterministic_route,
  s.primary_intent,
  s.body_preview,
  s.shadow_json ->> 'open_question_answer_summary' AS open_q_summary
FROM v2_sms_meaning_interpretation_shadow s
LEFT JOIN v2_sms_pattern_correction c
  ON c.source_shadow_id = s.id
  AND c.correction_type = 'open_question_answer_style'
WHERE s.disagreement = true
  AND (
    s.deterministic_route ILIKE '%open%'
    OR s.primary_intent ILIKE '%open%'
    OR (s.shadow_json ->> 'answered_open_question') IN ('yes', 'partial', 'no')
  )
  AND c.id IS NULL
ORDER BY s.created_at DESC
LIMIT 200;

-- 8) Repeated misunderstanding candidates by normalized pattern
SELECT
  lower(trim(coalesce(s.body_preview, ''))) AS body_key,
  count(*) AS disagreement_count,
  count(DISTINCT s.clerk_user_id) AS distinct_users,
  array_agg(DISTINCT s.deterministic_route) AS routes_seen,
  max(s.created_at) AS last_seen
FROM v2_sms_meaning_interpretation_shadow s
LEFT JOIN v2_sms_pattern_correction c
  ON c.source_shadow_id = s.id
  AND c.status IN ('approved', 'suggested')
WHERE s.disagreement = true
  AND coalesce(length(trim(s.body_preview)), 0) > 0
  AND c.id IS NULL
  AND s.created_at >= now() - interval '30 days'
GROUP BY body_key
HAVING count(*) >= 2
ORDER BY disagreement_count DESC, last_seen DESC
LIMIT 100;

-- 9) Expired / stale corrections
SELECT
  id,
  scope,
  clerk_user_id,
  correction_type,
  status,
  usage_policy,
  meaning_label,
  normalized_pattern,
  expires_at,
  updated_at,
  use_count
FROM v2_sms_pattern_correction
WHERE (
  expires_at IS NOT NULL
  AND expires_at < now()
)
OR (
  status = 'approved'
  AND updated_at < now() - interval '180 days'
  AND coalesce(use_count, 0) = 0
)
ORDER BY expires_at NULLS LAST, updated_at ASC
LIMIT 200;

-- 10) Corrections used recently
SELECT
  id,
  scope,
  clerk_user_id,
  correction_type,
  status,
  meaning_label,
  normalized_pattern,
  last_used_at,
  use_count,
  updated_at
FROM v2_sms_pattern_correction
WHERE last_used_at IS NOT NULL
  AND last_used_at >= now() - interval '30 days'
ORDER BY last_used_at DESC
LIMIT 200;

-- 11) All suggested corrections awaiting review
SELECT
  id,
  scope,
  clerk_user_id,
  commitment_id,
  correction_type,
  meaning_label,
  normalized_pattern,
  phrase_pattern,
  source,
  source_shadow_id,
  confidence,
  created_by,
  created_at,
  updated_at
FROM v2_sms_pattern_correction
WHERE status = 'suggested'
ORDER BY created_at DESC
LIMIT 500;

-- 12) Rejected corrections audit
SELECT
  id,
  scope,
  clerk_user_id,
  correction_type,
  meaning_label,
  normalized_pattern,
  source,
  source_shadow_id,
  reviewed_by,
  reviewed_at,
  review_note,
  created_at
FROM v2_sms_pattern_correction
WHERE status = 'rejected'
ORDER BY reviewed_at DESC NULLS LAST, created_at DESC
LIMIT 200;

-- =============================================================================
-- DO NOT RUN WITHOUT REVIEW — manual INSERT/UPDATE templates (commented out)
-- =============================================================================

-- -- DO NOT RUN WITHOUT REVIEW: insert suggested correction from shadow row
-- INSERT INTO v2_sms_pattern_correction (
--   scope,
--   clerk_user_id,
--   commitment_id,
--   correction_type,
--   phrase_pattern,
--   normalized_pattern,
--   meaning_label,
--   correction_summary,
--   usage_policy,
--   status,
--   source,
--   source_shadow_id,
--   source_message_sid,
--   confidence,
--   created_by,
--   metadata
-- )
-- SELECT
--   CASE WHEN s.commitment_id IS NULL THEN 'user' ELSE 'commitment' END,
--   s.clerk_user_id,
--   s.commitment_id,
--   'shadow_disagreement_reviewed',
--   left(trim(s.body_preview), 240),
--   lower(left(trim(s.body_preview), 240)),
--   'operator_reviewed_meaning',
--   'Reviewed from shadow disagreement — adjust summary before approve.',
--   'prompt_hint_only',
--   'suggested',
--   'shadow_review',
--   s.id,
--   s.inbound_message_sid,
--   s.confidence,
--   'operator_manual',
--   jsonb_build_object('deterministic_route', s.deterministic_route)
-- FROM v2_sms_meaning_interpretation_shadow s
-- WHERE s.id = '00000000-0000-0000-0000-000000000000'::uuid;

-- -- DO NOT RUN WITHOUT REVIEW: approve suggested correction
-- UPDATE v2_sms_pattern_correction
-- SET
--   status = 'approved',
--   reviewed_by = 'operator_manual',
--   reviewed_at = now(),
--   updated_at = now()
-- WHERE id = '00000000-0000-0000-0000-000000000000'::uuid
--   AND status = 'suggested';

-- -- DO NOT RUN WITHOUT REVIEW: reject correction
-- UPDATE v2_sms_pattern_correction
-- SET
--   status = 'rejected',
--   reviewed_by = 'operator_manual',
--   reviewed_at = now(),
--   review_note = 'Reason for rejection',
--   updated_at = now()
-- WHERE id = '00000000-0000-0000-0000-000000000000'::uuid;

-- -- DO NOT RUN WITHOUT REVIEW: archive correction
-- UPDATE v2_sms_pattern_correction
-- SET
--   status = 'archived',
--   reviewed_by = 'operator_manual',
--   reviewed_at = now(),
--   updated_at = now()
-- WHERE id = '00000000-0000-0000-0000-000000000000'::uuid;
