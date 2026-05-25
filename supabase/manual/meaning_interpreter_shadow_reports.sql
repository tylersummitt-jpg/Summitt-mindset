-- Manual read-only reports for Unified SMS Meaning Interpreter Shadow Mode.

-- Run in Supabase SQL editor. Does not mutate data.



-- 1) Last 24h shadow rows

SELECT

  created_at,

  clerk_user_id,

  inbound_message_sid,

  deterministic_route,

  shadow_status,

  skipped_reason,

  outcome_sent,

  primary_intent,

  confidence,

  disagreement,

  disagreement_flags,

  ok,

  error_code,

  latency_ms,

  body_preview,

  reply_body_preview

FROM v2_sms_meaning_interpretation_shadow

WHERE created_at >= now() - interval '24 hours'

ORDER BY created_at DESC

LIMIT 200;



-- 2) Route coverage by deterministic_route (7 days)

SELECT

  deterministic_route,

  shadow_status,

  count(*) AS n

FROM v2_sms_meaning_interpretation_shadow

WHERE created_at >= now() - interval '7 days'

GROUP BY deterministic_route, shadow_status

ORDER BY n DESC;



-- 3) Sent coach jobs without shadow row (24h coverage gap)

SELECT

  j.message_sid,

  j.sent_at,

  j.reply_body,

  m.raw_body

FROM sms_inbound_coach_jobs j

LEFT JOIN v2_sms_meaning_interpretation_shadow s

  ON s.inbound_message_sid = j.message_sid

LEFT JOIN sms_inbound_messages m

  ON m.message_sid = j.message_sid

WHERE j.sent_at >= now() - interval '24 hours'

  AND s.id IS NULL

ORDER BY j.sent_at DESC

LIMIT 100;



-- 4) Skipped/excluded counts (7 days)

SELECT

  coalesce(skipped_reason, deterministic_route) AS skip_bucket,

  count(*) AS n

FROM v2_sms_meaning_interpretation_shadow

WHERE shadow_status = 'skipped'

  AND created_at >= now() - interval '7 days'

GROUP BY coalesce(skipped_reason, deterministic_route)

ORDER BY n DESC;



-- 5) Disagreements by route (7 days)

SELECT

  deterministic_route,

  count(*) AS disagreement_count

FROM v2_sms_meaning_interpretation_shadow

WHERE disagreement = true

  AND created_at >= now() - interval '7 days'

GROUP BY deterministic_route

ORDER BY disagreement_count DESC;



-- 6) Top disagreements with inbound/reply preview (7 days)

SELECT

  s.created_at,

  s.inbound_message_sid,

  s.deterministic_route,

  s.primary_intent,

  s.disagreement_flags,

  s.shadow_json ->> 'explanation_short' AS explanation_short,

  s.body_preview,

  s.reply_body_preview,

  left(m.raw_body, 160) AS inbound_raw_preview,

  left(j.reply_body, 160) AS coach_reply_preview

FROM v2_sms_meaning_interpretation_shadow s

LEFT JOIN sms_inbound_messages m ON m.message_sid = s.inbound_message_sid

LEFT JOIN sms_inbound_coach_jobs j ON j.message_sid = s.inbound_message_sid

WHERE s.disagreement = true

  AND s.created_at >= now() - interval '7 days'

ORDER BY s.created_at DESC

LIMIT 50;



-- 7) Primary intent counts (7 days, OpenAI ok only)

SELECT

  primary_intent,

  count(*) AS n

FROM v2_sms_meaning_interpretation_shadow

WHERE shadow_status = 'openai_ok'

  AND ok = true

  AND created_at >= now() - interval '7 days'

GROUP BY primary_intent

ORDER BY n DESC;



-- 8) ok=false / openai_failed / error counts (7 days)

SELECT

  shadow_status,

  coalesce(error_code, '(null)') AS error_code,

  count(*) AS n

FROM v2_sms_meaning_interpretation_shadow

WHERE ok = false

  AND created_at >= now() - interval '7 days'

GROUP BY shadow_status, error_code

ORDER BY n DESC;



-- 9) Coverage vs sent coach jobs (24h)

SELECT

  (SELECT count(*) FROM v2_sms_meaning_interpretation_shadow WHERE created_at >= now() - interval '24 hours') AS shadow_rows_24h,

  (SELECT count(*) FROM sms_inbound_coach_jobs WHERE sent_at >= now() - interval '24 hours') AS coach_jobs_sent_24h,

  (SELECT count(*) FROM v2_sms_meaning_interpretation_shadow WHERE shadow_status = 'skipped' AND created_at >= now() - interval '24 hours') AS skipped_rows_24h;



-- 10) Open-question answer disagreements (7 days)

SELECT

  s.created_at,

  s.inbound_message_sid,

  s.deterministic_route,

  s.primary_intent,

  s.disagreement_flags,

  s.deterministic_facts ->> 'open_question_text' AS open_question_text,

  s.shadow_json ->> 'answered_open_question' AS answered_open_question,

  s.shadow_json ->> 'open_question_answer_summary' AS answer_summary,

  s.body_preview,

  left(j.reply_body, 160) AS reply_preview

FROM v2_sms_meaning_interpretation_shadow s

LEFT JOIN sms_inbound_coach_jobs j ON j.message_sid = s.inbound_message_sid

WHERE s.created_at >= now() - interval '7 days'

  AND (

    'shadow_open_question_answer_vs_route' = ANY(s.disagreement_flags)

    OR (

      s.primary_intent = 'open_question_answer'

      AND s.deterministic_route IS DISTINCT FROM 'open_question_answer'

    )

  )

ORDER BY s.created_at DESC

LIMIT 50;



-- 11) Pending resolution disagreement slice (7 days)

SELECT

  s.created_at,

  s.inbound_message_sid,

  s.deterministic_route,

  s.primary_intent,

  s.confidence,

  s.disagreement_flags,

  s.deterministic_facts ->> 'pending_resolution_kind' AS pending_kind,

  s.deterministic_facts ->> 'user_answer_type' AS user_answer_type,

  left(m.raw_body, 160) AS inbound_raw_preview,

  left(j.reply_body, 160) AS reply_preview

FROM v2_sms_meaning_interpretation_shadow s

LEFT JOIN sms_inbound_messages m ON m.message_sid = s.inbound_message_sid

LEFT JOIN sms_inbound_coach_jobs j ON j.message_sid = s.inbound_message_sid

WHERE s.created_at >= now() - interval '7 days'

  AND s.deterministic_route LIKE 'pending_resolution%'

  AND (s.disagreement = true OR s.primary_intent IN ('meta_or_confusion', 'commitment_change', 'unclear'))

ORDER BY s.created_at DESC

LIMIT 50;



-- 12) Contract consent disagreement slice (7 days)

SELECT

  s.created_at,

  s.inbound_message_sid,

  s.deterministic_route,

  s.primary_intent,

  s.confidence,

  s.disagreement_flags,

  s.deterministic_facts ->> 'overlay_action' AS overlay_action,

  s.deterministic_facts ->> 'rpc_result' AS rpc_result,

  left(m.raw_body, 160) AS inbound_raw_preview,

  left(j.reply_body, 160) AS reply_preview

FROM v2_sms_meaning_interpretation_shadow s

LEFT JOIN sms_inbound_messages m ON m.message_sid = s.inbound_message_sid

LEFT JOIN sms_inbound_coach_jobs j ON j.message_sid = s.inbound_message_sid

WHERE s.created_at >= now() - interval '7 days'

  AND s.deterministic_route IN ('contract_consent', 'contract_ambiguous_consent')

  AND (s.disagreement = true OR s.primary_intent IN ('meta_or_confusion', 'unclear'))

ORDER BY s.created_at DESC

LIMIT 50;



-- 13) Blocker capture disagreement slice (7 days)

SELECT

  s.created_at,

  s.inbound_message_sid,

  s.deterministic_route,

  s.primary_intent,

  s.disagreement_flags,

  s.deterministic_facts ->> 'blocker_text_preview' AS blocker_preview,

  left(m.raw_body, 160) AS inbound_raw_preview,

  left(j.reply_body, 160) AS reply_preview

FROM v2_sms_meaning_interpretation_shadow s

LEFT JOIN sms_inbound_messages m ON m.message_sid = s.inbound_message_sid

LEFT JOIN sms_inbound_coach_jobs j ON j.message_sid = s.inbound_message_sid

WHERE s.created_at >= now() - interval '7 days'

  AND s.deterministic_route = 'blocker_capture'

  AND s.disagreement = true

ORDER BY s.created_at DESC

LIMIT 50;


