-- =============================================================================
-- SMS SOAK DEBUG PACK (read-only)
-- =============================================================================
-- Run in Supabase SQL editor. SELECT-only — does not mutate data.
--
-- Daily workflow (replaces ~15 ad-hoc exports):
--   1. Query 1  — health rollup (start here)
--   2. Query 2  — chronological timeline (when triaging a user/day)
--   3. Query 3  — visible bodies (what users actually saw)
--   4. Query 4  — no-send / skip / block detail
--   5. Query 5  — inbound pairing (user text → job → reply/no-send)
--   6. Query 6  — per-user scoreboard
--   Optional deep-dives: Queries 7–10
--
-- DATE: change day_start / day_end in each query's bounds CTE (America/New_York).
--
-- JSON path reference (Phase 4 consolidation):
--   strategy_card_*     relationship_packet_observability | top-level | daily_v3_lane |
--                         weekly_lane_metadata | inbound_v3_lane | extras
--   no_send / skip      relationship_packet_observability | daily_v3_lane | inbound_v3_lane |
--                         skip_reason | voice_send_decision | final_voice_gate |
--                         unified_final_product_law_guard
--   visible_sent        voice_send_decision | top-level metadata | inferred from status+SID
--   twilio_send_attempted voice_send_decision | top-level | message_sid present
--   final guard mode    unified_final_product_law_guard | voice_send_decision | top-level
--
-- sms_send_events.status (daily cron — do NOT count only status = 'sent'):
--   sent/delivered/queued/accepted/sending + message_sid + note='sent_to_twilio' => outbound accepted
--   skipped_* / voice_decision skipped* => intentional no-send
-- =============================================================================


-- =============================================================================
-- QUERY 1 — sms_day_health_rollup
-- One row per lane × route × strategy card × no-send reason.
-- Tells us: where volume landed, how many visible sends vs Twilio attempts vs skips.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS day_start,  -- <<< change day
    timestamptz '2026-06-12 00:00:00 America/New_York' AS day_end     -- <<< exclusive end
),
normalized AS (
  SELECT
    'daily'::text AS lane,
    e.clerk_user_id,
    e.status,
    e.message_sid,
    e.metadata AS meta,
    COALESCE(
      e.metadata->'daily_v3_lane'->>'route_kind',
      e.metadata->'inbound_v3_lane'->>'route_kind',
      e.metadata->'weekly_lane_metadata'->>'route_kind',
      e.metadata->'relationship_packet_observability'->>'strategy_card_route_kind',
      e.metadata->>'route_kind',
      e.metadata->'extras'->>'route_kind'
    ) AS route_kind,
    COALESCE(
      e.metadata->'daily_v3_lane'->>'route_purpose',
      e.metadata->>'route_purpose',
      e.metadata->'relationship_packet_observability'->>'strategy_card_route_kind',
      e.metadata->'daily_v3_lane'->>'route_kind',
      e.metadata->'extras'->>'route_purpose'
    ) AS route_purpose,
    COALESCE(
      e.metadata->'relationship_packet_observability'->>'strategy_card_surface',
      e.metadata->>'strategy_card_surface',
      e.metadata->'daily_v3_lane'->>'strategy_card_surface',
      e.metadata->'weekly_lane_metadata'->>'strategy_card_surface',
      e.metadata->'inbound_v3_lane'->>'strategy_card_surface',
      e.metadata->'extras'->>'strategy_card_surface'
    ) AS strategy_card_surface,
    COALESCE(
      e.metadata->'relationship_packet_observability'->>'strategy_card_route_kind',
      e.metadata->>'strategy_card_route_kind',
      e.metadata->'daily_v3_lane'->>'strategy_card_route_kind',
      e.metadata->'weekly_lane_metadata'->>'strategy_card_route_kind',
      e.metadata->'inbound_v3_lane'->>'strategy_card_route_kind',
      e.metadata->'extras'->>'strategy_card_route_kind'
    ) AS strategy_card_route_kind,
    COALESCE(
      e.metadata->'relationship_packet_observability'->>'strategy_card_move_type',
      e.metadata->>'strategy_card_move_type',
      e.metadata->'daily_v3_lane'->>'strategy_card_move_type',
      e.metadata->'weekly_lane_metadata'->>'strategy_card_move_type',
      e.metadata->'inbound_v3_lane'->>'strategy_card_move_type',
      e.metadata->'extras'->>'strategy_card_move_type'
    ) AS strategy_card_move_type,
    COALESCE(
      e.metadata->'relationship_packet_observability'->>'no_send_reason',
      e.metadata->'daily_v3_lane'->>'no_send_reason',
      e.metadata->>'skip_reason',
      e.metadata->'voice_send_decision'->>'skip_reason',
      e.metadata->>'no_send_reason',
      e.metadata->'final_voice_gate'->>'skip_reason',
      e.metadata->'unified_final_product_law_guard'->>'no_send_reason',
      e.metadata->'voice_send_decision'->>'no_send_reason'
    ) AS no_send_reason,
    COALESCE(
      e.metadata->>'skip_source',
      e.metadata->'voice_send_decision'->>'skip_source'
    ) AS skip_source,
    COALESCE(
      e.metadata->'unified_final_product_law_guard'->>'unified_final_guard_mode',
      e.metadata->'voice_send_decision'->>'unified_final_guard_mode',
      e.metadata->>'unified_final_guard_mode'
    ) AS final_guard_mode,
    COALESCE(
      (e.metadata->'voice_send_decision'->>'visible_sent')::boolean,
      (e.metadata->>'visible_sent')::boolean,
      (
        (
          e.status IN ('sent', 'delivered', 'queued', 'accepted', 'sending')
          OR NULLIF(BTRIM(e.message_sid), '') IS NOT NULL
          OR e.metadata->>'note' = 'sent_to_twilio'
        )
        AND NOT (
          e.status LIKE 'skipped_%'
          OR e.metadata->>'voice_decision' LIKE 'skipped%'
          OR COALESCE(e.metadata->'voice_send_decision'->>'should_send', '') = 'false'
        )
      )
    ) AS visible_sent,
    COALESCE(
      (e.metadata->'voice_send_decision'->>'twilio_send_attempted')::boolean,
      (e.metadata->>'twilio_send_attempted')::boolean,
      NULLIF(BTRIM(e.message_sid), '') IS NOT NULL
    ) AS twilio_send_attempted
  FROM sms_send_events e
  CROSS JOIN bounds b
  WHERE e.created_at >= b.day_start
    AND e.created_at < b.day_end

  UNION ALL

  SELECT
    'weekly'::text,
    w.clerk_user_id,
    w.status,
    w.message_sid,
    w.metadata,
    COALESCE(
      w.metadata->'weekly_lane_metadata'->>'route_kind',
      w.metadata->'relationship_packet_observability'->>'strategy_card_route_kind',
      w.metadata->>'route_kind',
      w.metadata->'extras'->>'route_kind'
    ),
    COALESCE(
      w.metadata->'weekly_lane_metadata'->>'route_purpose',
      w.metadata->>'route_purpose',
      w.metadata->'relationship_packet_observability'->>'strategy_card_route_kind',
      w.metadata->'extras'->>'route_purpose'
    ),
    COALESCE(
      w.metadata->'relationship_packet_observability'->>'strategy_card_surface',
      w.metadata->>'strategy_card_surface',
      w.metadata->'weekly_lane_metadata'->>'strategy_card_surface',
      w.metadata->'extras'->>'strategy_card_surface'
    ),
    COALESCE(
      w.metadata->'relationship_packet_observability'->>'strategy_card_route_kind',
      w.metadata->>'strategy_card_route_kind',
      w.metadata->'weekly_lane_metadata'->>'strategy_card_route_kind',
      w.metadata->'extras'->>'strategy_card_route_kind'
    ),
    COALESCE(
      w.metadata->'relationship_packet_observability'->>'strategy_card_move_type',
      w.metadata->>'strategy_card_move_type',
      w.metadata->'weekly_lane_metadata'->>'strategy_card_move_type',
      w.metadata->'extras'->>'strategy_card_move_type'
    ),
    COALESCE(
      w.metadata->'relationship_packet_observability'->>'no_send_reason',
      w.metadata->>'no_send_reason',
      w.metadata->'voice_send_decision'->>'skip_reason',
      w.metadata->'final_voice_gate'->>'skip_reason',
      w.metadata->'unified_final_product_law_guard'->>'no_send_reason'
    ),
    COALESCE(
      w.metadata->>'skip_source',
      w.metadata->'voice_send_decision'->>'skip_source'
    ),
    COALESCE(
      w.metadata->'unified_final_product_law_guard'->>'unified_final_guard_mode',
      w.metadata->'voice_send_decision'->>'unified_final_guard_mode',
      w.metadata->>'unified_final_guard_mode'
    ),
    COALESCE(
      (w.metadata->'voice_send_decision'->>'visible_sent')::boolean,
      (w.metadata->>'visible_sent')::boolean,
      (
        (
          w.status IN ('sent', 'delivered', 'queued', 'accepted', 'sending')
          OR NULLIF(BTRIM(w.message_sid), '') IS NOT NULL
        )
        AND w.status NOT LIKE 'skipped_%'
      )
    ),
    COALESCE(
      (w.metadata->'voice_send_decision'->>'twilio_send_attempted')::boolean,
      (w.metadata->>'twilio_send_attempted')::boolean,
      NULLIF(BTRIM(w.message_sid), '') IS NOT NULL
    )
  FROM sms_weekly_send_events w
  CROSS JOIN bounds b
  WHERE w.created_at >= b.day_start
    AND w.created_at < b.day_end

  UNION ALL

  SELECT
    'inbound'::text,
    j.clerk_user_id,
    j.status,
    COALESCE(j.outbound_message_sid, j.message_sid),
    COALESCE(ev.payload_json, '{}'::jsonb),
    COALESCE(
      ev.payload_json->'inbound_v3_lane'->>'route_kind',
      ev.payload_json->'relationship_packet_observability'->>'strategy_card_route_kind',
      ev.payload_json->>'route_kind'
    ),
    COALESCE(
      ev.payload_json->>'route_purpose',
      ev.payload_json->'inbound_v3_lane'->>'route_purpose',
      ev.payload_json->'ai'->>'route_purpose'
    ),
    COALESCE(
      ev.payload_json->'relationship_packet_observability'->>'strategy_card_surface',
      ev.payload_json->>'strategy_card_surface',
      ev.payload_json->'inbound_v3_lane'->>'strategy_card_surface',
      ev.payload_json->'v3_brain'->>'strategy_card_surface'
    ),
    COALESCE(
      ev.payload_json->'relationship_packet_observability'->>'strategy_card_route_kind',
      ev.payload_json->>'strategy_card_route_kind',
      ev.payload_json->'inbound_v3_lane'->>'strategy_card_route_kind'
    ),
    COALESCE(
      ev.payload_json->'relationship_packet_observability'->>'strategy_card_move_type',
      ev.payload_json->>'strategy_card_move_type',
      ev.payload_json->'inbound_v3_lane'->>'strategy_card_move_type'
    ),
    COALESCE(
      ev.payload_json->'relationship_packet_observability'->>'no_send_reason',
      ev.payload_json->'inbound_v3_lane'->>'no_send_reason',
      ev.payload_json->'ai'->'reply_resolution'->>'reply_source',
      ev.payload_json->'final_voice_gate'->>'skip_reason',
      ev.payload_json->'unified_final_product_law_guard'->>'no_send_reason',
      ev.payload_json->>'no_send_reason'
    ),
    COALESCE(
      ev.payload_json->>'skip_source',
      ev.payload_json->'voice_send_decision'->>'skip_source'
    ),
    COALESCE(
      ev.payload_json->'unified_final_product_law_guard'->>'unified_final_guard_mode',
      ev.payload_json->>'unified_final_guard_mode'
    ),
    COALESCE(
      (ev.payload_json->>'visible_sent')::boolean,
      (ev.payload_json->'voice_send_decision'->>'visible_sent')::boolean,
      j.status = 'sent'
    ),
    COALESCE(
      (ev.payload_json->>'twilio_send_attempted')::boolean,
      (ev.payload_json->'voice_send_decision'->>'twilio_send_attempted')::boolean,
      NULLIF(BTRIM(j.outbound_message_sid), '') IS NOT NULL
    )
  FROM sms_inbound_coach_jobs j
  CROSS JOIN bounds b
  LEFT JOIN v2_commitment_event ev
    ON ev.idempotency_key = 'v2_user_reply:' || j.message_sid
  WHERE j.updated_at >= b.day_start
    AND j.updated_at < b.day_end
)
SELECT
  lane,
  route_kind,
  route_purpose,
  strategy_card_surface,
  strategy_card_route_kind,
  strategy_card_move_type,
  no_send_reason,
  skip_source,
  final_guard_mode,
  COUNT(*) AS row_count,
  COUNT(DISTINCT clerk_user_id) AS distinct_users,
  COUNT(*) FILTER (WHERE visible_sent IS TRUE) AS visible_sent_count,
  COUNT(*) FILTER (WHERE twilio_send_attempted IS TRUE) AS twilio_send_attempted_count
FROM normalized
GROUP BY
  lane,
  route_kind,
  route_purpose,
  strategy_card_surface,
  strategy_card_route_kind,
  strategy_card_move_type,
  no_send_reason,
  skip_source,
  final_guard_mode
ORDER BY row_count DESC, lane, route_kind NULLS LAST;


-- =============================================================================
-- QUERY 2 — sms_day_unified_timeline
-- Chronological all-user timeline across inbound, jobs, daily/weekly sends, spine.
-- Tells us: full day narrative for triage and ChatGPT review.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS day_start,
    timestamptz '2026-06-12 00:00:00 America/New_York' AS day_end
),
timeline AS (
  SELECT
    COALESCE(m.created_at, j.created_at) AS event_at,
    COALESCE(m.clerk_user_id, j.clerk_user_id) AS clerk_user_id,
    'sms_inbound_messages'::text AS source_table,
    'inbound'::text AS direction,
    'user_inbound'::text AS event_kind,
    NULL::text AS route,
    m.message_sid,
    NULL::text AS status,
    NULL::boolean AS visible_sent,
    NULL::boolean AS twilio_send_attempted,
    NULL::text AS no_send_reason,
    NULL::text AS strategy_card_route_kind,
    NULL::text AS strategy_card_move_type,
    LEFT(COALESCE(m.raw_body, ''), 240) AS text_preview,
    to_jsonb(m) AS raw_json
  FROM sms_inbound_messages m
  CROSS JOIN bounds b
  LEFT JOIN sms_inbound_coach_jobs j ON j.message_sid = m.message_sid
  WHERE COALESCE(m.created_at, j.created_at) >= b.day_start
    AND COALESCE(m.created_at, j.created_at) < b.day_end

  UNION ALL

  SELECT
    j.updated_at,
    j.clerk_user_id,
    'sms_inbound_coach_jobs',
    CASE WHEN j.status = 'sent' THEN 'outbound' ELSE 'internal' END,
    'inbound_coach_job',
    COALESCE(
      ev.payload_json->>'route_purpose',
      ev.payload_json->'inbound_v3_lane'->>'route_purpose'
    ),
    COALESCE(j.outbound_message_sid, j.message_sid),
    j.status,
    COALESCE(
      (ev.payload_json->>'visible_sent')::boolean,
      j.status = 'sent'
    ),
    COALESCE(
      (ev.payload_json->>'twilio_send_attempted')::boolean,
      NULLIF(BTRIM(j.outbound_message_sid), '') IS NOT NULL
    ),
    COALESCE(
      ev.payload_json->'relationship_packet_observability'->>'no_send_reason',
      ev.payload_json->'inbound_v3_lane'->>'no_send_reason',
      ev.payload_json->'unified_final_product_law_guard'->>'no_send_reason'
    ),
    COALESCE(
      ev.payload_json->'relationship_packet_observability'->>'strategy_card_route_kind',
      ev.payload_json->>'strategy_card_route_kind'
    ),
    COALESCE(
      ev.payload_json->'relationship_packet_observability'->>'strategy_card_move_type',
      ev.payload_json->>'strategy_card_move_type'
    ),
    LEFT(COALESCE(j.reply_body, j.raw_body, ''), 240),
    jsonb_build_object('job', to_jsonb(j), 'event', to_jsonb(ev))
  FROM sms_inbound_coach_jobs j
  CROSS JOIN bounds b
  LEFT JOIN v2_commitment_event ev ON ev.idempotency_key = 'v2_user_reply:' || j.message_sid
  WHERE j.updated_at >= b.day_start
    AND j.updated_at < b.day_end

  UNION ALL

  SELECT
    e.created_at,
    e.clerk_user_id,
    'sms_send_events',
    'outbound',
    'daily_send',
    COALESCE(
      e.metadata->'daily_v3_lane'->>'route_kind',
      e.metadata->'relationship_packet_observability'->>'strategy_card_route_kind'
    ),
    e.message_sid,
    e.status,
    COALESCE(
      (e.metadata->'voice_send_decision'->>'visible_sent')::boolean,
      (e.metadata->>'visible_sent')::boolean,
      (
        e.status IN ('sent', 'delivered', 'queued', 'accepted', 'sending')
        OR NULLIF(BTRIM(e.message_sid), '') IS NOT NULL
        OR e.metadata->>'note' = 'sent_to_twilio'
      )
    ),
    COALESCE(
      (e.metadata->'voice_send_decision'->>'twilio_send_attempted')::boolean,
      (e.metadata->>'twilio_send_attempted')::boolean,
      NULLIF(BTRIM(e.message_sid), '') IS NOT NULL
    ),
    COALESCE(
      e.metadata->'daily_v3_lane'->>'no_send_reason',
      e.metadata->>'skip_reason',
      e.metadata->'voice_send_decision'->>'skip_reason',
      e.metadata->'unified_final_product_law_guard'->>'no_send_reason'
    ),
    COALESCE(
      e.metadata->'relationship_packet_observability'->>'strategy_card_route_kind',
      e.metadata->>'strategy_card_route_kind'
    ),
    COALESCE(
      e.metadata->'relationship_packet_observability'->>'strategy_card_move_type',
      e.metadata->>'strategy_card_move_type'
    ),
    LEFT(COALESCE(
      e.metadata->>'sms_body',
      e.metadata->'voice_send_decision'->>'north_star_visible_body',
      e.metadata->'final_voice_gate'->>'final_voice_gate_body',
      e.sms_body,
      ''
    ), 240),
    to_jsonb(e)
  FROM sms_send_events e
  CROSS JOIN bounds b
  WHERE e.created_at >= b.day_start
    AND e.created_at < b.day_end

  UNION ALL

  SELECT
    w.created_at,
    w.clerk_user_id,
    'sms_weekly_send_events',
    'outbound',
    'weekly_send',
    COALESCE(
      w.metadata->'weekly_lane_metadata'->>'route_purpose',
      w.metadata->'relationship_packet_observability'->>'strategy_card_route_kind'
    ),
    w.message_sid,
    w.status,
    COALESCE(
      (w.metadata->'voice_send_decision'->>'visible_sent')::boolean,
      (w.metadata->>'visible_sent')::boolean,
      w.status IN ('sent', 'delivered', 'queued', 'accepted', 'sending')
        OR NULLIF(BTRIM(w.message_sid), '') IS NOT NULL
    ),
    COALESCE(
      (w.metadata->'voice_send_decision'->>'twilio_send_attempted')::boolean,
      NULLIF(BTRIM(w.message_sid), '') IS NOT NULL
    ),
    COALESCE(
      w.metadata->>'no_send_reason',
      w.metadata->'voice_send_decision'->>'skip_reason',
      w.metadata->'unified_final_product_law_guard'->>'no_send_reason'
    ),
    COALESCE(
      w.metadata->'relationship_packet_observability'->>'strategy_card_route_kind',
      w.metadata->>'strategy_card_route_kind'
    ),
    COALESCE(
      w.metadata->'relationship_packet_observability'->>'strategy_card_move_type',
      w.metadata->>'strategy_card_move_type'
    ),
    LEFT(COALESCE(
      w.metadata->>'sms_body',
      w.metadata->'voice_send_decision'->>'north_star_visible_body',
      ''
    ), 240),
    to_jsonb(w)
  FROM sms_weekly_send_events w
  CROSS JOIN bounds b
  WHERE w.created_at >= b.day_start
    AND w.created_at < b.day_end

  UNION ALL

  SELECT
    ev.occurred_at,
    ev.clerk_user_id,
    'v2_commitment_event',
    CASE
      WHEN ev.event_type IN ('user_yes', 'user_no', 'user_partial', 'user_silent') THEN 'inbound'
      WHEN ev.event_type = 'check_sent' THEN 'outbound'
      ELSE 'internal'
    END,
    ev.event_type,
    COALESCE(
      ev.payload_json->>'route_purpose',
      ev.payload_json->'ai'->>'daily_message_purpose'
    ),
    ev.payload_json->>'message_sid',
    ev.event_type,
    (ev.payload_json->>'visible_sent')::boolean,
    (ev.payload_json->>'twilio_send_attempted')::boolean,
    ev.payload_json->>'no_send_reason',
    COALESCE(
      ev.payload_json->'relationship_packet_observability'->>'strategy_card_route_kind',
      ev.payload_json->>'strategy_card_route_kind'
    ),
    COALESCE(
      ev.payload_json->'relationship_packet_observability'->>'strategy_card_move_type',
      ev.payload_json->>'strategy_card_move_type'
    ),
    LEFT(COALESCE(
      ev.payload_json->>'sms_body',
      ev.payload_json->'ai'->>'sms_body_preview',
      ev.payload_json->>'message',
      ''
    ), 240),
    to_jsonb(ev)
  FROM v2_commitment_event ev
  CROSS JOIN bounds b
  WHERE ev.occurred_at >= b.day_start
    AND ev.occurred_at < b.day_end
)
SELECT *
FROM timeline
ORDER BY event_at ASC, clerk_user_id, source_table;


-- =============================================================================
-- QUERY 3 — sms_day_visible_bodies
-- All user-visible SMS bodies/previews for the day.
-- Tells us: exact copy users saw, with guard/FVG/Twilio context.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS day_start,
    timestamptz '2026-06-12 00:00:00 America/New_York' AS day_end
),
visible_rows AS (
  SELECT
    e.created_at AS sent_at,
    e.clerk_user_id,
    'sms_send_events'::text AS source_table,
    COALESCE(
      e.metadata->'daily_v3_lane'->>'route_kind',
      e.metadata->'relationship_packet_observability'->>'strategy_card_route_kind'
    ) AS route,
    COALESCE(
      e.metadata->'relationship_packet_observability'->>'strategy_card_move_type',
      e.metadata->>'strategy_card_move_type'
    ) AS strategy_card_move_type,
    LEFT(COALESCE(
      e.metadata->>'sms_body',
      e.metadata->'voice_send_decision'->>'north_star_visible_body',
      e.metadata->'final_voice_gate'->>'final_voice_gate_body',
      e.sms_body,
      ''
    ), 400) AS body_preview,
    COALESCE(
      e.metadata->'voice_send_decision'->>'final_body_authority',
      e.metadata->>'final_body_authority'
    ) AS final_body_authority,
    COALESCE(
      (e.metadata->'final_voice_gate'->>'v3_repair_attempted')::boolean,
      (e.metadata->'daily_v3_lane'->>'daily_stale_ask_repair_attempted')::boolean
    ) AS fvg_repair_attempted,
    COALESCE(
      (e.metadata->'final_voice_gate'->>'v3_repair_succeeded')::boolean,
      (e.metadata->'daily_v3_lane'->>'daily_stale_ask_repair_succeeded')::boolean
    ) AS fvg_repair_succeeded,
    COALESCE(
      e.metadata->'unified_final_product_law_guard'->>'unified_final_guard_mode',
      e.metadata->'voice_send_decision'->>'unified_final_guard_mode',
      e.metadata->>'unified_final_guard_mode'
    ) AS final_guard_mode,
    e.message_sid AS twilio_sid,
    to_jsonb(e) AS raw_json,
    COALESCE(
      (e.metadata->'voice_send_decision'->>'visible_sent')::boolean,
      (e.metadata->>'visible_sent')::boolean,
      (
        e.status IN ('sent', 'delivered', 'queued', 'accepted', 'sending')
        OR NULLIF(BTRIM(e.message_sid), '') IS NOT NULL
        OR e.metadata->>'note' = 'sent_to_twilio'
      )
    ) AS visible_sent
  FROM sms_send_events e
  CROSS JOIN bounds b
  WHERE e.created_at >= b.day_start
    AND e.created_at < b.day_end

  UNION ALL

  SELECT
    w.created_at,
    w.clerk_user_id,
    'sms_weekly_send_events',
    COALESCE(
      w.metadata->'weekly_lane_metadata'->>'route_purpose',
      w.metadata->'relationship_packet_observability'->>'strategy_card_route_kind'
    ),
    COALESCE(
      w.metadata->'relationship_packet_observability'->>'strategy_card_move_type',
      w.metadata->>'strategy_card_move_type'
    ),
    LEFT(COALESCE(
      w.metadata->>'sms_body',
      w.metadata->'voice_send_decision'->>'north_star_visible_body',
      ''
    ), 400),
    COALESCE(
      w.metadata->'voice_send_decision'->>'final_body_authority',
      w.metadata->>'final_body_authority'
    ),
    (w.metadata->'final_voice_gate'->>'v3_repair_attempted')::boolean,
    (w.metadata->'final_voice_gate'->>'v3_repair_succeeded')::boolean,
    COALESCE(
      w.metadata->'unified_final_product_law_guard'->>'unified_final_guard_mode',
      w.metadata->>'unified_final_guard_mode'
    ),
    w.message_sid,
    to_jsonb(w),
    COALESCE(
      (w.metadata->'voice_send_decision'->>'visible_sent')::boolean,
      (w.metadata->>'visible_sent')::boolean,
      w.status IN ('sent', 'delivered', 'queued', 'accepted', 'sending')
        OR NULLIF(BTRIM(w.message_sid), '') IS NOT NULL
    )
  FROM sms_weekly_send_events w
  CROSS JOIN bounds b
  WHERE w.created_at >= b.day_start
    AND w.created_at < b.day_end

  UNION ALL

  SELECT
    COALESCE(j.sent_at, j.updated_at),
    j.clerk_user_id,
    'sms_inbound_coach_jobs',
    COALESCE(
      ev.payload_json->>'route_purpose',
      ev.payload_json->'inbound_v3_lane'->>'route_purpose'
    ),
    COALESCE(
      ev.payload_json->'relationship_packet_observability'->>'strategy_card_move_type',
      ev.payload_json->>'strategy_card_move_type'
    ),
    LEFT(COALESCE(j.reply_body, ''), 400),
    COALESCE(
      ev.payload_json->>'final_body_authority',
      ev.payload_json->'voice_send_decision'->>'final_body_authority'
    ),
    (ev.payload_json->'final_voice_gate'->>'v3_repair_attempted')::boolean,
    (ev.payload_json->'final_voice_gate'->>'v3_repair_succeeded')::boolean,
    COALESCE(
      ev.payload_json->'unified_final_product_law_guard'->>'unified_final_guard_mode',
      ev.payload_json->>'unified_final_guard_mode'
    ),
    j.outbound_message_sid,
    jsonb_build_object('job', to_jsonb(j), 'event', to_jsonb(ev)),
    COALESCE(
      (ev.payload_json->>'visible_sent')::boolean,
      j.status = 'sent'
    )
  FROM sms_inbound_coach_jobs j
  CROSS JOIN bounds b
  LEFT JOIN v2_commitment_event ev ON ev.idempotency_key = 'v2_user_reply:' || j.message_sid
  WHERE j.updated_at >= b.day_start
    AND j.updated_at < b.day_end
)
SELECT
  sent_at,
  clerk_user_id,
  source_table,
  route,
  strategy_card_move_type,
  body_preview,
  final_body_authority,
  fvg_repair_attempted,
  fvg_repair_succeeded,
  final_guard_mode,
  twilio_sid,
  raw_json
FROM visible_rows
WHERE visible_sent IS TRUE
  AND NULLIF(BTRIM(body_preview), '') IS NOT NULL
ORDER BY sent_at ASC;


-- =============================================================================
-- QUERY 4 — sms_day_no_send_details
-- All no-sends / skips / blocks with guard and repair context.
-- Tells us: why SMS did not reach users; root-cause starting point.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS day_start,
    timestamptz '2026-06-12 00:00:00 America/New_York' AS day_end
),
no_send_rows AS (
  SELECT
    e.created_at AS event_at,
    e.clerk_user_id,
    'sms_send_events'::text AS source_table,
    COALESCE(
      e.metadata->'daily_v3_lane'->>'route_kind',
      e.metadata->'relationship_packet_observability'->>'strategy_card_route_kind'
    ) AS route,
    COALESCE(
      e.metadata->'relationship_packet_observability'->>'no_send_reason',
      e.metadata->'daily_v3_lane'->>'no_send_reason',
      e.metadata->>'skip_reason',
      e.metadata->'voice_send_decision'->>'skip_reason',
      e.metadata->'final_voice_gate'->>'skip_reason',
      e.metadata->'unified_final_product_law_guard'->>'no_send_reason'
    ) AS no_send_reason,
    COALESCE(
      e.metadata->>'skip_source',
      e.metadata->'voice_send_decision'->>'skip_source'
    ) AS skip_source,
    COALESCE(
      e.metadata->'daily_v3_lane'->>'lane_stage',
      e.metadata->'relationship_packet_observability'->>'lane_stage',
      e.metadata->'inbound_v3_lane'->>'lane_stage'
    ) AS lane_stage,
    COALESCE(
      e.metadata->'unified_final_product_law_guard'->>'no_send_reason',
      e.metadata->'voice_send_decision'->>'no_send_reason'
    ) AS final_guard_reason,
    COALESCE(
      e.metadata->'unified_final_product_law_guard'->'product_law_failures',
      e.metadata->'voice_send_decision'->'product_law_failures',
      e.metadata->'final_voice_gate'->'final_voice_blocked_reasons'
    ) AS product_law_failures,
    COALESCE(
      (e.metadata->'final_voice_gate'->>'v3_repair_attempted')::boolean,
      (e.metadata->'daily_v3_lane'->>'daily_stale_ask_repair_attempted')::boolean,
      (e.metadata->'relationship_packet_observability'->>'repair_snapshot_repair_attempted')::boolean
    ) AS repair_attempted,
    COALESCE(
      (e.metadata->'final_voice_gate'->>'v3_repair_succeeded')::boolean,
      (e.metadata->'daily_v3_lane'->>'daily_stale_ask_repair_succeeded')::boolean,
      (e.metadata->'relationship_packet_observability'->>'repair_snapshot_repair_succeeded')::boolean
    ) AS repair_succeeded,
    jsonb_build_object(
      'daily_stale_ask_detected', COALESCE(
        e.metadata->'final_voice_gate'->>'daily_stale_ask_detected',
        e.metadata->'daily_v3_lane'->>'daily_stale_ask_detected'
      ),
      'daily_stale_ask_no_send_reason', COALESCE(
        e.metadata->'final_voice_gate'->>'daily_stale_ask_no_send_reason',
        e.metadata->'daily_v3_lane'->>'daily_stale_ask_no_send_reason'
      ),
      'daily_satisfied_ask_context_source', COALESCE(
        e.metadata->'voice_send_decision'->>'daily_satisfied_ask_context_source',
        e.metadata->'daily_v3_lane'->>'daily_satisfied_ask_context_source'
      ),
      'memory_repeat_no_send_reason', COALESCE(
        e.metadata->'daily_v3_lane'->>'memory_repeat_no_send_reason',
        e.metadata->'relationship_packet_observability'->>'memory_repeat_no_send_reason'
      ),
      'thread_freshness_violation_reason', COALESCE(
        e.metadata->'daily_v3_lane'->>'thread_freshness_violation_reason',
        e.metadata->'relationship_packet_observability'->>'thread_freshness_violation_reason'
      ),
      'do_not_repeat_asks_count', COALESCE(
        e.metadata->'voice_send_decision'->>'do_not_repeat_asks_count',
        e.metadata->'daily_v3_lane'->>'do_not_repeat_asks_count'
      )
    ) AS stale_memory_thread_meta,
    LEFT(COALESCE(
      e.metadata->>'sms_body',
      e.metadata->'voice_send_decision'->>'north_star_visible_body',
      e.sms_body,
      ''
    ), 240) AS body_preview,
    to_jsonb(e) AS raw_json
  FROM sms_send_events e
  CROSS JOIN bounds b
  WHERE e.created_at >= b.day_start
    AND e.created_at < b.day_end
    AND (
      e.status LIKE 'skipped_%'
      OR e.status IN ('send_failed', 'failed', 'cancelled')
      OR e.metadata->>'voice_decision' LIKE 'skipped%'
      OR COALESCE(e.metadata->'voice_send_decision'->>'should_send', '') = 'false'
      OR COALESCE(
        e.metadata->'daily_v3_lane'->>'no_send_reason',
        e.metadata->'relationship_packet_observability'->>'no_send_reason',
        e.metadata->>'skip_reason',
        e.metadata->'unified_final_product_law_guard'->>'no_send_reason'
      ) IS NOT NULL
    )

  UNION ALL

  SELECT
    w.created_at,
    w.clerk_user_id,
    'sms_weekly_send_events',
    COALESCE(
      w.metadata->'weekly_lane_metadata'->>'route_purpose',
      w.metadata->'relationship_packet_observability'->>'strategy_card_route_kind'
    ),
    COALESCE(
      w.metadata->>'no_send_reason',
      w.metadata->'voice_send_decision'->>'skip_reason',
      w.metadata->'final_voice_gate'->>'skip_reason',
      w.metadata->'unified_final_product_law_guard'->>'no_send_reason'
    ),
    w.metadata->>'skip_source',
    COALESCE(
      w.metadata->'weekly_lane_metadata'->>'lane_stage',
      w.metadata->'relationship_packet_observability'->>'lane_stage'
    ),
    w.metadata->'unified_final_product_law_guard'->>'no_send_reason',
    COALESCE(
      w.metadata->'unified_final_product_law_guard'->'product_law_failures',
      w.metadata->'final_voice_gate'->'final_voice_blocked_reasons'
    ),
    (w.metadata->'final_voice_gate'->>'v3_repair_attempted')::boolean,
    (w.metadata->'final_voice_gate'->>'v3_repair_succeeded')::boolean,
    '{}'::jsonb,
    LEFT(COALESCE(w.metadata->>'sms_body', ''), 240),
    to_jsonb(w)
  FROM sms_weekly_send_events w
  CROSS JOIN bounds b
  WHERE w.created_at >= b.day_start
    AND w.created_at < b.day_end
    AND (
      w.status LIKE 'skipped_%'
      OR w.status = 'skipped_no_safe_v3_voice'
      OR w.metadata->>'no_send_reason' IS NOT NULL
      OR COALESCE(w.metadata->'voice_send_decision'->>'should_send', '') = 'false'
    )

  UNION ALL

  SELECT
    j.updated_at,
    j.clerk_user_id,
    'sms_inbound_coach_jobs',
    COALESCE(
      ev.payload_json->>'route_purpose',
      ev.payload_json->'inbound_v3_lane'->>'route_purpose'
    ),
    COALESCE(
      ev.payload_json->'relationship_packet_observability'->>'no_send_reason',
      ev.payload_json->'inbound_v3_lane'->>'no_send_reason',
      ev.payload_json->'unified_final_product_law_guard'->>'no_send_reason',
      ev.payload_json->'final_voice_gate'->>'skip_reason',
      CASE WHEN j.status = 'cancelled' THEN COALESCE(j.last_error, 'job_cancelled') END
    ),
    ev.payload_json->>'skip_source',
    COALESCE(
      ev.payload_json->'inbound_v3_lane'->>'lane_stage',
      ev.payload_json->'relationship_packet_observability'->>'lane_stage'
    ),
    ev.payload_json->'unified_final_product_law_guard'->>'no_send_reason',
    COALESCE(
      ev.payload_json->'unified_final_product_law_guard'->'product_law_failures',
      ev.payload_json->'final_voice_gate'->'final_voice_blocked_reasons'
    ),
    COALESCE(
      (ev.payload_json->'final_voice_gate'->>'v3_repair_attempted')::boolean,
      (ev.payload_json->'relationship_packet_observability'->>'repair_snapshot_repair_attempted')::boolean
    ),
    COALESCE(
      (ev.payload_json->'final_voice_gate'->>'v3_repair_succeeded')::boolean,
      (ev.payload_json->'relationship_packet_observability'->>'repair_snapshot_repair_succeeded')::boolean
    ),
    jsonb_build_object(
      'memory_repeat_no_send_reason', ev.payload_json->'relationship_packet_observability'->>'memory_repeat_no_send_reason',
      'thread_freshness_violation_reason', ev.payload_json->'relationship_packet_observability'->>'thread_freshness_violation_reason'
    ),
    LEFT(COALESCE(j.reply_body, j.raw_body, ''), 240),
    jsonb_build_object('job', to_jsonb(j), 'event', to_jsonb(ev))
  FROM sms_inbound_coach_jobs j
  CROSS JOIN bounds b
  LEFT JOIN v2_commitment_event ev ON ev.idempotency_key = 'v2_user_reply:' || j.message_sid
  WHERE j.updated_at >= b.day_start
    AND j.updated_at < b.day_end
    AND (
      j.status IN ('cancelled', 'failed')
      OR COALESCE((ev.payload_json->>'visible_sent')::boolean, j.status = 'sent') IS FALSE
      OR ev.payload_json->'relationship_packet_observability'->>'no_send_reason' IS NOT NULL
      OR ev.payload_json->'unified_final_product_law_guard'->>'no_send_reason' IS NOT NULL
    )
)
SELECT *
FROM no_send_rows
ORDER BY event_at DESC;


-- =============================================================================
-- QUERY 5 — sms_day_inbound_pairing
-- Inbound user messages paired to coach jobs / replies / no-sends.
-- Tells us: did each inbound text get the right reply path?
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS day_start,
    timestamptz '2026-06-12 00:00:00 America/New_York' AS day_end
)
SELECT
  COALESCE(m.created_at, j.created_at) AS inbound_at,
  LEFT(COALESCE(m.raw_body, j.raw_body, ''), 240) AS user_text,
  COALESCE(m.message_sid, j.message_sid) AS inbound_message_sid,
  j.status AS job_status,
  COALESCE(
    ev.payload_json->>'route_purpose',
    ev.payload_json->'inbound_v3_lane'->>'route_purpose'
  ) AS job_route_purpose,
  COALESCE(
    ev.payload_json->>'branch_name',
    ev.payload_json->'inbound_v3_lane'->>'branch_name'
  ) AS branch_name,
  COALESCE(
    ev.payload_json->'relationship_packet_observability'->>'no_send_reason',
    ev.payload_json->'inbound_v3_lane'->>'no_send_reason',
    ev.payload_json->'unified_final_product_law_guard'->>'no_send_reason'
  ) AS no_send_reason,
  LEFT(COALESCE(j.reply_body, ''), 240) AS reply_body_preview,
  COALESCE(
    ev.payload_json->'relationship_packet_observability'->>'strategy_card_move_type',
    ev.payload_json->>'strategy_card_move_type'
  ) AS strategy_card_move_type,
  j.outbound_message_sid AS twilio_outbound_sid,
  to_jsonb(m) AS raw_inbound,
  jsonb_build_object('job', to_jsonb(j), 'event', to_jsonb(ev)) AS raw_job
FROM sms_inbound_coach_jobs j
CROSS JOIN bounds b
LEFT JOIN sms_inbound_messages m ON m.message_sid = j.message_sid
LEFT JOIN v2_commitment_event ev ON ev.idempotency_key = 'v2_user_reply:' || j.message_sid
WHERE COALESCE(m.created_at, j.created_at) >= b.day_start
  AND COALESCE(m.created_at, j.created_at) < b.day_end
ORDER BY inbound_at ASC;


-- =============================================================================
-- QUERY 6 — sms_day_user_scoreboard
-- One row per user: inbound/outbound counts and last-known state.
-- Tells us: who had a noisy day; who got blocked repeatedly.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS day_start,
    timestamptz '2026-06-12 00:00:00 America/New_York' AS day_end
),
inbound_msgs AS (
  SELECT m.clerk_user_id, COUNT(*) AS inbound_user_messages
  FROM sms_inbound_messages m
  CROSS JOIN bounds b
  WHERE COALESCE(m.created_at, now()) >= b.day_start
    AND COALESCE(m.created_at, now()) < b.day_end
  GROUP BY m.clerk_user_id
),
inbound_jobs AS (
  SELECT j.clerk_user_id, COUNT(*) AS inbound_coach_jobs
  FROM sms_inbound_coach_jobs j
  CROSS JOIN bounds b
  WHERE j.updated_at >= b.day_start AND j.updated_at < b.day_end
  GROUP BY j.clerk_user_id
),
outbound AS (
  SELECT
    e.clerk_user_id,
    COUNT(*) AS outbound_send_rows,
    COUNT(*) FILTER (WHERE COALESCE(
      (e.metadata->'voice_send_decision'->>'visible_sent')::boolean,
      (e.metadata->>'visible_sent')::boolean,
      e.status IN ('sent', 'delivered', 'queued', 'accepted', 'sending')
        OR NULLIF(BTRIM(e.message_sid), '') IS NOT NULL
    ) IS TRUE) AS visible_sent_true,
    COUNT(*) FILTER (WHERE COALESCE(
      (e.metadata->'voice_send_decision'->>'visible_sent')::boolean,
      (e.metadata->>'visible_sent')::boolean,
      false
    ) IS FALSE
      AND (
        e.status LIKE 'skipped_%'
        OR e.metadata->>'voice_decision' LIKE 'skipped%'
      )) AS visible_sent_false,
    COUNT(*) FILTER (WHERE COALESCE(
      (e.metadata->'voice_send_decision'->>'twilio_send_attempted')::boolean,
      (e.metadata->>'twilio_send_attempted')::boolean,
      NULLIF(BTRIM(e.message_sid), '') IS NOT NULL
    ) IS TRUE) AS twilio_attempted_true,
    COUNT(*) FILTER (WHERE COALESCE(
      e.metadata->'daily_v3_lane'->>'no_send_reason',
      e.metadata->'relationship_packet_observability'->>'no_send_reason',
      e.metadata->>'skip_reason',
      e.metadata->'unified_final_product_law_guard'->>'no_send_reason'
    ) IS NOT NULL) AS no_send_count,
    COUNT(*) FILTER (WHERE COALESCE(
      e.metadata->'daily_v3_lane'->>'no_send_reason',
      e.metadata->'relationship_packet_observability'->>'no_send_reason',
      ''
    ) ILIKE '%robot%'
      OR COALESCE(e.metadata->'daily_v3_lane'->>'lane_stage', '') ILIKE '%robot%'
      OR COALESCE(e.metadata->>'skip_reason', '') ILIKE '%robotic%') AS robot_commitment_pattern_count,
    COUNT(*) FILTER (WHERE COALESCE(
      e.metadata->'daily_v3_lane'->>'no_send_reason',
      e.metadata->'final_voice_gate'->>'daily_stale_ask_no_send_reason',
      ''
    ) ILIKE '%stale%ask%'
      OR e.metadata->>'skip_source' = 'stale_ask_no_send') AS daily_stale_block_count,
    COUNT(*) FILTER (WHERE COALESCE(
      e.metadata->'daily_v3_lane'->>'no_send_reason',
      e.metadata->'relationship_packet_observability'->>'no_send_reason',
      ''
    ) ILIKE '%memory_repeat%'
      OR COALESCE(
        e.metadata->'daily_v3_lane'->>'memory_repeat_no_send_reason',
        e.metadata->'relationship_packet_observability'->>'memory_repeat_no_send_reason',
        ''
      ) <> '') AS thread_memory_repeat_count,
    COUNT(*) FILTER (WHERE COALESCE(
      e.metadata->'daily_v3_lane'->>'no_send_reason',
      e.metadata->'relationship_packet_observability'->>'no_send_reason',
      ''
    ) ILIKE '%thread_freshness%'
      OR COALESCE(
        e.metadata->'daily_v3_lane'->>'thread_freshness_violation_reason',
        e.metadata->'relationship_packet_observability'->>'thread_freshness_violation_reason',
        ''
      ) <> '') AS thread_freshness_count
  FROM sms_send_events e
  CROSS JOIN bounds b
  WHERE e.created_at >= b.day_start AND e.created_at < b.day_end
  GROUP BY e.clerk_user_id

  UNION ALL

  SELECT
    w.clerk_user_id,
    COUNT(*),
    COUNT(*) FILTER (WHERE COALESCE(
      (w.metadata->'voice_send_decision'->>'visible_sent')::boolean,
      w.status IN ('sent', 'delivered', 'queued', 'accepted', 'sending')
    ) IS TRUE),
    COUNT(*) FILTER (WHERE w.status LIKE 'skipped_%'),
    COUNT(*) FILTER (WHERE NULLIF(BTRIM(w.message_sid), '') IS NOT NULL),
    COUNT(*) FILTER (WHERE w.metadata->>'no_send_reason' IS NOT NULL),
    0, 0, 0, 0
  FROM sms_weekly_send_events w
  CROSS JOIN bounds b
  WHERE w.created_at >= b.day_start AND w.created_at < b.day_end
  GROUP BY w.clerk_user_id

  UNION ALL

  SELECT
    j.clerk_user_id,
    0,
    COUNT(*) FILTER (WHERE j.status = 'sent'),
    COUNT(*) FILTER (WHERE j.status IN ('cancelled', 'failed')),
    COUNT(*) FILTER (WHERE NULLIF(BTRIM(j.outbound_message_sid), '') IS NOT NULL),
    COUNT(*) FILTER (WHERE j.status IN ('cancelled', 'failed')),
    COUNT(*) FILTER (WHERE COALESCE(j.last_error, '') ILIKE '%robot%'),
    0, 0, 0
  FROM sms_inbound_coach_jobs j
  CROSS JOIN bounds b
  WHERE j.updated_at >= b.day_start AND j.updated_at < b.day_end
  GROUP BY j.clerk_user_id
),
outbound_agg AS (
  SELECT
    clerk_user_id,
    SUM(outbound_send_rows) AS outbound_send_rows,
    SUM(visible_sent_true) AS visible_sent_true,
    SUM(visible_sent_false) AS visible_sent_false,
    SUM(twilio_attempted_true) AS twilio_attempted_true,
    SUM(no_send_count) AS no_send_count,
    SUM(robot_commitment_pattern_count) AS robot_commitment_pattern_count,
    SUM(daily_stale_block_count) AS daily_stale_block_count,
    SUM(thread_memory_repeat_count) AS thread_memory_repeat_count,
    SUM(thread_freshness_count) AS thread_freshness_count
  FROM outbound
  GROUP BY clerk_user_id
),
all_users AS (
  SELECT clerk_user_id FROM inbound_msgs
  UNION SELECT clerk_user_id FROM inbound_jobs
  UNION SELECT clerk_user_id FROM outbound_agg
),
last_events AS (
  SELECT DISTINCT ON (t.clerk_user_id)
    t.clerk_user_id,
    t.event_at AS last_event_at,
    t.text_preview AS last_text_or_preview,
    t.no_send_reason AS last_no_send_reason,
    t.strategy_card_route_kind AS last_strategy_card_route_kind,
    t.strategy_card_move_type AS last_strategy_card_move_type
  FROM (
    SELECT
      e.clerk_user_id,
      e.created_at AS event_at,
      LEFT(COALESCE(e.metadata->>'sms_body', e.sms_body, ''), 160) AS text_preview,
      COALESCE(
        e.metadata->'daily_v3_lane'->>'no_send_reason',
        e.metadata->>'skip_reason'
      ) AS no_send_reason,
      COALESCE(
        e.metadata->'relationship_packet_observability'->>'strategy_card_route_kind',
        e.metadata->>'strategy_card_route_kind'
      ) AS strategy_card_route_kind,
      COALESCE(
        e.metadata->'relationship_packet_observability'->>'strategy_card_move_type',
        e.metadata->>'strategy_card_move_type'
      ) AS strategy_card_move_type
    FROM sms_send_events e
    CROSS JOIN bounds b
    WHERE e.created_at >= b.day_start AND e.created_at < b.day_end

    UNION ALL

    SELECT
      j.clerk_user_id,
      j.updated_at,
      LEFT(COALESCE(j.reply_body, j.raw_body, ''), 160),
      ev.payload_json->'unified_final_product_law_guard'->>'no_send_reason',
      ev.payload_json->'relationship_packet_observability'->>'strategy_card_route_kind',
      ev.payload_json->'relationship_packet_observability'->>'strategy_card_move_type'
    FROM sms_inbound_coach_jobs j
    CROSS JOIN bounds b
    LEFT JOIN v2_commitment_event ev ON ev.idempotency_key = 'v2_user_reply:' || j.message_sid
    WHERE j.updated_at >= b.day_start AND j.updated_at < b.day_end

    UNION ALL

    SELECT
      m.clerk_user_id,
      COALESCE(m.created_at, now()),
      LEFT(m.raw_body, 160),
      NULL, NULL, NULL
    FROM sms_inbound_messages m
    CROSS JOIN bounds b
    WHERE COALESCE(m.created_at, now()) >= b.day_start
      AND COALESCE(m.created_at, now()) < b.day_end
  ) t
  ORDER BY t.clerk_user_id, t.event_at DESC
)
SELECT
  u.clerk_user_id,
  COALESCE(im.inbound_user_messages, 0) AS inbound_user_messages,
  COALESCE(ij.inbound_coach_jobs, 0) AS inbound_coach_jobs,
  COALESCE(oa.outbound_send_rows, 0) AS outbound_send_rows,
  COALESCE(oa.visible_sent_true, 0) AS visible_sent_true,
  COALESCE(oa.visible_sent_false, 0) AS visible_sent_false,
  COALESCE(oa.twilio_attempted_true, 0) AS twilio_attempted_true,
  COALESCE(oa.no_send_count, 0) AS no_send_count,
  COALESCE(oa.robot_commitment_pattern_count, 0) AS robot_commitment_pattern_count,
  COALESCE(oa.daily_stale_block_count, 0) AS daily_stale_block_count,
  COALESCE(oa.thread_memory_repeat_count, 0) AS thread_memory_repeat_count,
  COALESCE(oa.thread_freshness_count, 0) AS thread_freshness_count,
  le.last_event_at,
  le.last_text_or_preview,
  le.last_no_send_reason,
  le.last_strategy_card_route_kind,
  le.last_strategy_card_move_type
FROM all_users u
LEFT JOIN inbound_msgs im ON im.clerk_user_id = u.clerk_user_id
LEFT JOIN inbound_jobs ij ON ij.clerk_user_id = u.clerk_user_id
LEFT JOIN outbound_agg oa ON oa.clerk_user_id = u.clerk_user_id
LEFT JOIN last_events le ON le.clerk_user_id = u.clerk_user_id
ORDER BY COALESCE(oa.no_send_count, 0) DESC, le.last_event_at DESC NULLS LAST;


-- =============================================================================
-- QUERY 7 — state_sensitive_routes (optional deep-dive)
-- Contract / pending / refresh / guided-shrink routes with truth metadata.
-- Tells us: stateful route health and missing verbatim anchors.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS day_start,
    timestamptz '2026-06-12 00:00:00 America/New_York' AS day_end
),
state_rows AS (
  SELECT
    e.created_at AS event_at,
    e.clerk_user_id,
    'sms_send_events'::text AS source_table,
    COALESCE(
      e.metadata->'daily_v3_lane'->>'route_kind',
      e.metadata->'relationship_packet_observability'->>'strategy_card_route_kind'
    ) AS route,
    COALESCE(
      e.metadata->'daily_v3_lane'->>'required_verbatim_missing',
      e.metadata->'relationship_packet_observability'->>'required_verbatim_missing',
      e.metadata->'unified_final_product_law_guard'->>'required_verbatim_missing'
    ) AS required_verbatim_missing,
    COALESCE(
      e.metadata->'daily_v3_lane'->>'v2_contract_proposal_kind',
      e.metadata->'relationship_packet_observability'->>'strategy_card_daily_contract_proposal_kind',
      e.metadata->'voice_send_decision'->>'v2_contract_proposal_kind'
    ) AS contract_proposal_kind,
    COALESCE(
      e.metadata->'daily_v3_lane'->>'pending_resolution_kind',
      e.metadata->'relationship_packet_observability'->>'strategy_card_daily_pending_resolution_kind',
      e.metadata->'voice_send_decision'->>'pending_resolution_kind'
    ) AS pending_kind,
    COALESCE(
      e.metadata->'daily_v3_lane'->>'refresh_step',
      e.metadata->'relationship_packet_observability'->>'strategy_card_daily_refresh_step'
    ) AS refresh_step,
    COALESCE(
      e.metadata->'daily_v3_lane'->>'truth_recheck_reason',
      e.metadata->'relationship_packet_observability'->>'truth_recheck_reason',
      e.metadata->'unified_final_product_law_guard'->>'truth_recheck_reason'
    ) AS truth_recheck_reason,
    jsonb_build_object(
      'proposal_state_written_before_sms', e.metadata->'voice_send_decision'->>'proposal_state_written_before_sms',
      'pending_state_written_before_sms', e.metadata->'voice_send_decision'->>'pending_state_written_before_sms',
      'pending_candidate_fingerprint', COALESCE(
        e.metadata->'daily_v3_lane'->>'pending_candidate_fingerprint',
        e.metadata->'relationship_packet_observability'->>'strategy_card_daily_pending_candidate_fingerprint'
      ),
      'refresh_required_anchor_fingerprint', e.metadata->'relationship_packet_observability'->>'strategy_card_daily_refresh_required_anchor_fingerprint'
    ) AS candidate_proposal_fingerprint_meta,
    COALESCE(
      e.metadata->'daily_v3_lane'->>'no_send_reason',
      e.metadata->'unified_final_product_law_guard'->>'no_send_reason',
      e.metadata->>'skip_reason'
    ) AS no_send_reason,
    to_jsonb(e) AS raw_json
  FROM sms_send_events e
  CROSS JOIN bounds b
  WHERE e.created_at >= b.day_start AND e.created_at < b.day_end
    AND COALESCE(
      e.metadata->'daily_v3_lane'->>'route_kind',
      e.metadata->'relationship_packet_observability'->>'strategy_card_route_kind',
      ''
    ) IN (
      'contract_prompt',
      'pending_resolution',
      'refresh_identity',
      'refresh_commitment',
      'guided_shrink_contract_prompt',
      'guided_contract_proposal'
    )

  UNION ALL

  SELECT
    j.updated_at,
    j.clerk_user_id,
    'sms_inbound_coach_jobs',
    COALESCE(
      ev.payload_json->>'route_purpose',
      ev.payload_json->'relationship_packet_observability'->>'strategy_card_route_kind'
    ),
    ev.payload_json->'unified_final_product_law_guard'->>'required_verbatim_missing',
    ev.payload_json->>'v2_contract_proposal_kind',
    ev.payload_json->>'pending_resolution_kind',
    ev.payload_json->>'refresh_step',
    ev.payload_json->>'truth_recheck_reason',
    jsonb_build_object(
      'pending_candidate_fingerprint', ev.payload_json->'relationship_packet_observability'->>'strategy_card_daily_pending_candidate_fingerprint'
    ),
    COALESCE(
      ev.payload_json->'unified_final_product_law_guard'->>'no_send_reason',
      ev.payload_json->'inbound_v3_lane'->>'no_send_reason'
    ),
    jsonb_build_object('job', to_jsonb(j), 'event', to_jsonb(ev))
  FROM sms_inbound_coach_jobs j
  CROSS JOIN bounds b
  LEFT JOIN v2_commitment_event ev ON ev.idempotency_key = 'v2_user_reply:' || j.message_sid
  WHERE j.updated_at >= b.day_start AND j.updated_at < b.day_end
    AND COALESCE(
      ev.payload_json->>'route_purpose',
      ev.payload_json->'relationship_packet_observability'->>'strategy_card_route_kind',
      ''
    ) IN (
      'contract_prompt',
      'pending_resolution',
      'refresh_identity',
      'refresh_commitment',
      'guided_shrink_contract_prompt',
      'guided_contract_proposal',
      'adaptive_proposal_consent_clarification'
    )
)
SELECT *
FROM state_rows
ORDER BY event_at DESC;


-- =============================================================================
-- QUERY 8 — repair_helper_diagnostics (optional deep-dive)
-- Repair/stale/memory/thread-freshness/post-validate helper outcomes.
-- Tells us: which repair helpers fired and whether they succeeded.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS day_start,
    timestamptz '2026-06-12 00:00:00 America/New_York' AS day_end
),
target_reasons AS (
  SELECT unnest(ARRAY[
    'daily_lane_stale_ask_blocked',
    'daily_stale_ask_blocked',
    'daily_post_fvg_stale_ask_blocked',
    'thread_memory_repeat_blocked',
    'daily_thread_memory_repeat_guard_failed',
    'thread_freshness_stale_blocked',
    'lane_post_validate_blocked',
    'skipped_no_safe_v3_voice'
  ]::text[]) AS reason_key
),
repair_rows AS (
  SELECT
    e.created_at AS event_at,
    e.clerk_user_id,
    'sms_send_events'::text AS source_table,
    COALESCE(
      e.metadata->'daily_v3_lane'->>'no_send_reason',
      e.metadata->'relationship_packet_observability'->>'no_send_reason',
      e.metadata->>'skip_reason',
      e.status
    ) AS no_send_reason,
    COALESCE(
      (e.metadata->'final_voice_gate'->>'v3_repair_attempted')::boolean,
      (e.metadata->'daily_v3_lane'->>'daily_stale_ask_repair_attempted')::boolean,
      (e.metadata->'relationship_packet_observability'->>'repair_snapshot_repair_attempted')::boolean,
      (e.metadata->'daily_v3_lane'->>'lane_post_validate_repair_attempt_count') IS NOT NULL
    ) AS repair_attempted,
    COALESCE(
      (e.metadata->'final_voice_gate'->>'v3_repair_succeeded')::boolean,
      (e.metadata->'daily_v3_lane'->>'daily_stale_ask_repair_succeeded')::boolean,
      (e.metadata->'relationship_packet_observability'->>'repair_snapshot_repair_succeeded')::boolean,
      (e.metadata->'daily_v3_lane'->>'lane_post_validate_second_repair_succeeded')::boolean
    ) AS repair_succeeded,
    COALESCE(
      e.metadata->'daily_v3_lane'->>'lane_post_validate_repair_failed_reason',
      e.metadata->'relationship_packet_observability'->>'repeat_repair_failed_reason',
      e.metadata->'final_voice_gate'->>'skip_reason'
    ) AS repair_failed_reason,
    COALESCE(
      e.metadata->'relationship_packet_observability'->>'repair_snapshot_kind',
      e.metadata->'daily_v3_lane'->>'repair_snapshot_kind',
      e.metadata->'final_voice_gate'->>'final_voice_source',
      e.metadata->>'skip_source'
    ) AS helper_source,
    LEFT(COALESCE(
      e.metadata->>'sms_body',
      e.metadata->'daily_v3_lane'->>'memory_repeat_repaired_body_preview',
      e.metadata->'relationship_packet_observability'->>'memory_repeat_repaired_body_preview',
      e.sms_body,
      ''
    ), 240) AS body_preview,
    to_jsonb(e) AS raw_json
  FROM sms_send_events e
  CROSS JOIN bounds b
  WHERE e.created_at >= b.day_start AND e.created_at < b.day_end
    AND (
      e.status = 'skipped_no_safe_v3_voice'
      OR COALESCE(
        e.metadata->'daily_v3_lane'->>'no_send_reason',
        e.metadata->'relationship_packet_observability'->>'no_send_reason',
        e.metadata->>'skip_reason',
        ''
      ) IN (SELECT reason_key FROM target_reasons)
      OR COALESCE(
        e.metadata->'daily_v3_lane'->>'lane_stage',
        e.metadata->'relationship_packet_observability'->>'lane_stage',
        ''
      ) ILIKE '%post_validate%'
      OR (e.metadata->'final_voice_gate'->>'v3_repair_attempted')::boolean IS TRUE
    )

  UNION ALL

  SELECT
    j.updated_at,
    j.clerk_user_id,
    'sms_inbound_coach_jobs',
    COALESCE(
      ev.payload_json->'inbound_v3_lane'->>'no_send_reason',
      ev.payload_json->'relationship_packet_observability'->>'no_send_reason',
      ev.payload_json->'final_voice_gate'->>'skip_reason'
    ),
    COALESCE(
      (ev.payload_json->'final_voice_gate'->>'v3_repair_attempted')::boolean,
      (ev.payload_json->'relationship_packet_observability'->>'repair_snapshot_repair_attempted')::boolean
    ),
    COALESCE(
      (ev.payload_json->'final_voice_gate'->>'v3_repair_succeeded')::boolean,
      (ev.payload_json->'relationship_packet_observability'->>'repair_snapshot_repair_succeeded')::boolean
    ),
    COALESCE(
      ev.payload_json->'inbound_v3_lane'->>'lane_post_validate_repair_failed_reason',
      ev.payload_json->'relationship_packet_observability'->>'repeat_repair_failed_reason'
    ),
    COALESCE(
      ev.payload_json->'relationship_packet_observability'->>'repair_snapshot_kind',
      ev.payload_json->'final_voice_gate'->>'final_voice_source'
    ),
    LEFT(COALESCE(j.reply_body, j.raw_body, ''), 240),
    jsonb_build_object('job', to_jsonb(j), 'event', to_jsonb(ev))
  FROM sms_inbound_coach_jobs j
  CROSS JOIN bounds b
  LEFT JOIN v2_commitment_event ev ON ev.idempotency_key = 'v2_user_reply:' || j.message_sid
  WHERE j.updated_at >= b.day_start AND j.updated_at < b.day_end
    AND (
      (ev.payload_json->'final_voice_gate'->>'v3_repair_attempted')::boolean IS TRUE
      OR COALESCE(
        ev.payload_json->'inbound_v3_lane'->>'no_send_reason',
        ev.payload_json->'relationship_packet_observability'->>'no_send_reason',
        ''
      ) IN (SELECT reason_key FROM target_reasons)
    )
)
SELECT *
FROM repair_rows
ORDER BY event_at DESC;


-- =============================================================================
-- QUERY 9 — suspected_false_outcome_events (optional deep-dive)
-- Possible bad user_yes / user_no / user_partial persistence vs inbound text.
-- Tells us: outcome writes that may not match what the user actually meant.
-- READ-ONLY heuristics — review before any code change.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS day_start,
    timestamptz '2026-06-12 00:00:00 America/New_York' AS day_end
),
outcomes AS (
  SELECT
    ev.id,
    ev.occurred_at,
    ev.clerk_user_id,
    ev.event_type,
    ev.payload_json,
    COALESCE(
      ev.payload_json->'inbound_meaning'->>'persistence_decision',
      ev.payload_json->'ai'->'inbound_meaning'->>'persistence_decision',
      ev.payload_json->>'persistence_decision'
    ) AS persistence_decision,
    COALESCE(
      ev.payload_json->>'message_sid',
      ev.payload_json->'ai'->>'inbound_message_sid',
      split_part(ev.idempotency_key, ':', 2)
    ) AS inbound_message_sid
  FROM v2_commitment_event ev
  CROSS JOIN bounds b
  WHERE ev.occurred_at >= b.day_start
    AND ev.occurred_at < b.day_end
    AND ev.event_type IN ('user_yes', 'user_no', 'user_partial')
),
paired AS (
  SELECT
    o.*,
    LEFT(COALESCE(m.raw_body, j.raw_body, o.payload_json->>'message', ''), 240) AS raw_inbound_body,
    prior.body_preview AS prior_check_sent_body,
    prior.occurred_at AS prior_check_sent_at,
    prior.route_or_purpose AS prior_route_or_prompt_kind,
    CASE
      WHEN o.event_type = 'user_yes'
        AND COALESCE(m.raw_body, j.raw_body, '') ~* '(tomorrow|next week|later|when i|maybe|probably|plan to|going to|will try)'
        THEN 'yes_to_future_or_proposal'
      WHEN o.event_type = 'user_no'
        AND COALESCE(m.raw_body, j.raw_body, '') ~* '(tomorrow|next week|later|when i|plan to|going to|will try|proposal|contract)'
        THEN 'no_to_future_or_proposal'
      WHEN o.event_type = 'user_partial'
        AND COALESCE(m.raw_body, j.raw_body, '') ~* '(yes|yep|100%|done|completed)'
        AND COALESCE(o.payload_json->>'route_purpose', o.payload_json->'ai'->>'route_purpose', '')
          ~* '(contract|proposal|pending|refresh)'
        THEN 'maybe_to_proposal'
      WHEN o.event_type IN ('user_yes', 'user_no', 'user_partial')
        AND COALESCE(m.raw_body, j.raw_body, '') ~* '(at [0-9]|:[0-9]{2}|am|pm|morning|afternoon|evening|schedule|calendar)'
        AND prior.body_preview ~* '(when|time|schedule|check.?in)'
        THEN 'detail_answer_to_scheduling'
      ELSE NULL
    END AS suspect_reason
  FROM outcomes o
  LEFT JOIN sms_inbound_messages m ON m.message_sid = o.inbound_message_sid
  LEFT JOIN sms_inbound_coach_jobs j ON j.message_sid = o.inbound_message_sid
  LEFT JOIN LATERAL (
    SELECT
      p.occurred_at,
      LEFT(COALESCE(
        p.payload_json->>'sms_body',
        p.payload_json->'ai'->>'sms_body_preview',
        ''
      ), 240) AS body_preview,
      COALESCE(
        p.payload_json->'ai'->>'daily_message_purpose',
        p.payload_json->>'route_purpose'
      ) AS route_or_purpose
    FROM v2_commitment_event p
    WHERE p.clerk_user_id = o.clerk_user_id
      AND p.event_type = 'check_sent'
      AND p.occurred_at <= o.occurred_at
      AND p.occurred_at >= o.occurred_at - interval '36 hours'
    ORDER BY p.occurred_at DESC
    LIMIT 1
  ) prior ON TRUE
)
SELECT
  occurred_at,
  clerk_user_id,
  event_type,
  inbound_message_sid,
  raw_inbound_body,
  persistence_decision,
  prior_check_sent_at,
  prior_check_sent_body,
  prior_route_or_prompt_kind,
  suspect_reason,
  payload_json AS raw_json
FROM paired
WHERE suspect_reason IS NOT NULL
ORDER BY occurred_at DESC;


-- =============================================================================
-- QUERY 10 — packet_strategy_context_health (optional deep-dive)
-- Relationship packet / strategy context fields across lanes.
-- Tells us: truncation, thread inclusion, proof permissions, packet strip health.
-- =============================================================================

WITH bounds AS (
  SELECT
    timestamptz '2026-06-11 00:00:00 America/New_York' AS day_start,
    timestamptz '2026-06-12 00:00:00 America/New_York' AS day_end
),
packet_rows AS (
  SELECT
    e.created_at AS event_at,
    e.clerk_user_id,
    'daily'::text AS lane,
    e.status,
    e.metadata AS meta
  FROM sms_send_events e
  CROSS JOIN bounds b
  WHERE e.created_at >= b.day_start AND e.created_at < b.day_end

  UNION ALL

  SELECT
    w.created_at,
    w.clerk_user_id,
    'weekly',
    w.status,
    w.metadata
  FROM sms_weekly_send_events w
  CROSS JOIN bounds b
  WHERE w.created_at >= b.day_start AND w.created_at < b.day_end

  UNION ALL

  SELECT
    j.updated_at,
    j.clerk_user_id,
    'inbound',
    j.status,
    COALESCE(ev.payload_json, '{}'::jsonb)
  FROM sms_inbound_coach_jobs j
  CROSS JOIN bounds b
  LEFT JOIN v2_commitment_event ev ON ev.idempotency_key = 'v2_user_reply:' || j.message_sid
  WHERE j.updated_at >= b.day_start AND j.updated_at < b.day_end
)
SELECT
  event_at,
  clerk_user_id,
  lane,
  status,
  COALESCE(
    meta->'relationship_packet_observability'->>'relationship_packet_version',
    meta->'daily_v3_lane'->>'relationship_packet_version',
    meta->'weekly_lane_metadata'->>'relationship_packet_version',
    meta->'inbound_v3_lane'->>'relationship_packet_version'
  ) AS relationship_packet_version,
  COALESCE(
    meta->'relationship_packet_observability'->>'relationship_packet_truncated',
    meta->'daily_v3_lane'->>'relationship_packet_truncated',
    meta->'weekly_lane_metadata'->>'relationship_packet_truncated'
  ) AS relationship_packet_truncated,
  COALESCE(
    meta->'relationship_packet_observability'->'truncated_sections',
    meta->'daily_v3_lane'->'truncated_sections',
    meta->'weekly_lane_metadata'->'truncated_sections'
  ) AS truncated_sections,
  COALESCE(
    (meta->'relationship_packet_observability'->>'included_thread_message_count')::int,
    (meta->'daily_v3_lane'->>'included_thread_message_count')::int,
    (meta->'weekly_lane_metadata'->>'included_thread_message_count')::int
  ) AS included_thread_message_count,
  COALESCE(
    (meta->'relationship_packet_observability'->>'do_not_repeat_ask_count')::int,
    (meta->'daily_v3_lane'->>'do_not_repeat_asks_count')::int,
    (meta->'voice_send_decision'->>'do_not_repeat_asks_count')::int
  ) AS do_not_repeat_ask_count,
  COALESCE(
    (meta->'relationship_packet_observability'->>'open_loop_count')::int,
    (meta->'daily_v3_lane'->>'open_loop_count')::int
  ) AS open_loop_count,
  COALESCE(
    meta->'relationship_packet_observability'->>'active_pending_state_source',
    meta->'daily_v3_lane'->>'active_pending_state_source'
  ) AS active_pending_state_source,
  COALESCE(
    meta->'relationship_packet_observability'->>'strategy_card_packet_writer_hints_stripped',
    meta->>'strategy_card_packet_writer_hints_stripped'
  ) AS strategy_card_packet_writer_hints_stripped,
  COALESCE(
    meta->'relationship_packet_observability'->'strategy_card_packet_stripped_fields',
    meta->'strategy_card_packet_stripped_fields'
  ) AS packet_stripped_fields,
  jsonb_build_object(
    'proof_permission_emitted', meta->'relationship_packet_observability'->>'proof_permission_emitted',
    'can_claim_proof', COALESCE(
      meta->'relationship_packet_observability'->>'can_claim_proof',
      meta->'relationship_packet_observability'->>'strategy_card_can_claim_proof'
    ),
    'can_reference_victory_room', COALESCE(
      meta->'relationship_packet_observability'->>'can_reference_victory_room',
      meta->'relationship_packet_observability'->>'strategy_card_can_reference_victory_room'
    ),
    'proof_evidence_count', meta->'relationship_packet_observability'->>'proof_evidence_count',
    'proof_permission_sources', meta->'relationship_packet_observability'->'proof_permission_sources'
  ) AS proof_permission_fields,
  meta AS raw_json
FROM packet_rows
ORDER BY event_at DESC;
