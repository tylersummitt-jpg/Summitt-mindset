-- =============================================================================
-- VICTORY ROOM ↔ SMS BRIDGE DEBUG PACK v1 (read-only)
-- =============================================================================
-- Run in Supabase SQL editor. SELECT-only — does not mutate data.
--
-- Purpose: prove the SMS ↔ Victory Room bridge during soak/tuning.
-- Companion to sms_soak_debug_pack.sql (lane health) — this pack focuses on:
--   proof spine rows, displayability, goal/overlay mismatch, proof language,
--   false proof claims, no-send proof, identity/goal edits, privacy anchors.
--
-- DATE: change day_start / day_end in each query's bounds CTE (America/New_York).
--
-- Victory Room loader (code reference — not in DB):
--   - Reads v2_commitment_event.payload_json proof_moment* (no separate table)
--   - Victory Room TopCard shows v2_commitment.behavior_statement (NOT effective ask)
--   - effective ask = adaptive_ask_text when overlay active, else behavior_statement
--
-- Privacy: Query 9 omits person display names by default (counts only).
-- =============================================================================


-- =============================================================================
-- QUERY 1 — sms_outcome_to_proof_moment_map
-- Every spine event that could represent proof (or adjacent non-proof events).
-- Tells us: what SMS/spine events write proof, and what kind?
-- =============================================================================

WITH bounds AS (
  SELECT
    ('2026-06-13 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_start,
    ('2026-06-15 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_end
),
spine AS (
  SELECT
    ev.occurred_at AS event_at,
    ev.clerk_user_id,
    ev.commitment_id,
    ev.event_type,
    ev.id AS event_id,
    COALESCE(
      ev.payload_json->>'message_sid',
      ev.payload_json->'ai'->>'inbound_message_sid',
      split_part(ev.idempotency_key, ':', 2)
    ) AS message_sid,
    LEFT(COALESCE(
      m.raw_body,
      j.raw_body,
      ev.payload_json->>'message',
      ev.payload_json->>'message_preview',
      ''
    ), 240) AS raw_inbound_body_preview,
    COALESCE(
      ev.payload_json->'inbound_meaning'->>'persistence_decision',
      ev.payload_json->'ai'->'inbound_meaning'->>'persistence_decision',
      ev.payload_json->>'persistence_decision'
    ) AS persistence_decision,
    COALESCE((ev.payload_json->>'proof_moment')::boolean, false) AS proof_moment,
    ev.payload_json->>'proof_moment_type' AS proof_moment_type,
    LEFT(COALESCE(
      ev.payload_json->>'proof_meaning_line',
      ev.payload_json->>'user_visible_proof_line',
      ''
    ), 220) AS user_visible_proof_line,
    ev.payload_json->>'proof_moment_reason' AS proof_moment_reason,
    ev.payload_json->>'proof_weight' AS proof_weight,
    COALESCE(
      ev.payload_json->>'route_purpose',
      ev.payload_json->'ai'->>'daily_message_purpose',
      ev.payload_json->>'source',
      ev.event_type
    ) AS route_or_source,
    CASE
      WHEN ev.event_type = 'check_sent'
        AND COALESCE((ev.payload_json->>'proof_moment')::boolean, false) IS NOT TRUE
        THEN 'not_proof_check_sent'
      WHEN COALESCE((ev.payload_json->>'proof_moment')::boolean, false) IS TRUE
        THEN 'proof_moment_true'
      WHEN ev.event_type IN (
        'user_yes', 'user_no', 'user_partial',
        'blocker_captured', 'sms_memory_signal',
        'contract_overlay_activated', 'contract_overlay_proposed',
        'contract_overlay_declined', 'coaching_refresh_resolved'
      ) THEN 'spine_adjacent_no_proof_flag'
      ELSE 'other_spine'
    END AS proof_map_category,
    COALESCE(
      (ev.payload_json->>'visible_sent')::boolean,
      (j.status = 'sent' AND NULLIF(BTRIM(j.outbound_message_sid), '') IS NOT NULL),
      false
    ) AS linked_visible_sent,
    COALESCE(
      (ev.payload_json->>'twilio_send_attempted')::boolean,
      NULLIF(BTRIM(j.outbound_message_sid), '') IS NOT NULL,
      false
    ) AS linked_twilio_send_attempted,
    j.status AS inbound_job_status,
    LEFT(COALESCE(j.reply_body, it.tel->>'reply_body_preview', ''), 240) AS linked_outbound_body_preview,
    COALESCE(
      it.tel->>'no_send_reason',
      it.tel->>'unified_final_guard_no_send_reason',
      ev.payload_json->>'no_send_reason'
    ) AS linked_no_send_reason,
    to_jsonb(ev) AS raw_event_json
  FROM v2_commitment_event ev
  CROSS JOIN bounds b
  LEFT JOIN sms_inbound_messages m
    ON m.message_sid = COALESCE(
      ev.payload_json->>'message_sid',
      ev.payload_json->'ai'->>'inbound_message_sid',
      split_part(ev.idempotency_key, ':', 2)
    )
  LEFT JOIN sms_inbound_coach_jobs j
    ON j.message_sid = COALESCE(
      ev.payload_json->>'message_sid',
      ev.payload_json->'ai'->>'inbound_message_sid',
      split_part(ev.idempotency_key, ':', 2)
    )
  LEFT JOIN LATERAL (
    SELECT ev2.payload_json AS tel
    FROM v2_commitment_event ev2
    WHERE ev2.event_type = 'sms_memory_signal'
      AND ev2.payload_json->>'inbound_turn_telemetry' = 'true'
      AND ev2.payload_json->>'message_sid' = COALESCE(
        ev.payload_json->>'message_sid',
        ev.payload_json->'ai'->>'inbound_message_sid',
        split_part(ev.idempotency_key, ':', 2)
      )
    ORDER BY ev2.occurred_at DESC
    LIMIT 1
  ) it ON TRUE
  WHERE ev.occurred_at >= b.day_start
    AND ev.occurred_at < b.day_end
    AND (
      COALESCE((ev.payload_json->>'proof_moment')::boolean, false) IS TRUE
      OR ev.event_type IN (
        'user_yes', 'user_no', 'user_partial',
        'sms_memory_signal', 'blocker_captured',
        'contract_overlay_proposed', 'contract_overlay_activated',
        'contract_overlay_declined', 'coaching_refresh_resolved',
        'check_sent'
      )
    )
)
SELECT *
FROM spine
ORDER BY event_at DESC, clerk_user_id;


-- =============================================================================
-- QUERY 2 — proof_moments_displayability_candidates
-- proof_moment=true rows and Victory Room displayability heuristics.
-- Tells us: which proof rows are good display candidates vs malformed?
-- =============================================================================

WITH bounds AS (
  SELECT
    ('2026-06-13 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_start,
    ('2026-06-15 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_end
),
proof_rows AS (
  SELECT
    ev.occurred_at AS event_at,
    ev.clerk_user_id,
    ev.commitment_id,
    ev.event_type,
    ev.id AS event_id,
    ev.payload_json->>'proof_moment_type' AS proof_moment_type,
    LEFT(COALESCE(
      ev.payload_json->>'proof_meaning_line',
      ev.payload_json->>'user_visible_proof_line',
      ''
    ), 220) AS user_visible_proof_line,
    COALESCE(
      ev.payload_json->>'proof_moment_reason',
      ev.payload_json->>'proof_weight'
    ) AS proof_category_hint,
    LEFT(COALESCE(
      m.raw_body,
      j.raw_body,
      ev.payload_json->>'message',
      ev.payload_json->>'message_preview',
      ''
    ), 240) AS raw_body_preview,
    COALESCE((ev.payload_json->>'proof_moment')::boolean, false) AS proof_moment,
    (ev.payload_json->>'season_lifecycle')::boolean AS season_lifecycle,
    (ev.payload_json->>'exclude_from_proof_curation')::boolean AS exclude_from_proof_curation,
    COALESCE(
      ev.payload_json->'memory_signal'->>'wave12_commitment_change_proof',
      ev.payload_json->>'wave12_commitment_change_proof'
    ) AS wave12_commitment_change_proof,
    to_jsonb(ev) AS raw_json
  FROM v2_commitment_event ev
  CROSS JOIN bounds b
  LEFT JOIN sms_inbound_messages m
    ON m.message_sid = COALESCE(
      ev.payload_json->>'message_sid',
      ev.payload_json->'ai'->>'inbound_message_sid',
      split_part(ev.idempotency_key, ':', 2)
    )
  LEFT JOIN sms_inbound_coach_jobs j
    ON j.message_sid = COALESCE(
      ev.payload_json->>'message_sid',
      ev.payload_json->'ai'->>'inbound_message_sid',
      split_part(ev.idempotency_key, ':', 2)
    )
  WHERE ev.occurred_at >= b.day_start
    AND ev.occurred_at < b.day_end
    AND COALESCE((ev.payload_json->>'proof_moment')::boolean, false) IS TRUE
)
SELECT
  event_at,
  clerk_user_id,
  commitment_id,
  event_type,
  event_id,
  proof_moment_type,
  user_visible_proof_line,
  proof_category_hint,
  raw_body_preview,
  CASE
    WHEN NULLIF(BTRIM(user_visible_proof_line), '') IS NOT NULL
      THEN 'has_user_visible_line'
    ELSE 'missing_proof_line'
  END AS has_line_flag,
  CASE
    WHEN proof_moment_type IS NULL OR BTRIM(proof_moment_type) = ''
      THEN 'missing_category'
    ELSE NULL
  END AS missing_category_flag,
  CASE
    WHEN event_type NOT IN (
      'user_yes', 'user_no', 'user_partial',
      'blocker_captured', 'sms_memory_signal'
    )
      AND COALESCE(wave12_commitment_change_proof, '') <> 'true'
      THEN 'non_displayable_event_type'
    ELSE NULL
  END AS non_displayable_event_type_flag,
  CASE
    WHEN season_lifecycle IS TRUE OR exclude_from_proof_curation IS TRUE
      THEN 'internal_only'
    ELSE NULL
  END AS internal_only_flag,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN NULLIF(BTRIM(user_visible_proof_line), '') IS NULL THEN 'missing_proof_line' END,
    CASE WHEN proof_moment_type IS NULL OR BTRIM(proof_moment_type) = '' THEN 'missing_category' END,
    CASE
      WHEN event_type NOT IN (
        'user_yes', 'user_no', 'user_partial',
        'blocker_captured', 'sms_memory_signal'
      )
        AND COALESCE(wave12_commitment_change_proof, '') <> 'true'
        THEN 'non_displayable_event_type'
    END,
    CASE
      WHEN season_lifecycle IS TRUE OR exclude_from_proof_curation IS TRUE
        THEN 'internal_only'
    END
  ], NULL) AS missing_fields,
  CASE
    WHEN season_lifecycle IS TRUE OR exclude_from_proof_curation IS TRUE
      THEN 'internal_only'
    WHEN NULLIF(BTRIM(user_visible_proof_line), '') IS NULL
      THEN 'missing_proof_line'
    WHEN event_type NOT IN (
      'user_yes', 'user_no', 'user_partial',
      'blocker_captured', 'sms_memory_signal'
    )
      AND COALESCE(wave12_commitment_change_proof, '') <> 'true'
      THEN 'non_displayable_event_type'
    WHEN proof_moment_type IS NULL OR BTRIM(proof_moment_type) = ''
      THEN 'missing_category'
    ELSE 'displayable_candidate'
  END AS displayability_reason,
  raw_json
FROM proof_rows
ORDER BY event_at DESC, clerk_user_id;


-- =============================================================================
-- QUERY 3 — victory_room_current_goal_vs_sms_effective_ask
-- Shrink overlay / effective ask vs Victory Room canonical goal display.
-- Tells us: is SMS holding a different bar than Victory Room shows?
-- =============================================================================

WITH bounds AS (
  SELECT
    ('2026-06-13 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_start,
    ('2026-06-15 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_end
),
commitment_state AS (
  SELECT
    c.id AS commitment_id,
    c.clerk_user_id,
    c.status AS commitment_status,
    LEFT(BTRIM(c.behavior_statement), 220) AS base_behavior_statement,
    LEFT(BTRIM(c.adaptive_ask_text), 220) AS adaptive_ask_text,
    c.adaptive_ask_active_from,
    c.adaptive_ask_expires_at,
    LEFT(BTRIM(c.adaptive_proposal_text), 220) AS adaptive_proposal_text,
    c.adaptive_proposal_expires_at,
    c.pending_resolution_kind,
    c.pending_resolution_payload,
    CASE
      WHEN NULLIF(BTRIM(c.adaptive_ask_text), '') IS NOT NULL
        AND c.adaptive_ask_expires_at IS NOT NULL
        AND c.adaptive_ask_expires_at > now()
      THEN LEFT(BTRIM(c.adaptive_ask_text), 220)
      ELSE LEFT(BTRIM(c.behavior_statement), 220)
    END AS effective_coaching_ask_sql,
    LEFT(BTRIM(p.identity_anchor_text), 160) AS profile_identity_preview,
    c.updated_at AS commitment_updated_at,
    to_jsonb(c) AS raw_commitment_json
  FROM v2_commitment c
  LEFT JOIN user_profiles p ON p.clerk_user_id = c.clerk_user_id
  WHERE c.status = 'active'
),
sms_context AS (
  SELECT
    e.created_at AS event_at,
    e.clerk_user_id,
    e.commitment_id,
    'daily'::text AS sms_lane,
    COALESCE(
      e.metadata->'relationship_packet_observability'->>'strategy_card_route_kind',
      e.metadata->'daily_v3_lane'->>'route_kind',
      e.metadata->>'strategy_card_route_kind'
    ) AS route_kind,
    COALESCE(
      e.metadata->'relationship_packet_observability'->>'strategy_card_daily_contract_proposal_kind',
      e.metadata->>'strategy_card_daily_contract_proposal_kind'
    ) AS contract_proposal_kind,
    COALESCE(
      e.metadata->'relationship_packet_observability'->>'strategy_card_daily_pending_resolution_kind',
      e.metadata->>'strategy_card_daily_pending_resolution_kind'
    ) AS pending_resolution_kind_meta,
    LEFT(COALESCE(
      e.metadata->'daily_v3_lane'->>'effective_ask',
      e.metadata->'relationship_packet_observability'->>'effective_ask',
      e.metadata->>'effective_ask',
      ''
    ), 220) AS sms_metadata_effective_ask,
    LEFT(COALESCE(
      e.metadata->'daily_v3_lane'->>'behavior_statement',
      e.metadata->>'behavior_statement',
      ''
    ), 220) AS sms_metadata_behavior_statement,
    e.metadata AS raw_meta
  FROM sms_send_events e
  CROSS JOIN bounds b
  WHERE e.created_at >= b.day_start
    AND e.created_at < b.day_end

  UNION ALL

  SELECT
    j.updated_at AS event_at,
    j.clerk_user_id,
    ac.id AS commitment_id,
    'inbound'::text AS sms_lane,
    COALESCE(
      it.tel->>'route_purpose',
      it.tel->'relationship_packet_observability'->>'strategy_card_route_kind'
    ) AS route_kind,
    it.tel->'relationship_packet_observability'->>'strategy_card_daily_contract_proposal_kind' AS contract_proposal_kind,
    it.tel->'relationship_packet_observability'->>'strategy_card_daily_pending_resolution_kind' AS pending_resolution_kind_meta,
    LEFT(COALESCE(it.tel->>'effective_ask', ''), 220) AS sms_metadata_effective_ask,
    LEFT(COALESCE(it.tel->>'behavior_statement', ''), 220) AS sms_metadata_behavior_statement,
    it.tel AS raw_meta
  FROM sms_inbound_coach_jobs j
  CROSS JOIN bounds b
  LEFT JOIN v2_commitment ac
    ON ac.clerk_user_id = j.clerk_user_id AND ac.status = 'active'
  LEFT JOIN LATERAL (
    SELECT ev.payload_json AS tel
    FROM v2_commitment_event ev
    WHERE ev.event_type = 'sms_memory_signal'
      AND ev.payload_json->>'inbound_turn_telemetry' = 'true'
      AND ev.payload_json->>'message_sid' = j.message_sid
    ORDER BY ev.occurred_at DESC
    LIMIT 1
  ) it ON TRUE
  WHERE j.updated_at >= b.day_start
    AND j.updated_at < b.day_end
)
SELECT
  s.event_at,
  s.clerk_user_id,
  s.commitment_id,
  s.sms_lane,
  s.route_kind,
  s.contract_proposal_kind,
  s.pending_resolution_kind_meta,
  cs.base_behavior_statement,
  cs.effective_coaching_ask_sql,
  cs.adaptive_ask_text,
  cs.adaptive_ask_expires_at,
  cs.adaptive_proposal_text,
  cs.adaptive_proposal_expires_at,
  cs.pending_resolution_kind AS commitment_pending_resolution_kind,
  cs.base_behavior_statement AS victory_room_visible_goal,
  NULLIF(s.sms_metadata_effective_ask, '') AS sms_metadata_effective_ask,
  NULLIF(s.sms_metadata_behavior_statement, '') AS sms_metadata_behavior_statement,
  CASE
    WHEN cs.effective_coaching_ask_sql IS DISTINCT FROM cs.base_behavior_statement
      THEN true
    ELSE false
  END AS overlay_active_sql,
  CASE
    WHEN NULLIF(s.sms_metadata_effective_ask, '') IS NOT NULL
      AND NULLIF(s.sms_metadata_effective_ask, '') IS DISTINCT FROM cs.base_behavior_statement
      THEN true
    WHEN cs.effective_coaching_ask_sql IS DISTINCT FROM cs.base_behavior_statement
      THEN true
    ELSE false
  END AS sms_effective_ask_differs_from_victory_goal,
  CASE
    WHEN cs.adaptive_proposal_text IS NOT NULL
      AND cs.adaptive_proposal_expires_at IS NOT NULL
      AND cs.adaptive_proposal_expires_at > now()
      AND cs.effective_coaching_ask_sql IS NOT DISTINCT FROM cs.base_behavior_statement
      THEN true
    ELSE false
  END AS pending_overlay_not_displayed,
  CASE
    WHEN cs.effective_coaching_ask_sql IS DISTINCT FROM cs.base_behavior_statement
      THEN true
    ELSE false
  END AS active_overlay_not_displayed,
  jsonb_build_object(
    'commitment', cs.raw_commitment_json,
    'sms_metadata', s.raw_meta
  ) AS raw_rows
FROM sms_context s
JOIN commitment_state cs ON cs.commitment_id = s.commitment_id
WHERE s.commitment_id IS NOT NULL
  AND (
  cs.effective_coaching_ask_sql IS DISTINCT FROM cs.base_behavior_statement
  OR NULLIF(s.sms_metadata_effective_ask, '') IS DISTINCT FROM cs.base_behavior_statement
  OR s.contract_proposal_kind IS NOT NULL
  OR s.pending_resolution_kind_meta IS NOT NULL
  OR cs.pending_resolution_kind IS NOT NULL
  )
ORDER BY s.event_at DESC, s.clerk_user_id;


-- =============================================================================
-- QUERY 4 — sms_victory_room_language_claims
-- Visible SMS bodies mentioning Victory Room / proof / streak / manual-add language.
-- Tells us: did SMS mention Victory Room/proof in a supported way?
-- =============================================================================

WITH bounds AS (
  SELECT
    ('2026-06-13 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_start,
    ('2026-06-15 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_end
),
sms_bodies AS (
  SELECT
    e.created_at AS event_at,
    e.clerk_user_id,
    'sms_send_events'::text AS source_table,
    'daily'::text AS sms_lane,
    COALESCE(
      e.metadata->'relationship_packet_observability'->>'strategy_card_route_kind',
      e.metadata->'daily_v3_lane'->>'route_kind'
    ) AS route,
    LEFT(COALESCE(
      e.metadata->>'sms_body',
      e.metadata->'voice_send_decision'->>'north_star_visible_body',
      ''
    ), 400) AS body_preview,
    COALESCE(
      (e.metadata->'voice_send_decision'->>'visible_sent')::boolean,
      (
        e.status IN ('sent', 'delivered', 'queued', 'accepted', 'sending')
        OR NULLIF(BTRIM(e.message_sid), '') IS NOT NULL
      )
    ) AS visible_sent,
    COALESCE(
      (e.metadata->'voice_send_decision'->>'twilio_send_attempted')::boolean,
      NULLIF(BTRIM(e.message_sid), '') IS NOT NULL
    ) AS twilio_send_attempted,
    COALESCE(
      (e.metadata->'relationship_packet_observability'->>'can_reference_victory_room')::boolean,
      (e.metadata->'relationship_packet_observability'->>'strategy_card_can_reference_victory_room')::boolean,
      (e.metadata->>'can_reference_victory_room')::boolean
    ) AS can_reference_victory_room,
    COALESCE(
      (e.metadata->'relationship_packet_observability'->>'can_claim_proof')::boolean,
      (e.metadata->'relationship_packet_observability'->>'strategy_card_can_claim_proof')::boolean,
      (e.metadata->>'can_claim_proof')::boolean
    ) AS can_claim_proof,
    e.metadata AS raw_meta
  FROM sms_send_events e
  CROSS JOIN bounds b
  WHERE e.created_at >= b.day_start
    AND e.created_at < b.day_end
    AND COALESCE(
      e.metadata->>'sms_body',
      e.metadata->'voice_send_decision'->>'north_star_visible_body',
      ''
    ) <> ''

  UNION ALL

  SELECT
    j.updated_at AS event_at,
    j.clerk_user_id,
    'sms_inbound_coach_jobs'::text AS source_table,
    'inbound'::text AS sms_lane,
    COALESCE(it.tel->>'route_purpose', 'inbound') AS route,
    LEFT(COALESCE(it.tel->>'reply_body_preview', j.reply_body, ''), 400) AS body_preview,
    (j.status = 'sent' AND NULLIF(BTRIM(j.outbound_message_sid), '') IS NOT NULL) AS visible_sent,
    NULLIF(BTRIM(j.outbound_message_sid), '') IS NOT NULL AS twilio_send_attempted,
    COALESCE(
      (it.tel->>'can_reference_victory_room')::boolean,
      (it.tel->'relationship_packet_observability'->>'can_reference_victory_room')::boolean
    ) AS can_reference_victory_room,
    COALESCE(
      (it.tel->>'can_claim_proof')::boolean,
      (it.tel->'relationship_packet_observability'->>'can_claim_proof')::boolean
    ) AS can_claim_proof,
    COALESCE(it.tel, to_jsonb(j)) AS raw_meta
  FROM sms_inbound_coach_jobs j
  CROSS JOIN bounds b
  LEFT JOIN LATERAL (
    SELECT ev.payload_json AS tel
    FROM v2_commitment_event ev
    WHERE ev.event_type = 'sms_memory_signal'
      AND ev.payload_json->>'inbound_turn_telemetry' = 'true'
      AND ev.payload_json->>'message_sid' = j.message_sid
    ORDER BY ev.occurred_at DESC
    LIMIT 1
  ) it ON TRUE
  WHERE j.updated_at >= b.day_start
    AND j.updated_at < b.day_end
    AND COALESCE(it.tel->>'reply_body_preview', j.reply_body, '') <> ''

  UNION ALL

  SELECT
    w.created_at AS event_at,
    w.clerk_user_id,
    'sms_weekly_send_events'::text AS source_table,
    'weekly'::text AS sms_lane,
    COALESCE(w.metadata->'weekly_lane_metadata'->>'route_kind', 'weekly') AS route,
    LEFT(COALESCE(w.metadata->>'sms_body', ''), 400) AS body_preview,
    w.status IN ('sent', 'delivered', 'queued', 'accepted', 'sending') AS visible_sent,
    NULLIF(BTRIM(w.message_sid), '') IS NOT NULL AS twilio_send_attempted,
    COALESCE(
      (w.metadata->'relationship_packet_observability'->>'can_reference_victory_room')::boolean,
      false
    ) AS can_reference_victory_room,
    COALESCE(
      (w.metadata->'relationship_packet_observability'->>'can_claim_proof')::boolean,
      false
    ) AS can_claim_proof,
    w.metadata AS raw_meta
  FROM sms_weekly_send_events w
  CROSS JOIN bounds b
  WHERE w.created_at >= b.day_start
    AND w.created_at < b.day_end
    AND COALESCE(w.metadata->>'sms_body', '') <> ''
),
matched AS (
  SELECT
    b.*,
    CASE
      WHEN b.body_preview ~* '(add this|adding this|consider adding|may belong)'
        THEN true ELSE false
    END AS hit_manual_add_language,
    CASE
      WHEN b.body_preview ~* '(streak|badge|trophy|scoreboard|\bXP\b|level up)'
        THEN true ELSE false
    END AS hit_streak_language,
    CASE
      WHEN b.body_preview ~* '(saved|saving|logged as proof|saved as proof|i saved|i''m saving)'
        THEN true ELSE false
    END AS hit_saved_claim,
    CASE
      WHEN b.body_preview ~* '(victory\s*room|\bproof\b)'
        THEN true ELSE false
    END AS hit_victory_or_proof,
    CASE
      WHEN b.body_preview ~* '(showed up|told the truth|came back|adjusted wisely|kept the thread alive|finished a chapter)'
        THEN true ELSE false
    END AS hit_category_language
  FROM sms_bodies b
  WHERE b.body_preview ~* (
    'victory\s*room|\bproof\b|saved|saving|add this|adding this|consider adding|may belong|'
    || 'streak|badge|trophy|showed up|told the truth|came back|adjusted wisely|'
    || 'kept the thread alive|finished a chapter|scoreboard|\bXP\b'
  )
),
with_proof AS (
  SELECT
    m.*,
    p.event_at AS linked_proof_event_at,
    p.proof_moment_type AS linked_proof_moment_type,
    p.event_type AS linked_proof_event_type,
    (p.event_id IS NOT NULL) AS proof_moment_linked
  FROM matched m
  LEFT JOIN LATERAL (
    SELECT
      ev.occurred_at AS event_at,
      ev.id AS event_id,
      ev.event_type,
      ev.payload_json->>'proof_moment_type' AS proof_moment_type
    FROM v2_commitment_event ev
    WHERE ev.clerk_user_id = m.clerk_user_id
      AND COALESCE((ev.payload_json->>'proof_moment')::boolean, false) IS TRUE
      AND ev.occurred_at BETWEEN m.event_at - interval '4 hours' AND m.event_at + interval '1 hour'
    ORDER BY ABS(EXTRACT(EPOCH FROM (ev.occurred_at - m.event_at)))
    LIMIT 1
  ) p ON TRUE
)
SELECT
  event_at,
  source_table,
  clerk_user_id,
  sms_lane,
  route,
  body_preview,
  visible_sent,
  twilio_send_attempted,
  proof_moment_linked,
  linked_proof_moment_type,
  linked_proof_event_type,
  can_reference_victory_room,
  can_claim_proof,
  CASE
    WHEN hit_manual_add_language THEN 'possible_manual_add_language'
    WHEN hit_streak_language THEN 'possible_streak_language'
    WHEN hit_saved_claim AND COALESCE(can_reference_victory_room, false) IS NOT TRUE
      THEN 'possible_saved_claim'
    WHEN hit_category_language AND proof_moment_linked
      THEN 'possible_truthful_proof_reference'
    WHEN hit_victory_or_proof AND proof_moment_linked
      AND COALESCE(can_reference_victory_room, false) IS TRUE
      THEN 'possible_truthful_proof_reference'
    ELSE 'needs_manual_review'
  END AS risk_label,
  raw_meta AS raw_json
FROM with_proof
ORDER BY event_at DESC, clerk_user_id;


-- =============================================================================
-- QUERY 5 — sms_proof_claim_without_saved_proof
-- SMS mentions proof/Victory/saved language without nearby proof_moment spine row.
-- Tells us: can SMS claim proof when proof was not saved/displayable?
-- =============================================================================

WITH bounds AS (
  SELECT
    ('2026-06-13 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_start,
    ('2026-06-15 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_end
),
claim_rows AS (
  SELECT
    event_at,
    clerk_user_id,
    source_table,
    sms_lane,
    route,
    body_preview,
    visible_sent,
    can_reference_victory_room,
    can_claim_proof,
    raw_meta
  FROM (
    SELECT
      e.created_at AS event_at,
      e.clerk_user_id,
      'sms_send_events'::text AS source_table,
      'daily'::text AS sms_lane,
      COALESCE(e.metadata->'daily_v3_lane'->>'route_kind', 'daily') AS route,
      LEFT(COALESCE(e.metadata->>'sms_body', ''), 400) AS body_preview,
      true AS visible_sent,
      COALESCE(
        (e.metadata->'relationship_packet_observability'->>'can_reference_victory_room')::boolean,
        false
      ) AS can_reference_victory_room,
      COALESCE(
        (e.metadata->'relationship_packet_observability'->>'can_claim_proof')::boolean,
        false
      ) AS can_claim_proof,
      e.metadata AS raw_meta
    FROM sms_send_events e
    CROSS JOIN bounds b
    WHERE e.created_at >= b.day_start AND e.created_at < b.day_end

    UNION ALL

    SELECT
      j.updated_at,
      j.clerk_user_id,
      'sms_inbound_coach_jobs',
      'inbound',
      COALESCE(it.tel->>'route_purpose', 'inbound'),
      LEFT(COALESCE(it.tel->>'reply_body_preview', j.reply_body, ''), 400),
      (j.status = 'sent'),
      COALESCE((it.tel->>'can_reference_victory_room')::boolean, false),
      COALESCE((it.tel->>'can_claim_proof')::boolean, false),
      COALESCE(it.tel, to_jsonb(j))
    FROM sms_inbound_coach_jobs j
    CROSS JOIN bounds b
    LEFT JOIN LATERAL (
      SELECT ev.payload_json AS tel
      FROM v2_commitment_event ev
      WHERE ev.event_type = 'sms_memory_signal'
        AND ev.payload_json->>'inbound_turn_telemetry' = 'true'
        AND ev.payload_json->>'message_sid' = j.message_sid
      ORDER BY ev.occurred_at DESC
      LIMIT 1
    ) it ON TRUE
    WHERE j.updated_at >= b.day_start AND j.updated_at < b.day_end
  ) u
  WHERE body_preview ~* (
    'victory\s*room|\bproof\b|saved|saving|logged as proof|streak|badge|trophy|'
    || 'add this|may belong|consider adding'
  )
)
SELECT
  c.event_at,
  c.clerk_user_id,
  c.source_table,
  c.sms_lane,
  c.route,
  c.body_preview,
  c.visible_sent,
  c.can_reference_victory_room,
  c.can_claim_proof,
  p.event_at AS closest_proof_event_at,
  p.event_type AS closest_proof_event_type,
  p.proof_moment_type AS closest_proof_moment_type,
  ROUND(EXTRACT(EPOCH FROM (c.event_at - p.event_at)) / 60.0, 1) AS minutes_before_closest_proof,
  CASE
    WHEN p.event_id IS NULL
      THEN 'no_proof_moment_in_window'
    WHEN c.body_preview ~* '(saved|saving|logged)' AND COALESCE(c.can_reference_victory_room, false) IS NOT TRUE
      THEN 'saved_language_without_victory_permission'
    WHEN c.body_preview ~* '(add this|may belong|consider adding)'
      THEN 'manual_add_language'
    WHEN c.body_preview ~* 'victory\s*room' AND COALESCE(c.can_reference_victory_room, false) IS NOT TRUE
      THEN 'victory_room_without_permission'
    WHEN c.body_preview ~* '\bproof\b' AND COALESCE(c.can_claim_proof, false) IS NOT TRUE
      THEN 'proof_claim_without_permission'
    ELSE 'needs_manual_review'
  END AS risk_reason,
  jsonb_build_object('sms', c.raw_meta, 'closest_proof', p.raw_json) AS raw_json
FROM claim_rows c
LEFT JOIN LATERAL (
  SELECT
    ev.occurred_at AS event_at,
    ev.id AS event_id,
    ev.event_type,
    ev.payload_json->>'proof_moment_type' AS proof_moment_type,
    to_jsonb(ev) AS raw_json
  FROM v2_commitment_event ev
  WHERE ev.clerk_user_id = c.clerk_user_id
    AND COALESCE((ev.payload_json->>'proof_moment')::boolean, false) IS TRUE
    AND ev.occurred_at BETWEEN c.event_at - interval '6 hours' AND c.event_at + interval '2 hours'
  ORDER BY ABS(EXTRACT(EPOCH FROM (ev.occurred_at - c.event_at)))
  LIMIT 1
) p ON TRUE
WHERE p.event_id IS NULL
   OR COALESCE(c.can_reference_victory_room, false) IS NOT TRUE
   OR COALESCE(c.can_claim_proof, false) IS NOT TRUE
ORDER BY c.event_at DESC, c.clerk_user_id;


-- =============================================================================
-- QUERY 6 — no_send_wrote_proof_check
-- No-send rows with linked proof_moment=true in same message/user window.
-- Tells us: can no-send still write proof, and is that correct?
-- =============================================================================

WITH bounds AS (
  SELECT
    ('2026-06-13 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_start,
    ('2026-06-15 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_end
),
no_send_rows AS (
  SELECT
    e.created_at AS event_at,
    e.clerk_user_id,
    e.commitment_id,
    'daily'::text AS sms_lane,
    NULL::text AS message_sid,
    COALESCE(
      e.metadata->'relationship_packet_observability'->>'no_send_reason',
      e.metadata->'daily_v3_lane'->>'no_send_reason',
      e.metadata->>'skip_reason',
      e.status
    ) AS no_send_reason,
    false AS visible_sent,
    COALESCE(
      (e.metadata->'voice_send_decision'->>'twilio_send_attempted')::boolean,
      false
    ) AS twilio_send_attempted,
    e.metadata AS raw_meta
  FROM sms_send_events e
  CROSS JOIN bounds b
  WHERE e.created_at >= b.day_start
    AND e.created_at < b.day_end
    AND (
      e.status LIKE 'skipped_%'
      OR COALESCE(e.metadata->'voice_send_decision'->>'should_send', '') = 'false'
      OR COALESCE((e.metadata->'voice_send_decision'->>'visible_sent')::boolean, true) IS FALSE
    )

  UNION ALL

  SELECT
    j.updated_at,
    j.clerk_user_id,
    ac.id AS commitment_id,
    'inbound',
    j.message_sid,
    COALESCE(
      it.tel->>'no_send_reason',
      it.tel->>'unified_final_guard_no_send_reason',
      j.status
    ),
    (j.status = 'sent' AND NULLIF(BTRIM(j.outbound_message_sid), '') IS NOT NULL),
    NULLIF(BTRIM(j.outbound_message_sid), '') IS NOT NULL,
    COALESCE(it.tel, to_jsonb(j))
  FROM sms_inbound_coach_jobs j
  CROSS JOIN bounds b
  LEFT JOIN v2_commitment ac
    ON ac.clerk_user_id = j.clerk_user_id AND ac.status = 'active'
  LEFT JOIN LATERAL (
    SELECT ev.payload_json AS tel
    FROM v2_commitment_event ev
    WHERE ev.event_type = 'sms_memory_signal'
      AND ev.payload_json->>'inbound_turn_telemetry' = 'true'
      AND ev.payload_json->>'message_sid' = j.message_sid
    ORDER BY ev.occurred_at DESC
    LIMIT 1
  ) it ON TRUE
  WHERE j.updated_at >= b.day_start
    AND j.updated_at < b.day_end
    AND (
      j.status <> 'sent'
      OR NULLIF(BTRIM(j.outbound_message_sid), '') IS NULL
      OR COALESCE((it.tel->>'visible_sent')::boolean, false) IS FALSE
    )
)
SELECT
  n.event_at,
  n.clerk_user_id,
  n.commitment_id,
  n.sms_lane,
  n.message_sid,
  n.no_send_reason,
  n.visible_sent,
  n.twilio_send_attempted,
  p.event_at AS linked_proof_event_at,
  p.event_type AS linked_proof_event_type,
  p.proof_moment_type AS linked_proof_moment_type,
  ROUND(EXTRACT(EPOCH FROM (p.event_at - n.event_at)) / 60.0, 1) AS proof_minutes_from_no_send,
  CASE
    WHEN p.event_id IS NULL THEN NULL
    WHEN n.sms_lane = 'inbound'
      AND p.event_type IN ('user_yes', 'user_no', 'user_partial', 'blocker_captured')
      THEN 'correct_if_inbound_truth_before_send'
    WHEN n.sms_lane = 'inbound' AND p.event_type = 'blocker_captured'
      THEN 'correct_if_inbound_truth_before_send'
    WHEN p.event_id IS NOT NULL AND n.visible_sent IS FALSE
      THEN 'suspicious_no_send_generated_proof'
    ELSE 'needs_manual_review'
  END AS classification,
  jsonb_build_object('no_send', n.raw_meta, 'proof', p.raw_json) AS raw_json
FROM no_send_rows n
LEFT JOIN LATERAL (
  SELECT
    ev.occurred_at AS event_at,
    ev.id AS event_id,
    ev.event_type,
    ev.payload_json->>'proof_moment_type' AS proof_moment_type,
    to_jsonb(ev) AS raw_json
  FROM v2_commitment_event ev
  WHERE ev.clerk_user_id = n.clerk_user_id
    AND COALESCE((ev.payload_json->>'proof_moment')::boolean, false) IS TRUE
    AND (
      (n.message_sid IS NOT NULL AND (
        ev.payload_json->>'message_sid' = n.message_sid
        OR ev.payload_json->'ai'->>'inbound_message_sid' = n.message_sid
        OR split_part(ev.idempotency_key, ':', 2) = n.message_sid
      ))
      OR ev.occurred_at BETWEEN n.event_at - interval '30 minutes' AND n.event_at + interval '30 minutes'
    )
  ORDER BY ABS(EXTRACT(EPOCH FROM (ev.occurred_at - n.event_at)))
  LIMIT 1
) p ON TRUE
WHERE p.event_id IS NOT NULL
ORDER BY n.event_at DESC, n.clerk_user_id;


-- =============================================================================
-- QUERY 7 — app_identity_goal_edit_to_sms_context
-- Identity/goal edits and next SMS context pickup.
-- Tells us: if user edits in app/Victory Room, does SMS pick it up?
-- =============================================================================

WITH bounds AS (
  SELECT
    ('2026-06-13 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_start,
    ('2026-06-15 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_end
),
identity_edits AS (
  SELECT
    uiv.created_at AS edit_at,
    uiv.clerk_user_id,
    'identity'::text AS edit_kind,
    LEFT(BTRIM(uiv.identity_anchor_text), 160) AS edited_preview,
    uiv.id AS identity_version_id,
    uiv.version_number,
    to_jsonb(uiv) AS raw_edit_json
  FROM user_identity_version uiv
  CROSS JOIN bounds b
  WHERE uiv.created_at >= b.day_start
    AND uiv.created_at < b.day_end

  UNION ALL

  SELECT
    c.updated_at,
    c.clerk_user_id,
    'goal'::text,
    LEFT(BTRIM(c.behavior_statement), 220),
    NULL,
    NULL,
    to_jsonb(c)
  FROM v2_commitment c
  CROSS JOIN bounds b
  WHERE c.updated_at >= b.day_start
    AND c.updated_at < b.day_end
    AND c.status = 'active'
),
with_next_sms AS (
  SELECT
    e.*,
    ns.next_sms_at,
    ns.next_sms_body_preview,
    ns.next_sms_route,
    ns.next_sms_lane,
    ns.next_profile_identity,
    ns.next_commitment_goal,
    ns.next_effective_ask_sql,
    ns.raw_next_meta
  FROM identity_edits e
  LEFT JOIN LATERAL (
    SELECT
      s.created_at AS next_sms_at,
      LEFT(COALESCE(s.metadata->>'sms_body', ''), 240) AS next_sms_body_preview,
      COALESCE(
        s.metadata->'relationship_packet_observability'->>'strategy_card_route_kind',
        s.metadata->'daily_v3_lane'->>'route_kind'
      ) AS next_sms_route,
      'daily'::text AS next_sms_lane,
      LEFT(BTRIM(p.identity_anchor_text), 160) AS next_profile_identity,
      LEFT(BTRIM(c.behavior_statement), 220) AS next_commitment_goal,
      CASE
        WHEN NULLIF(BTRIM(c.adaptive_ask_text), '') IS NOT NULL
          AND c.adaptive_ask_expires_at IS NOT NULL
          AND c.adaptive_ask_expires_at > s.created_at
        THEN LEFT(BTRIM(c.adaptive_ask_text), 220)
        ELSE LEFT(BTRIM(c.behavior_statement), 220)
      END AS next_effective_ask_sql,
      s.metadata AS raw_next_meta
    FROM sms_send_events s
    LEFT JOIN user_profiles p ON p.clerk_user_id = s.clerk_user_id
    LEFT JOIN v2_commitment c ON c.id = s.commitment_id
    WHERE s.clerk_user_id = e.clerk_user_id
      AND s.created_at > e.edit_at
    ORDER BY s.created_at ASC
    LIMIT 1
  ) ns ON TRUE
)
SELECT
  edit_at,
  clerk_user_id,
  edit_kind,
  edited_preview,
  next_sms_at,
  next_sms_body_preview,
  next_sms_route,
  next_sms_lane,
  next_profile_identity,
  next_commitment_goal,
  next_effective_ask_sql,
  CASE
    WHEN edit_kind = 'identity'
      AND next_sms_at IS NULL THEN 'unknown'
    WHEN edit_kind = 'identity'
      AND next_profile_identity IS NOT NULL
      AND edited_preview IS NOT NULL
      AND next_profile_identity <> edited_preview
      THEN 'sms_used_old_identity'
    WHEN edit_kind = 'goal'
      AND next_sms_at IS NULL THEN 'unknown'
    WHEN edit_kind = 'goal'
      AND next_commitment_goal IS NOT NULL
      AND edited_preview IS NOT NULL
      AND next_commitment_goal <> edited_preview
      THEN 'sms_used_old_goal'
    ELSE NULL
  END AS mismatch_flag,
  jsonb_build_object('edit', raw_edit_json, 'next_sms', raw_next_meta) AS raw_json
FROM with_next_sms
ORDER BY edit_at DESC, clerk_user_id;


-- =============================================================================
-- QUERY 8 — sms_goal_change_to_victory_room_state
-- SMS-initiated shrink/raise/refresh/contract/pending goal changes vs canonical state.
-- Tells us: if SMS changes the bar, does Victory Room reflect it?
-- =============================================================================

WITH bounds AS (
  SELECT
    ('2026-06-13 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_start,
    ('2026-06-15 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_end
),
sms_goal_events AS (
  SELECT
    ev.occurred_at AS event_at,
    ev.clerk_user_id,
    ev.commitment_id,
    ev.event_type,
    ev.id AS event_id,
    COALESCE(
      ev.payload_json->>'contract_kind',
      ev.payload_json->>'proof_moment_type',
      ev.event_type
    ) AS change_kind,
    LEFT(COALESCE(
      ev.payload_json->>'message',
      ev.payload_json->>'message_preview',
      ''
    ), 240) AS sms_preview,
    to_jsonb(ev) AS raw_event_json
  FROM v2_commitment_event ev
  CROSS JOIN bounds b
  WHERE ev.occurred_at >= b.day_start
    AND ev.occurred_at < b.day_end
    AND (
      ev.event_type IN (
        'contract_overlay_proposed',
        'contract_overlay_activated',
        'contract_overlay_declined',
        'coaching_refresh_resolved'
      )
      OR (
        ev.event_type = 'sms_memory_signal'
        AND COALESCE(
          ev.payload_json->'memory_signal'->>'wave12_commitment_change_proof',
          ev.payload_json->>'wave12_commitment_change_proof'
        ) = 'true'
      )
      OR COALESCE((ev.payload_json->>'proof_moment')::boolean, false) IS TRUE
        AND ev.payload_json->>'proof_moment_type' IN (
          'commitment_tightened', 'commitment_replaced'
        )
    )
),
state_after AS (
  SELECT
    g.*,
    LEFT(BTRIM(c.behavior_statement), 220) AS canonical_base_goal,
    LEFT(BTRIM(c.adaptive_ask_text), 220) AS canonical_overlay_ask,
    c.adaptive_ask_expires_at,
    c.pending_resolution_kind,
    CASE
      WHEN NULLIF(BTRIM(c.adaptive_ask_text), '') IS NOT NULL
        AND c.adaptive_ask_expires_at IS NOT NULL
        AND c.adaptive_ask_expires_at > g.event_at
      THEN LEFT(BTRIM(c.adaptive_ask_text), 220)
      ELSE LEFT(BTRIM(c.behavior_statement), 220)
    END AS effective_ask_after_event_sql,
    LEFT(BTRIM(c.behavior_statement), 220) AS victory_room_visible_goal,
    to_jsonb(c) AS raw_commitment_json
  FROM sms_goal_events g
  JOIN v2_commitment c ON c.id = g.commitment_id
)
SELECT
  event_at,
  clerk_user_id,
  commitment_id,
  event_type,
  change_kind,
  sms_preview,
  canonical_base_goal,
  canonical_overlay_ask,
  adaptive_ask_expires_at,
  pending_resolution_kind,
  effective_ask_after_event_sql,
  victory_room_visible_goal,
  CASE
    WHEN change_kind IN ('commitment_tightened', 'shrink_ask')
      AND effective_ask_after_event_sql IS DISTINCT FROM victory_room_visible_goal
      THEN 'shrink_overlay_active_vr_shows_base_only'
    WHEN change_kind = 'commitment_replaced'
      AND effective_ask_after_event_sql IS DISTINCT FROM victory_room_visible_goal
      THEN 'replace_not_reflected_in_vr_goal'
    WHEN event_type = 'contract_overlay_proposed'
      AND effective_ask_after_event_sql IS NOT DISTINCT FROM victory_room_visible_goal
      THEN 'proposal_pending_vr_unchanged_expected'
    ELSE NULL
  END AS mismatch_flag,
  jsonb_build_object('event', raw_event_json, 'commitment', raw_commitment_json) AS raw_json
FROM state_after
ORDER BY event_at DESC, clerk_user_id;


-- =============================================================================
-- QUERY 9 — important_people_privacy_bridge
-- Counts only — no display_name selected (privacy default).
-- Tells us: are important people used safely in SMS anchors?
-- =============================================================================

WITH bounds AS (
  SELECT
    ('2026-06-13 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_start,
    ('2026-06-15 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_end
),
people_counts AS (
  SELECT
    ip.clerk_user_id,
    COUNT(*) FILTER (WHERE ip.is_active IS TRUE AND ip.removed_at IS NULL) AS active_people_count,
    COUNT(*) FILTER (
      WHERE ip.is_active IS TRUE AND ip.removed_at IS NULL AND ip.is_private IS TRUE
    ) AS private_active_count,
    COUNT(*) FILTER (WHERE ip.removed_at IS NOT NULL OR ip.is_active IS FALSE) AS removed_or_inactive_count,
    MAX(ip.updated_at) AS last_people_update_at
  FROM important_people ip
  GROUP BY ip.clerk_user_id
),
sms_anchor_meta AS (
  SELECT
    e.clerk_user_id,
    e.created_at AS event_at,
    COALESCE(
      (e.metadata->'relationship_packet_observability'->>'relationship_anchor_available_count')::int,
      (e.metadata->'daily_v3_lane'->>'relationship_anchor_available_count')::int,
      0
    ) AS relationship_anchor_available_count,
    COALESCE(
      e.metadata->'relationship_packet_observability'->>'strategy_card_daily_conversation_intent',
      e.metadata->>'strategy_card_daily_conversation_intent'
    ) AS daily_conversation_intent,
    e.metadata AS raw_meta
  FROM sms_send_events e
  CROSS JOIN bounds b
  WHERE e.created_at >= b.day_start
    AND e.created_at < b.day_end
)
SELECT
  s.event_at,
  s.clerk_user_id,
  COALESCE(p.active_people_count, 0) AS active_people_count,
  COALESCE(p.private_active_count, 0) AS private_active_count,
  COALESCE(p.removed_or_inactive_count, 0) AS removed_or_inactive_count,
  s.relationship_anchor_available_count,
  s.daily_conversation_intent,
  CASE WHEN s.daily_conversation_intent = 'relationship_anchor_bridge' THEN 1 ELSE 0 END
    AS relationship_anchor_bridge_intent,
  CASE
    WHEN COALESCE(p.active_people_count, 0) = 0
      AND s.relationship_anchor_available_count > 0
      THEN 'anchors_available_after_no_people'
    WHEN COALESCE(p.active_people_count, 0) = 0
      AND s.daily_conversation_intent = 'relationship_anchor_bridge'
      THEN 'relationship_anchor_bridge_with_no_available_anchors'
    WHEN COALESCE(p.removed_or_inactive_count, 0) > 0
      AND COALESCE(p.active_people_count, 0) = 0
      AND s.relationship_anchor_available_count > 0
      THEN 'anchors_available_after_removed_private'
    ELSE NULL
  END AS suspicious_flag,
  s.raw_meta AS raw_json
FROM sms_anchor_meta s
LEFT JOIN people_counts p ON p.clerk_user_id = s.clerk_user_id
WHERE
  COALESCE(p.active_people_count, 0) = 0 AND s.relationship_anchor_available_count > 0
  OR s.daily_conversation_intent = 'relationship_anchor_bridge'
  OR COALESCE(p.removed_or_inactive_count, 0) > 0
ORDER BY s.event_at DESC, s.clerk_user_id;

-- Manual privacy audit: uncomment a local-only SELECT on important_people if needed.
-- Do not run in shared exports; exposes person names.


-- =============================================================================
-- QUERY 10 — victory_room_surface_copy_risk_search
-- Persisted proof lines / payloads with banned or gamified language.
-- UI hero copy ("trophy room") lives in code — requires code audit separately.
-- =============================================================================

WITH bounds AS (
  SELECT
    ('2026-06-13 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_start,
    ('2026-06-15 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_end
),
lines AS (
  SELECT
    ev.occurred_at AS event_at,
    ev.clerk_user_id,
    ev.event_type,
    ev.id AS event_id,
    LEFT(COALESCE(
      ev.payload_json->>'proof_meaning_line',
      ev.payload_json->>'user_visible_proof_line',
      ev.payload_json->>'message',
      ''
    ), 300) AS proof_or_display_line,
    ev.payload_json->>'proof_moment_type' AS proof_moment_type,
    to_jsonb(ev) AS raw_json
  FROM v2_commitment_event ev
  CROSS JOIN bounds b
  WHERE ev.occurred_at >= b.day_start
    AND ev.occurred_at < b.day_end
    AND (
      COALESCE((ev.payload_json->>'proof_moment')::boolean, false) IS TRUE
      OR ev.event_type IN ('user_yes', 'user_no', 'user_partial', 'blocker_captured')
    )
)
SELECT
  event_at,
  clerk_user_id,
  event_type,
  event_id,
  proof_moment_type,
  proof_or_display_line,
  CASE
    WHEN proof_or_display_line ~* '(streak|badge|scoreboard|\bXP\b|level|trophy)'
      THEN 'gamification_language'
    WHEN proof_or_display_line ~* '(add to victory|may belong|consider adding|fake proof)'
      THEN 'manual_add_or_fake_proof_language'
    WHEN proof_or_display_line ~* '(followed_through|streak_continued|meaningful_streak|proof_moment_type|user_yes|user_no)'
      THEN 'internal_enum_or_metadata_leak'
    ELSE 'needs_manual_review'
  END AS copy_risk_label,
  raw_json
FROM lines
WHERE proof_or_display_line ~* (
  'streak|badge|scoreboard|\bXP\b|level|trophy|add to victory|may belong|'
  || 'consider adding|fake proof|proof_moment_type|followed_through|meaningful_streak'
)
ORDER BY event_at DESC, clerk_user_id;

-- Code audit required for Victory Room UI strings not stored in DB:
--   src/components/VictoryRoomTopCard.tsx ("living trophy room")
--   src/components/VictoryEvidenceSection.tsx ("no scoreboard")
--   src/lib/v2-victory-pat-read.ts (deterministic copy)


-- =============================================================================
-- QUERY 11 — bridge_health_rollup
-- One row per day: bridge health counts for soak window.
-- =============================================================================

WITH bounds AS (
  SELECT
    ('2026-06-13 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_start,
    ('2026-06-15 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_end
),
day_series AS (
  SELECT generate_series(
    (SELECT day_start FROM bounds),
    (SELECT day_end FROM bounds) - interval '1 day',
    interval '1 day'
  ) AS day_start
),
outcome_counts AS (
  SELECT
    date_trunc('day', ev.occurred_at AT TIME ZONE 'America/New_York') AS day_et,
    COUNT(*) FILTER (
      WHERE ev.event_type IN ('user_yes', 'user_no', 'user_partial')
    ) AS outcome_events,
    COUNT(*) FILTER (
      WHERE COALESCE((ev.payload_json->>'proof_moment')::boolean, false) IS TRUE
    ) AS proof_moment_true,
    COUNT(*) FILTER (
      WHERE COALESCE((ev.payload_json->>'proof_moment')::boolean, false) IS TRUE
        AND NULLIF(BTRIM(COALESCE(
          ev.payload_json->>'proof_meaning_line',
          ev.payload_json->>'user_visible_proof_line',
          ''
        )), '') IS NOT NULL
    ) AS displayable_proof_candidates
  FROM v2_commitment_event ev
  CROSS JOIN bounds b
  WHERE ev.occurred_at >= b.day_start AND ev.occurred_at < b.day_end
  GROUP BY 1
),
language_counts AS (
  SELECT
    date_trunc('day', u.event_at AT TIME ZONE 'America/New_York') AS day_et,
    COUNT(*) AS sms_proof_victory_mentions,
    COUNT(*) FILTER (
      WHERE u.body_preview ~* '(add this|may belong|consider adding|saved|saving|logged as proof)'
    ) AS unsupported_proof_mentions
  FROM (
    SELECT e.created_at AS event_at, LEFT(COALESCE(e.metadata->>'sms_body', ''), 400) AS body_preview
    FROM sms_send_events e
    CROSS JOIN bounds b
    WHERE e.created_at >= b.day_start AND e.created_at < b.day_end
    UNION ALL
    SELECT j.updated_at, LEFT(COALESCE(j.reply_body, ''), 400)
    FROM sms_inbound_coach_jobs j
    CROSS JOIN bounds b
    WHERE j.updated_at >= b.day_start AND j.updated_at < b.day_end
  ) u
  WHERE u.body_preview ~* 'victory\s*room|\bproof\b|saved|saving|streak|may belong|add this'
  GROUP BY 1
),
overlay_mismatch AS (
  SELECT
    date_trunc('day', c.updated_at AT TIME ZONE 'America/New_York') AS day_et,
    COUNT(*) FILTER (
      WHERE NULLIF(BTRIM(c.adaptive_ask_text), '') IS NOT NULL
        AND c.adaptive_ask_expires_at IS NOT NULL
        AND c.adaptive_ask_expires_at > now()
        AND BTRIM(c.adaptive_ask_text) IS DISTINCT FROM BTRIM(c.behavior_statement)
    ) AS shrink_effective_ask_mismatches
  FROM v2_commitment c
  WHERE c.status = 'active'
  GROUP BY 1
),
edit_counts AS (
  SELECT
    date_trunc('day', uiv.created_at AT TIME ZONE 'America/New_York') AS day_et,
    COUNT(*) AS identity_edits_in_window
  FROM user_identity_version uiv
  CROSS JOIN bounds b
  WHERE uiv.created_at >= b.day_start AND uiv.created_at < b.day_end
  GROUP BY 1
),
goal_edit_counts AS (
  SELECT
    date_trunc('day', c.updated_at AT TIME ZONE 'America/New_York') AS day_et,
    COUNT(*) AS goal_edits_in_window
  FROM v2_commitment c
  CROSS JOIN bounds b
  WHERE c.updated_at >= b.day_start AND c.updated_at < b.day_end
    AND c.status = 'active'
  GROUP BY 1
),
no_send_proof AS (
  SELECT
    date_trunc('day', ev.occurred_at AT TIME ZONE 'America/New_York') AS day_et,
    COUNT(*) AS no_send_proof_rows
  FROM v2_commitment_event ev
  CROSS JOIN bounds b
  WHERE ev.occurred_at >= b.day_start AND ev.occurred_at < b.day_end
    AND COALESCE((ev.payload_json->>'proof_moment')::boolean, false) IS TRUE
    AND EXISTS (
      SELECT 1
      FROM sms_inbound_coach_jobs j
      WHERE j.clerk_user_id = ev.clerk_user_id
        AND j.message_sid = COALESCE(
          ev.payload_json->>'message_sid',
          split_part(ev.idempotency_key, ':', 2)
        )
        AND (j.status <> 'sent' OR NULLIF(BTRIM(j.outbound_message_sid), '') IS NULL)
    )
  GROUP BY 1
),
anchor_anomalies AS (
  SELECT
    date_trunc('day', e.created_at AT TIME ZONE 'America/New_York') AS day_et,
    COUNT(*) FILTER (
      WHERE COALESCE(
        (e.metadata->'relationship_packet_observability'->>'relationship_anchor_available_count')::int,
        0
      ) > 0
      AND NOT EXISTS (
        SELECT 1 FROM important_people ip
        WHERE ip.clerk_user_id = e.clerk_user_id
          AND ip.is_active IS TRUE AND ip.removed_at IS NULL
      )
    ) AS important_people_anchor_anomalies
  FROM sms_send_events e
  CROSS JOIN bounds b
  WHERE e.created_at >= b.day_start AND e.created_at < b.day_end
  GROUP BY 1
)
SELECT
  d.day_start::date AS day_et,
  COALESCE(o.outcome_events, 0) AS outcome_events,
  COALESCE(o.proof_moment_true, 0) AS proof_moment_true,
  COALESCE(o.displayable_proof_candidates, 0) AS displayable_proof_candidates,
  COALESCE(l.sms_proof_victory_mentions, 0) AS sms_proof_victory_mentions,
  COALESCE(l.unsupported_proof_mentions, 0) AS unsupported_proof_mentions,
  COALESCE(m.shrink_effective_ask_mismatches, 0) AS shrink_effective_ask_mismatches,
  COALESCE(ec.identity_edits_in_window, 0) AS identity_edits_in_window,
  COALESCE(gc.goal_edits_in_window, 0) AS goal_edits_in_window,
  COALESCE(n.no_send_proof_rows, 0) AS no_send_proof_rows,
  COALESCE(a.important_people_anchor_anomalies, 0) AS important_people_anchor_anomalies
FROM day_series d
LEFT JOIN outcome_counts o ON o.day_et = d.day_start
LEFT JOIN language_counts l ON l.day_et = d.day_start
LEFT JOIN overlay_mismatch m ON m.day_et = d.day_start
LEFT JOIN edit_counts ec ON ec.day_et = d.day_start
LEFT JOIN goal_edit_counts gc ON gc.day_et = d.day_start
LEFT JOIN no_send_proof n ON n.day_et = d.day_start
LEFT JOIN anchor_anomalies a ON a.day_et = d.day_start
ORDER BY day_et;
