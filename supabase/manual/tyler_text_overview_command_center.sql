-- =============================================================================
-- TYLER TEXT OVERVIEW — COMMAND CENTER (SELECT ONLY)
-- =============================================================================
-- Read-only daily observability for Tyler Text Overview MVP.
-- No DDL. No DML. No phone numbers.
--
-- Edit target day once per block:
--   WITH params AS ( SELECT 'YYYY-MM-DD'::text AS target_day_key )
--
-- Schema rules (production spine):
--   sms_send_events: id, clerk_user_id, day_key, message_sid, status, metadata, created_at, sms_body
--     (no top-level sent_at, body, updated_at)
--   sms_inbound_messages: id, message_sid, clerk_user_id, raw_body, received_at
--     (no created_at, inserted_at, metadata; phone_number exists but is NOT queried here)
--
-- Healthy launch day (rough guide):
--   TTO_01: generations > 0, sent + skipped ~= eligible users, live_fallback low
--   TTO_04: Tyler edits intentional and small in count
--   TTO_07: stale rows should trend toward 0 after evening/pre-send sweeps
--   TTO_08: send_source matches expectation (machine_draft or tyler_edit)
--   TTO_10: unsent current after 7AM window should be near zero
-- =============================================================================


-- =============================================================================
-- TTO_01 — executive_scorecard
-- Purpose: One-row scorecard for target_day_key.
-- Healthy: generated_count > 0 on launch day; notebook_verified_rate high;
--          live_fallback_count low relative to sent_count.
-- =============================================================================
WITH params AS (
  SELECT 'YYYY-MM-DD'::text AS target_day_key
),
generations AS (
  SELECT g.*
  FROM sms_daily_draft_generations g
  CROSS JOIN params p
  WHERE g.draft_for_day_key = p.target_day_key
),
drafts AS (
  SELECT d.*
  FROM sms_daily_drafts d
  CROSS JOIN params p
  WHERE d.draft_for_day_key = p.target_day_key
),
sends AS (
  SELECT s.*
  FROM sms_send_events s
  CROSS JOIN params p
  WHERE s.day_key = p.target_day_key
),
send_meta AS (
  SELECT
    s.*,
    s.metadata->'tyler_text_overview' AS tto_meta,
    s.metadata->'tyler_text_overview'->>'send_source' AS send_source
  FROM sends s
)
SELECT
  p.target_day_key,
  (SELECT COUNT(*) FROM generations) AS generated_count,
  (SELECT COUNT(*) FROM drafts) AS draft_rows_count,
  (SELECT COUNT(*) FROM drafts WHERE status = 'current') AS current_drafts_count,
  (SELECT COUNT(*) FROM generations WHERE machine_should_send = true) AS machine_should_send_count,
  (SELECT COUNT(*) FROM generations WHERE machine_should_send = false) AS machine_no_send_count,
  (SELECT COUNT(*) FROM drafts WHERE edited_by_tyler = true) AS tyler_edited_count,
  (SELECT COUNT(*) FROM drafts WHERE status = 'sent') AS sent_draft_count,
  (SELECT COUNT(*) FROM drafts WHERE status = 'skipped') AS skipped_draft_count,
  (SELECT COUNT(*) FROM send_meta WHERE send_source LIKE 'live_fallback%') AS live_fallback_count,
  (SELECT COUNT(*) FROM send_meta WHERE send_source = 'machine_draft') AS machine_draft_send_count,
  (SELECT COUNT(*) FROM send_meta WHERE send_source = 'tyler_edit') AS tyler_edit_send_count,
  ROUND(
    100.0 * (SELECT COUNT(*) FROM generations WHERE notebook_verdict = 'verified')
    / NULLIF((SELECT COUNT(*) FROM generations), 0),
    1
  ) AS notebook_verified_rate_pct
FROM params p;


-- =============================================================================
-- TTO_02 — generations_by_reason
-- Purpose: Generation reason breakdown for target day.
-- Healthy: noon_batch present after manual/cron generate; evening_sweep / pre_send_stale_refresh
--          appear only after stale sweeps; live_send_fallback rare.
-- =============================================================================
WITH params AS (
  SELECT 'YYYY-MM-DD'::text AS target_day_key
)
SELECT
  g.generation_reason,
  COUNT(*) AS generation_count,
  COUNT(*) FILTER (WHERE g.machine_should_send = true) AS should_send_count,
  COUNT(*) FILTER (WHERE g.machine_should_send = false) AS no_send_count,
  COUNT(*) FILTER (WHERE g.superseded_at IS NOT NULL) AS superseded_count,
  MIN(g.generated_at) AS first_generated_at,
  MAX(g.generated_at) AS last_generated_at
FROM sms_daily_draft_generations g
CROSS JOIN params p
WHERE g.draft_for_day_key = p.target_day_key
GROUP BY g.generation_reason
ORDER BY generation_count DESC, g.generation_reason;


-- =============================================================================
-- TTO_03 — current_drafts_for_day
-- Purpose: All draft rows for target day (any status).
-- Healthy: one row per user/day; status moves current → sent/skipped after 7AM.
-- =============================================================================
WITH params AS (
  SELECT 'YYYY-MM-DD'::text AS target_day_key
)
SELECT
  d.clerk_user_id,
  d.status,
  d.current_body_source,
  d.edited_by_tyler,
  d.current_generation_id,
  LEFT(COALESCE(d.current_body_to_send, ''), 120) AS current_body_preview,
  d.updated_at,
  d.sent_at
FROM sms_daily_drafts d
CROSS JOIN params p
WHERE d.draft_for_day_key = p.target_day_key
ORDER BY d.status, d.clerk_user_id;


-- =============================================================================
-- TTO_04 — tyler_edits
-- Purpose: Rows Tyler edited vs machine output.
-- Healthy: edited_by_tyler=true only when Tyler intentionally changed copy;
--          edit_distance_chars reasonable; machine_draft_body immutable in generations.
-- =============================================================================
WITH params AS (
  SELECT 'YYYY-MM-DD'::text AS target_day_key
)
SELECT
  d.clerk_user_id,
  d.edited_by_tyler,
  d.edited_at,
  d.edit_distance_chars,
  d.machine_body_hash,
  d.current_body_hash,
  LEFT(COALESCE(g.machine_draft_body, ''), 120) AS machine_body_preview,
  LEFT(COALESCE(d.current_body_to_send, ''), 120) AS current_body_preview,
  d.current_generation_id,
  d.status
FROM sms_daily_drafts d
JOIN sms_daily_draft_generations g ON g.id = d.current_generation_id
CROSS JOIN params p
WHERE d.draft_for_day_key = p.target_day_key
  AND d.edited_by_tyler = true
ORDER BY d.edited_at DESC NULLS LAST, d.clerk_user_id;


-- =============================================================================
-- TTO_05 — writer_notebook_presence
-- Purpose: Notebook telemetry without dumping full writer_openai_messages.
-- Healthy: writer_openai_messages_count > 0 for main accountability sends;
--          notebook_verdict = verified for most rows; writer_prompt_path populated.
-- =============================================================================
WITH params AS (
  SELECT 'YYYY-MM-DD'::text AS target_day_key
)
SELECT
  g.clerk_user_id,
  g.generation_number,
  g.generation_reason,
  g.writer_prompt_path,
  g.notebook_verdict,
  g.notebook_verdict_reason,
  g.notebook_source_candidate_count,
  g.notebook_exact_source_message_count,
  g.notebook_thread_message_count,
  g.notebook_filtered_out_reason_top,
  jsonb_array_length(COALESCE(g.writer_openai_messages, '[]'::jsonb)) AS writer_openai_messages_count,
  g.generated_at
FROM sms_daily_draft_generations g
CROSS JOIN params p
WHERE g.draft_for_day_key = p.target_day_key
ORDER BY g.clerk_user_id, g.generation_number;


-- =============================================================================
-- TTO_05b — writer_notebook_detail_limited (optional, max 20 rows)
-- Purpose: Compact notebook detail for manual review — still no phone numbers.
-- Healthy: messages array present for writer-invoked rows.
-- =============================================================================
WITH params AS (
  SELECT 'YYYY-MM-DD'::text AS target_day_key
),
ranked AS (
  SELECT
    g.clerk_user_id,
    g.generation_number,
    g.generation_reason,
    g.writer_openai_messages,
    g.generated_at,
    ROW_NUMBER() OVER (ORDER BY g.generated_at DESC) AS rn
  FROM sms_daily_draft_generations g
  CROSS JOIN params p
  WHERE g.draft_for_day_key = p.target_day_key
)
SELECT
  clerk_user_id,
  generation_number,
  generation_reason,
  jsonb_array_length(COALESCE(writer_openai_messages, '[]'::jsonb)) AS writer_openai_messages_count,
  writer_openai_messages,
  generated_at
FROM ranked
WHERE rn <= 20
ORDER BY generated_at DESC;


-- =============================================================================
-- TTO_06 — stale_refresh_lineage
-- Purpose: Supersede chain for stale refresh generations.
-- Healthy: evening_sweep / pre_send_stale_refresh rows supersede prior noon_batch;
--          current draft pointer references newest generation.
-- =============================================================================
WITH params AS (
  SELECT 'YYYY-MM-DD'::text AS target_day_key
)
SELECT
  old_g.clerk_user_id,
  old_g.id AS old_generation_id,
  old_g.generation_reason AS old_generation_reason,
  old_g.generated_at AS old_generated_at,
  old_g.superseded_at,
  new_g.id AS new_generation_id,
  new_g.generation_reason AS new_generation_reason,
  new_g.generated_at AS new_generated_at,
  d.current_generation_id AS draft_current_generation_id,
  CASE
    WHEN d.current_generation_id = new_g.id THEN 'current_points_to_new'
    WHEN d.current_generation_id = old_g.id THEN 'current_still_old'
    ELSE 'current_other'
  END AS pointer_status
FROM sms_daily_draft_generations old_g
JOIN sms_daily_draft_generations new_g
  ON new_g.id = old_g.superseded_by_generation_id
LEFT JOIN sms_daily_drafts d
  ON d.clerk_user_id = old_g.clerk_user_id
 AND d.draft_for_day_key = old_g.draft_for_day_key
CROSS JOIN params p
WHERE old_g.draft_for_day_key = p.target_day_key
  AND old_g.superseded_at IS NOT NULL
  AND new_g.generation_reason IN ('evening_sweep', 'pre_send_stale_refresh', 'inbound_after_generation')
ORDER BY old_g.clerk_user_id, old_g.generated_at;


-- =============================================================================
-- TTO_07 — inbound_after_generation
-- Purpose: Users with inbound after generation; whether stale sweep refreshed.
-- Healthy: rows with stale_signal=true should get a later sweep generation before 7AM;
--          remaining stale_may_remain=true after pre-send sweep warrants investigation.
-- =============================================================================
WITH params AS (
  SELECT 'YYYY-MM-DD'::text AS target_day_key
),
base AS (
  SELECT
    d.clerk_user_id,
    d.draft_for_day_key,
    d.status AS draft_status,
    g.id AS generation_id,
    g.generation_reason,
    g.generated_at,
    d.current_generation_id
  FROM sms_daily_drafts d
  JOIN sms_daily_draft_generations g ON g.id = d.current_generation_id
  CROSS JOIN params p
  WHERE d.draft_for_day_key = p.target_day_key
),
inbound_after AS (
  SELECT
    b.clerk_user_id,
    b.generation_id,
    MAX(m.received_at) AS latest_inbound_after_generation
  FROM base b
  JOIN sms_inbound_messages m
    ON m.clerk_user_id = b.clerk_user_id
   AND m.received_at > b.generated_at
  GROUP BY b.clerk_user_id, b.generation_id
),
later_sweep AS (
  SELECT
    b.clerk_user_id,
    COUNT(*) AS sweep_generation_count
  FROM base b
  JOIN sms_daily_draft_generations g2
    ON g2.clerk_user_id = b.clerk_user_id
   AND g2.draft_for_day_key = b.draft_for_day_key
   AND g2.generation_reason IN ('evening_sweep', 'pre_send_stale_refresh')
   AND g2.generated_at > b.generated_at
  GROUP BY b.clerk_user_id
)
SELECT
  b.clerk_user_id,
  b.draft_status,
  b.generation_reason AS current_generation_reason,
  b.generated_at AS current_generation_at,
  ia.latest_inbound_after_generation,
  COALESCE(ls.sweep_generation_count, 0) AS later_sweep_generation_count,
  true AS stale_signal,
  CASE
    WHEN COALESCE(ls.sweep_generation_count, 0) = 0 THEN true
    ELSE false
  END AS stale_may_remain
FROM base b
JOIN inbound_after ia
  ON ia.clerk_user_id = b.clerk_user_id
 AND ia.generation_id = b.generation_id
LEFT JOIN later_sweep ls ON ls.clerk_user_id = b.clerk_user_id
ORDER BY ia.latest_inbound_after_generation DESC;


-- =============================================================================
-- TTO_08 — 7am_send_reconciliation
-- Purpose: Join drafts to sms_send_events for target day.
-- Healthy: sent drafts align with send events; metadata.tyler_text_overview present when env on;
--          final_body_sent / sms_body consistent with send_source.
-- =============================================================================
WITH params AS (
  SELECT 'YYYY-MM-DD'::text AS target_day_key
)
SELECT
  d.clerk_user_id,
  d.status AS draft_status,
  d.edited_by_tyler,
  d.final_body_sent,
  LEFT(COALESCE(d.current_body_to_send, ''), 120) AS draft_body_preview,
  s.id AS sms_send_event_id,
  s.status AS send_event_status,
  s.message_sid,
  s.created_at AS send_event_created_at,
  LEFT(COALESCE(s.sms_body, ''), 120) AS sms_body_preview,
  s.metadata->'tyler_text_overview' AS tyler_text_overview_metadata,
  s.metadata->'tyler_text_overview'->>'send_source' AS send_source,
  s.metadata->'tyler_text_overview'->>'stale' AS stale_flag,
  s.metadata->'tyler_text_overview'->>'stale_reason' AS stale_reason
FROM sms_daily_drafts d
LEFT JOIN sms_send_events s
  ON s.clerk_user_id = d.clerk_user_id
 AND s.day_key = d.draft_for_day_key
CROSS JOIN params p
WHERE d.draft_for_day_key = p.target_day_key
ORDER BY d.clerk_user_id, s.created_at DESC NULLS LAST;


-- =============================================================================
-- TTO_09 — send_source_breakdown
-- Purpose: Count send_source values from sms_send_events metadata for target day.
-- Healthy: majority machine_draft or tyler_edit; live_fallback_* should be minority.
-- =============================================================================
WITH params AS (
  SELECT 'YYYY-MM-DD'::text AS target_day_key
)
SELECT
  COALESCE(s.metadata->'tyler_text_overview'->>'send_source', '(missing_tto_metadata)') AS send_source,
  COUNT(*) AS send_event_count
FROM sms_send_events s
CROSS JOIN params p
WHERE s.day_key = p.target_day_key
GROUP BY 1
ORDER BY send_event_count DESC, send_source;


-- =============================================================================
-- TTO_10 — unsent_current_after_window
-- Purpose: Drafts still current after send window — investigation list.
-- Healthy: near zero after daily-sms cron completes for target day.
-- =============================================================================
WITH params AS (
  SELECT 'YYYY-MM-DD'::text AS target_day_key
)
SELECT
  d.clerk_user_id,
  d.draft_for_day_key,
  d.status,
  d.current_body_source,
  d.edited_by_tyler,
  d.updated_at,
  d.sent_at,
  LEFT(COALESCE(d.current_body_to_send, ''), 120) AS current_body_preview,
  g.generation_reason,
  g.generated_at AS generation_at
FROM sms_daily_drafts d
JOIN sms_daily_draft_generations g ON g.id = d.current_generation_id
CROSS JOIN params p
WHERE d.draft_for_day_key = p.target_day_key
  AND d.status = 'current'
ORDER BY d.updated_at DESC, d.clerk_user_id;


-- =============================================================================
-- TTO_11 — detail_for_chatgpt_review
-- Purpose: Compact export Tyler can paste to ChatGPT for qualitative review.
-- Limit: target day only. No phone numbers. Includes full writer_openai_messages.
-- Healthy: machine/current/final bodies align with send_source and edited_by_tyler.
-- =============================================================================
WITH params AS (
  SELECT 'YYYY-MM-DD'::text AS target_day_key
)
SELECT
  d.clerk_user_id,
  d.draft_for_day_key,
  d.status AS draft_status,
  d.edited_by_tyler,
  g.notebook_verdict,
  g.notebook_verdict_reason,
  g.generation_reason,
  g.machine_draft_body,
  d.current_body_to_send,
  d.final_body_sent,
  g.writer_openai_messages,
  s.metadata->'tyler_text_overview'->>'send_source' AS send_source,
  s.sms_body AS sent_sms_body,
  s.status AS send_event_status,
  s.created_at AS send_event_created_at
FROM sms_daily_drafts d
JOIN sms_daily_draft_generations g ON g.id = d.current_generation_id
LEFT JOIN sms_send_events s
  ON s.clerk_user_id = d.clerk_user_id
 AND s.day_key = d.draft_for_day_key
CROSS JOIN params p
WHERE d.draft_for_day_key = p.target_day_key
ORDER BY d.clerk_user_id;
