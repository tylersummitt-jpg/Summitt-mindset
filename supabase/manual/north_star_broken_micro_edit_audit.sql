-- Read-only: find recent SMS possibly damaged by North Star destructive micro-edits.
-- Run in Supabase SQL editor. Does not mutate data.

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
  AND e.status IN ('sent', 'delivered', 'queued')
  AND (
    e.metadata->>'sms_body' ILIKE '%how does it feel to Would%'
    OR e.metadata->>'sms_body' ILIKE '% to Would%'
    OR e.metadata->>'sms_body' ILIKE '% to What%'
    OR e.metadata->'north_star_gate'->>'body_after_north_star' ILIKE '%how does it feel to Would%'
    OR e.metadata->'north_star_gate'->>'body_after_north_star' ILIKE '% to Would%'
    OR e.metadata->'north_star_gate'->>'north_star_rewrite_type' = 'micro_edit'
    OR e.metadata->'north_star_gate'->'north_star_gate_reasons'::text ILIKE '%product_jargon_scrub%'
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
  )
ORDER BY c.sent_at DESC;
