-- Read-only: find recent SMS possibly damaged by North Star destructive micro-edits.
-- Run in Supabase SQL editor. Does not mutate data.
-- Daily sent rows: status IN ('sent','delivered','queued','accepted','sending') OR message_sid OR note='sent_to_twilio'.

-- Daily outbound (sms_send_events)
SELECT
  e.clerk_user_id,
  e.created_at,
  e.day_key,
  e.status,
  e.message_sid,
  e.metadata->>'sms_body' AS sent_body,
  e.metadata->'north_star_gate'->>'original_body' AS original_body,
  e.metadata->'north_star_gate'->>'body_after_north_star' AS body_after_north_star,
  e.metadata->'north_star_gate'->>'final_body' AS final_body,
  e.metadata->'north_star_gate'->>'north_star_rewrite_type' AS north_star_rewrite_type,
  e.metadata->'north_star_gate'->'north_star_gate_reasons' AS north_star_gate_reasons,
  e.metadata->'north_star_gate'->>'north_star_rewrote_body' AS north_star_rewrote_body,
  e.metadata->'final_voice_gate'->>'voice_decision' AS voice_decision
FROM sms_send_events e
WHERE e.created_at >= NOW() - INTERVAL '7 days'
  AND (
    e.status IN ('sent', 'delivered', 'queued', 'accepted', 'sending')
    OR NULLIF(BTRIM(e.message_sid), '') IS NOT NULL
    OR e.metadata->>'note' = 'sent_to_twilio'
  )
  AND (
    e.metadata->>'sms_body' ILIKE '%how does it feel to Would%'
    OR e.metadata->>'sms_body' ILIKE '% to Would%'
    OR e.metadata->>'sms_body' ILIKE '% to What%'
    OR e.metadata->>'sms_body' ILIKE '% to How%'
    OR e.metadata->>'sms_body' ILIKE '% to Did%'
    OR e.metadata->>'sms_body' ILIKE '% to Let%'
    OR e.metadata->>'sms_body' ILIKE '%with to%'
    OR e.metadata->>'sms_body' ILIKE '%journey. Would%'
    OR e.metadata->>'sms_body' ILIKE '%on this . Would%'
    OR e.metadata->>'sms_body' ILIKE '%if you need%'
    OR e.metadata->'north_star_gate'->>'body_after_north_star' ILIKE '%how does it feel to Would%'
    OR e.metadata->'north_star_gate'->>'body_after_north_star' ILIKE '% to Would%'
    OR e.metadata->'north_star_gate'->>'body_after_north_star' ILIKE '%with to%'
    OR e.metadata->'north_star_gate'->>'body_after_north_star' ILIKE '% to How%'
    OR e.metadata->'north_star_gate'->>'body_after_north_star' ILIKE '% to Did%'
    OR e.metadata->'north_star_gate'->>'body_after_north_star' ILIKE '% to Let%'
    OR e.metadata->'north_star_gate'->>'north_star_rewrite_type' = 'micro_edit'
    OR e.metadata->'north_star_gate'->'north_star_gate_reasons'::text ILIKE '%product_jargon_scrub%'
    OR e.metadata->'north_star_gate'->'north_star_gate_reasons'::text ILIKE '%robot_motivation_scrub%'
    OR e.metadata->'north_star_gate'->'north_star_gate_reasons'::text ILIKE '%wrong_temporal_scrub%'
    OR e.metadata->'north_star_gate'->'north_star_gate_reasons'::text ILIKE '%app_deflection%'
    OR e.metadata->'north_star_gate'->'north_star_gate_reasons'::text ILIKE '%daily_fluff%'
    OR e.metadata->'north_star_gate'->'north_star_gate_reasons'::text ILIKE '%v3_open_answer_scrub%'
    OR e.metadata->'north_star_gate'->'north_star_gate_reasons'::text ILIKE '%daily_fluff_micro_strip%'
    OR (
      e.metadata->'north_star_gate'->>'reply_source' ~ '^v3_.*relationship'
      AND e.metadata->'north_star_gate'->>'north_star_rewrite_type' = 'micro_edit'
    )
    OR (
      e.metadata->'north_star_gate'->>'original_body' IS NOT NULL
      AND e.metadata->'north_star_gate'->>'body_after_north_star' IS NOT NULL
      AND e.metadata->'north_star_gate'->>'original_body'
        <> e.metadata->'north_star_gate'->>'body_after_north_star'
      AND e.metadata->>'sms_body' = e.metadata->'north_star_gate'->>'body_after_north_star'
    )
  )
ORDER BY e.created_at DESC
LIMIT 500;

-- V3 relationship sources: micro_edit with body change (repair_required expected instead)
SELECT
  e.clerk_user_id,
  e.created_at,
  e.metadata->'north_star_gate'->>'reply_source' AS reply_source,
  e.metadata->'north_star_gate'->>'north_star_rewrite_type' AS rewrite_type,
  e.metadata->'north_star_gate'->>'original_body' AS original_body,
  e.metadata->'north_star_gate'->>'body_after_north_star' AS body_after_north_star,
  e.metadata->>'sms_body' AS sent_body,
  e.metadata->'north_star_gate'->'north_star_gate_reasons' AS gate_reasons
FROM sms_send_events e
WHERE e.created_at >= NOW() - INTERVAL '7 days'
  AND (
    e.status IN ('sent', 'delivered', 'queued', 'accepted', 'sending')
    OR NULLIF(BTRIM(e.message_sid), '') IS NOT NULL
    OR e.metadata->>'note' = 'sent_to_twilio'
  )
  AND e.metadata->'north_star_gate'->>'reply_source' ~ '^v3_.*'
  AND e.metadata->'north_star_gate'->>'north_star_rewrite_type' = 'micro_edit'
  AND e.metadata->'north_star_gate'->>'original_body' IS NOT NULL
  AND e.metadata->'north_star_gate'->>'body_after_north_star' IS NOT NULL
  AND e.metadata->'north_star_gate'->>'original_body'
    <> e.metadata->'north_star_gate'->>'body_after_north_star'
ORDER BY e.created_at DESC
LIMIT 200;

-- Last outbound per user
SELECT
  c.clerk_user_id,
  c.sent_at,
  c.full_body
FROM sms_last_outbound_context c
WHERE c.sent_at >= NOW() - INTERVAL '7 days'
  AND (
    c.full_body ILIKE '%how does it feel to Would%'
    OR c.full_body ILIKE '% to Would%'
    OR c.full_body ILIKE '% to What%'
    OR c.full_body ILIKE '% to How%'
    OR c.full_body ILIKE '% to Did%'
    OR c.full_body ILIKE '% to Let%'
    OR c.full_body ILIKE '%with to%'
    OR c.full_body ILIKE '%journey. Would%'
    OR c.full_body ILIKE '%on this . Would%'
    OR c.full_body ILIKE '%if you need%'
  )
ORDER BY c.sent_at DESC;
