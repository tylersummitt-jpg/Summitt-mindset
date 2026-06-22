-- =============================================================================
-- SMS DAILY COMMAND CENTER PACK v2.9
-- Read-only observability for Summitt Mindset SMS (all users, no hard-coded personas).
-- Replaces the 29-query daily process (16 SMS soak + 13 truth cert) with 14 queries.
--
-- v2.9 Sunday daily suppression before Weekly Pat Pause (June 2026):
--   - Q01 skipped_sunday_weekly_pause_count + Sunday collision markers.
--   - Q03/Q13 surface skipped_sunday_weekly_pause (intentional, not an error).
--   - Q13 sunday_daily_suppressed_before_weekly when suppression without visible weekly same Sunday.
--   - Eligible denominator excludes skipped_sunday_weekly_pause / sunday_weekly_pause skip_source.
--
-- v2.8 Weekly SMS body observability (June 2026):
--   - Weekly body fallbacks: north_star_gate.final_body, v3_candidate_body, final_voice_gate, voice_send_decision.
--   - Q01 weekly_body_missing_with_sid_count; Q13 weekly_body_missing_with_sid warning rows.
--
-- v2.7 Relationship Thread Review (June 2026):
--   - Q14 relationship_thread_review: chronological user/coach thread lens (visible rows only).
--   - Unions inbound messages, inbound job user raw_body, coach replies, daily + weekly outbound.
--   - Writer-aligned body paths, visible_sent classification, 5s user dedupe, brief/durable telemetry on daily rows.
--
-- v2.6 DailySmsWritingBriefV1 thread coverage + freshness extraction sanity (June 2026):
--   - Q01 counts: empty brief thread with prior visible, thread over cap (>25), oldest/newest reversed, visible repeated CTA risk.
--   - Q02 per-row flags: c1_brief_empty_thread_with_prior_visible, thread over cap, oldest/newest reversed, visible_repeated_cta_risk, freshness_preview_missed_visible_cta.
--   - Q05 broadened visible CTA regex (hour/distribution, timer/gentle sound, snoozing, morning minutes).
--   - Q13 sanity: thread over cap, oldest/newest reversed, empty thread with prior visible, freshness missed visible CTA.
--
-- v2.5 DailySmsWritingBriefV1 timing + durable memory observability (June 2026):
--   - daily_local_daypart, timing guidance counts/flags, timing anchor confidence.
--   - Durable memory item/people/blocker counts (no names or full memory text).
--   - Q01 counts: timing_guidance_present, durable_memory_present, durable_people_present.
--   - Q13 sanity: missing timing/durable/daypart observability, background_only flag.
--
-- v2.4 DailySmsWritingBriefV1 observability hardening (June 2026):
--   - daily_writing_brief_build_status / daily_writing_brief_skip_reason (brief vs legacy fallback).
--   - Compact suggested_move, thread window floor/extension, freshness phrase preview, open-loop flags.
--   - Q01 counts: c1_brief_used/fallback/missing_reason, extension thread, freshness preview, open-loop.
--   - Q13 sanity: legacy without skip reason, brief-used missing suggested_move, thread counts, etc.
--
-- v2.3 DailySmsWritingBriefV1 observability (June 2026):
--   - writer_prompt_path / daily_writing_brief_used on sent rows via relationship_packet_observability.
--   - Proof calibration, freshness, thread counts, unsupported praise / repeated CTA seatbelt telemetry.
--   - Q13 sanity for missing brief telemetry on visible C1 sends.
--
-- v2.2 reliability (June 2026):
--   - Safe last_error extraction: regex + metadata paths only (never last_error::jsonb).
--   - Coach-body near-duplicate telemetry in Q01/Q03/Q04 + timeline flag in Q02.
--   - Expanded goal-change / amend-goals regex in Q07/Q09.
--   - Q13 sanity when coach-body telemetry exists in raw_json but extract fields blank.
--
-- v2.1 reliability (June 19 soak):
--   - Eligible denominator excludes legitimate skip statuses (not only no_send_reason).
--   - Inbound job last_error regex extraction for no-send reason and truth metadata.
--   - Safer inbound pairing: message_sid > raw_body > nearest future job within 60m.
--   - No-send truth-loss treats cancelled as no-send using extracted reason.
--   - Q11/Q12 classify from extracted no_send_reason (stale ask vs pending/guard).
--   - Q13 reports impacted_query + severity for downstream query reliability.
--
-- Rules:
--   SELECT-only. No DDL/DML. No schema changes. Each query runs standalone.
--   Default window: last 24 hours (Query 02 + Query 14 timeline: last 9 days).
--   Edit the bounds CTE in each query for manual date override.
--
-- Saved-query names: SM_AUDIT_01_Command_Center … SM_AUDIT_14_Relationship_Thread_Review
-- Guide: src/sms-review-place/SMS_DAILY_COMMAND_CENTER_GUIDE.md
-- =============================================================================


-- =============================================================================
-- QUERY 01 — executive_command_center_scorecard
-- Saved query name: SM_AUDIT_01_Command_Center
-- Purpose: First daily dashboard — eligible sends, no-sends, truth/VR/language risks.
-- Default window: last 24 hours
-- MANUAL DATE OVERRIDE (optional — replace bounds lines below):
--   timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
--   timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
-- =============================================================================

WITH bounds AS (
  SELECT
    now() - interval '24 hours' AS window_start,
    now() AS window_end
),
send_base AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(s)->>'status', '') AS status,
    COALESCE(to_jsonb(s)->>'message_sid', to_jsonb(s)->>'outbound_message_sid', to_jsonb(s)#>>'{metadata,message_sid}', '') AS message_sid,
    COALESCE(to_jsonb(s)#>>'{metadata,note}', '') AS note,
    COALESCE(
      to_jsonb(s)#>>'{metadata,route_kind}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,route_kind}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_route_kind}',
      ''
    ) AS route_kind,
    COALESCE(
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      to_jsonb(s)->>'no_send_reason',
      ''
    ) AS no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,skip_source}',
      to_jsonb(s)#>>'{metadata,voice_send_decision,skip_source}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,skip_source}',
      ''
    ) AS skip_source,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,v3_brain,daily_zero_question_mode_active}',
      ''
    ) AS daily_zero_question_mode_active,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,body}'), ''),
      ''
    ) AS body_preview,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,coach_body_near_duplicate_detected}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,coach_body_near_duplicate_detected}',
      to_jsonb(s)#>>'{metadata,v3_brain,coach_body_near_duplicate_detected}',
      to_jsonb(s)#>>'{metadata,coach_body_near_duplicate_detected}',
      ''
    ) AS coach_body_near_duplicate_detected,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_coach_body_near_duplicate_blocked}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_coach_body_near_duplicate_blocked}',
      to_jsonb(s)#>>'{metadata,v3_brain,daily_coach_body_near_duplicate_blocked}',
      to_jsonb(s)#>>'{metadata,daily_coach_body_near_duplicate_blocked}',
      ''
    ) AS daily_coach_body_near_duplicate_blocked,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_no_send_reason}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_no_send_reason}',
      to_jsonb(s)#>>'{metadata,v3_brain,memory_repeat_no_send_reason}',
      to_jsonb(s)#>>'{metadata,memory_repeat_no_send_reason}',
      ''
    ) AS memory_repeat_no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,writer_prompt_path}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,writer_prompt_path}',
      ''
    ) AS writer_prompt_path,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_writing_brief_used}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_writing_brief_used}',
      ''
    ) AS daily_writing_brief_used,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_praise_allowed_level}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_praise_allowed_level}',
      ''
    ) AS daily_praise_allowed_level,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,unsupported_praise_claim}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,unsupported_praise_claim}',
      ''
    ) AS unsupported_praise_claim,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_repeated_cta_detected}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_repeated_cta_detected}',
      ''
    ) AS daily_repeated_cta_detected,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_writing_brief_build_status}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_writing_brief_build_status}',
      ''
    ) AS daily_writing_brief_build_status,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_writing_brief_skip_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_writing_brief_skip_reason}',
      ''
    ) AS daily_writing_brief_skip_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_suggested_move}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_suggested_move}',
      ''
    ) AS daily_suggested_move,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_brief_thread_extension_message_count}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_brief_thread_extension_message_count}',
      ''
    ) AS daily_brief_thread_extension_message_count,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_freshness_avoid_phrases_preview}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_freshness_avoid_phrases_preview}',
      ''
    ) AS daily_freshness_avoid_phrases_preview,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_open_loop_pending_active}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_open_loop_pending_active}',
      ''
    ) AS daily_open_loop_pending_active,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_timing_guidance_present}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_timing_guidance_present}',
      ''
    ) AS daily_timing_guidance_present,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_durable_memory_item_count}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_durable_memory_item_count}',
      ''
    ) AS daily_durable_memory_item_count,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_durable_people_count}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_durable_people_count}',
      ''
    ) AS daily_durable_people_count,
    COALESCE(to_jsonb(s)->>'clerk_user_id', to_jsonb(s)#>>'{metadata,clerk_user_id}', '') AS clerk_user_id,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_brief_thread_message_count}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_brief_thread_message_count}',
      ''
    ) AS daily_brief_thread_message_count,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_brief_thread_oldest_at_local}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_brief_thread_oldest_at_local}',
      ''
    ) AS daily_brief_thread_oldest_at_local,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_brief_thread_newest_at_local}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_brief_thread_newest_at_local}',
      ''
    ) AS daily_brief_thread_newest_at_local
  FROM sms_send_events s
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
classified AS (
  SELECT
    *,
    CASE
      WHEN status ~* '^skipped_(not_fully_on_v2|no_active_commitment|duplicate|tapback|compliance|safety|crisis|invalid_phone|outside_send_window|active_inbound_thread|sunday_weekly_pause)$'
        THEN false
      WHEN no_send_reason ~* '(not.*v2|not_fully_on_v2|no_active_commitment|stopped|unsubscribed|duplicate|tapback|compliance|safety|crisis|invalid_phone|outside_send_window|skipped_not_time|skipped_active_inbound_thread|skipped_sunday_weekly_pause)'
        OR skip_source ~* '(not.*v2|not_fully_on_v2|no_active_commitment|duplicate|tapback|compliance|safety|crisis|active_inbound_thread|outside_send_window|sunday_weekly_pause)'
      THEN false ELSE true
    END AS eligible_coaching_row,
    CASE
      WHEN body_preview <> ''
       AND (status ~* '(sent|delivered|queued|success|accepted|sending)' OR message_sid <> '' OR note = 'sent_to_twilio')
       AND no_send_reason = '' AND skip_source = '' THEN true
      WHEN body_preview <> ''
       AND (status ~* '(sent|delivered|queued|success|accepted|sending)' OR message_sid <> '' OR note = 'sent_to_twilio')
       AND no_send_reason !~* '(blocked|no_send|stale|memory|freshness|missing|required|compliance|safety|duplicate|tapback|not_fully_on_v2|no_active_commitment|outside_send_window)'
       AND skip_source = '' THEN true
      ELSE false
    END AS visible_sent
  FROM send_base
),
classified_with_prior AS (
  SELECT
    c.*,
    SUM(CASE WHEN c.visible_sent THEN 1 ELSE 0 END) OVER (
      PARTITION BY c.clerk_user_id ORDER BY c.event_at
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS prior_visible_send_count
  FROM classified c
),
daily_agg AS (
  SELECT
    COUNT(*) FILTER (WHERE eligible_coaching_row) AS eligible_daily_rows,
    COUNT(*) FILTER (WHERE eligible_coaching_row AND visible_sent) AS visible_sends,
    COUNT(*) FILTER (WHERE eligible_coaching_row AND NOT visible_sent) AS eligible_no_sends,
    ROUND(100.0 * COUNT(*) FILTER (WHERE eligible_coaching_row AND NOT visible_sent)
      / NULLIF(COUNT(*) FILTER (WHERE eligible_coaching_row), 0), 1) AS eligible_no_send_rate_pct,
    COUNT(*) FILTER (
      WHERE daily_zero_question_mode_active ~* 'true' AND visible_sent
        AND body_preview ~* '\?|\b(tell me|let me know|reply with|name the blocker|choose one|send me|what|how|why|when|did you|do you|will you|can you)\b'
    ) AS zero_question_visible_violations,
    COUNT(*) FILTER (WHERE eligible_coaching_row AND NOT visible_sent AND no_send_reason ~* '(memory|repeat|freshness|stale|thread)') AS memory_thread_stale_blocks,
    COUNT(*) FILTER (
      WHERE eligible_coaching_row AND NOT visible_sent
        AND memory_repeat_no_send_reason = 'coach_body_near_duplicate'
    ) AS coach_body_near_duplicate_no_send_count,
    COUNT(*) FILTER (
      WHERE coach_body_near_duplicate_detected ~* 'true'
        OR daily_coach_body_near_duplicate_blocked ~* 'true'
        OR memory_repeat_no_send_reason = 'coach_body_near_duplicate'
    ) AS daily_coach_body_near_duplicate_block_count,
    COUNT(*) FILTER (
      WHERE visible_sent
        AND body_preview <> ''
        AND (
          body_preview ~* '(aim for another hour.{0,40}(focused work|keep progressing)|deepen your engagement with your students|reflect on how to deepen.{0,40}students)'
        )
    ) AS daily_duplicate_or_stagnation_sent_review_count,
    COUNT(*) FILTER (
      WHERE visible_sent AND body_preview ~* '(did you hit your goal|reply yes|reply no|would you like to recommit|same line for a week)'
    ) AS robot_recommit_language_count,
    COUNT(*) FILTER (
      WHERE visible_sent AND (
        (EXTRACT(HOUR FROM event_at AT TIME ZONE 'America/New_York') < 10
          AND body_preview ~* '(did you|what did you|how did it go|proof|evidence|outcome|hit your goal)')
        OR (EXTRACT(HOUR FROM event_at AT TIME ZONE 'America/New_York') >= 17
          AND body_preview ~* '(what.*plan|first step|next step|will you|going to|plan.*today)')
      )
    ) AS time_of_day_copy_risk_count,
    COUNT(*) FILTER (WHERE visible_sent AND writer_prompt_path = 'daily_writing_brief_v1') AS daily_writing_brief_v1_sent_count,
    COUNT(*) FILTER (WHERE visible_sent AND writer_prompt_path = 'legacy_packet_v1') AS legacy_packet_v1_sent_count,
    COUNT(*) FILTER (WHERE visible_sent AND writer_prompt_path = '') AS unknown_writer_path_sent_count,
    COUNT(*) FILTER (
      WHERE eligible_coaching_row AND NOT visible_sent
        AND (no_send_reason = 'unsupported_praise_claim' OR unsupported_praise_claim ~* 'true')
    ) AS unsupported_praise_no_send_count,
    COUNT(*) FILTER (
      WHERE eligible_coaching_row AND NOT visible_sent
        AND (
          no_send_reason = 'thread_memory_repeat_blocked'
          AND daily_repeated_cta_detected ~* 'true'
        )
    ) AS repeated_cta_no_send_count,
    COUNT(*) FILTER (
      WHERE visible_sent
        AND daily_praise_allowed_level IN ('capability_only', 'none')
        AND body_preview ~* '(great commitment|shown commitment|strong commitment|\bbeen consistent\b|\bon a roll\b|\bdominating\b|\bcrushing it\b|\bkept showing up\b)'
    ) AS weak_proof_bad_praise_visible_count,
    COUNT(*) FILTER (
      WHERE visible_sent
        AND writer_prompt_path = 'daily_writing_brief_v1'
        AND daily_writing_brief_build_status = 'used'
    ) AS c1_brief_used_count,
    COUNT(*) FILTER (
      WHERE visible_sent
        AND writer_prompt_path = 'legacy_packet_v1'
        AND route_kind IN ('main_active_accountability', 'low_pressure_reactivation')
        AND daily_writing_brief_skip_reason <> ''
        AND daily_writing_brief_skip_reason <> 'skipped_non_c1_route'
    ) AS c1_brief_fallback_count,
    COUNT(*) FILTER (
      WHERE visible_sent
        AND writer_prompt_path = 'legacy_packet_v1'
        AND route_kind IN ('main_active_accountability', 'low_pressure_reactivation')
        AND daily_writing_brief_skip_reason = ''
    ) AS c1_brief_missing_reason_count,
    COUNT(*) FILTER (
      WHERE visible_sent
        AND COALESCE(NULLIF(daily_brief_thread_extension_message_count, ''), '0')::int > 0
    ) AS extension_thread_used_count,
    COUNT(*) FILTER (
      WHERE visible_sent AND daily_freshness_avoid_phrases_preview <> ''
    ) AS freshness_phrase_preview_present_count,
    COUNT(*) FILTER (
      WHERE visible_sent AND daily_open_loop_pending_active ~* 'true'
    ) AS open_loop_active_count,
    COUNT(*) FILTER (
      WHERE visible_sent AND daily_timing_guidance_present ~* 'true'
    ) AS timing_guidance_present_count,
    COUNT(*) FILTER (
      WHERE visible_sent
        AND COALESCE(NULLIF(daily_durable_memory_item_count, ''), '0')::int > 0
    ) AS durable_memory_present_count,
    COUNT(*) FILTER (
      WHERE visible_sent
        AND COALESCE(NULLIF(daily_durable_people_count, ''), '0')::int > 0
    ) AS durable_people_present_count,
    COUNT(*) FILTER (
      WHERE visible_sent
        AND writer_prompt_path = 'daily_writing_brief_v1'
        AND daily_writing_brief_build_status = 'used'
        AND COALESCE(NULLIF(daily_brief_thread_message_count, ''), '0')::int <= 1
        AND prior_visible_send_count > 0
    ) AS c1_brief_empty_thread_with_prior_visible_count,
    COUNT(*) FILTER (
      WHERE visible_sent
        AND writer_prompt_path = 'daily_writing_brief_v1'
        AND COALESCE(NULLIF(daily_brief_thread_message_count, ''), '0')::int > 25
    ) AS c1_brief_thread_over_cap_count,
    COUNT(*) FILTER (
      WHERE visible_sent
        AND writer_prompt_path = 'daily_writing_brief_v1'
        AND daily_brief_thread_oldest_at_local <> ''
        AND daily_brief_thread_newest_at_local <> ''
        AND to_timestamp(daily_brief_thread_oldest_at_local, 'Dy Mon DD HH12:MI AM')
          > to_timestamp(daily_brief_thread_newest_at_local, 'Dy Mon DD HH12:MI AM')
    ) AS c1_brief_oldest_newest_reversed_count,
    COUNT(*) FILTER (
      WHERE visible_sent
        AND body_preview ~* '(hour.{0,30}distribution|distribution.{0,30}hour|another hour.{0,30}focused work|timer.{0,20}gentle sound|gentle sound.{0,20}timer|minutes.{0,30}morning|wake.{0,30}snooz)'
    ) AS c1_visible_repeated_cta_risk_count,
    COUNT(*) FILTER (
      WHERE status = 'skipped_sunday_weekly_pause'
        OR no_send_reason = 'skipped_sunday_weekly_pause'
        OR skip_source = 'sunday_weekly_pause'
    ) AS skipped_sunday_weekly_pause_count
  FROM classified_with_prior
),
top_reasons AS (
  SELECT ARRAY_AGG(no_send_reason ORDER BY cnt DESC) AS top_no_send_reasons
  FROM (
    SELECT no_send_reason, COUNT(*) AS cnt
    FROM classified
    WHERE eligible_coaching_row AND NOT visible_sent AND no_send_reason <> ''
    GROUP BY no_send_reason
    ORDER BY cnt DESC
    LIMIT 8
  ) r
),
truth_agg AS (
  SELECT
    COUNT(*) FILTER (WHERE cert_diagnostic IN ('current_code_failure_candidate','expected_write_but_missing','false_outcome_written')) AS inbound_truth_mismatch_count,
    COUNT(*) FILTER (WHERE cert_diagnostic = 'current_code_failure_candidate') AS no_send_truth_loss_count
  FROM (
    SELECT
      CASE
        WHEN ib.inbound_body_preview ~* '(hit the goal|got my|missed|didn''?t hit|did half)'
          AND NOT COALESCE(truth.any_truth_row, FALSE)
          AND COALESCE(tel.persistence_decision, '') IN ('write_user_yes_today', 'write_user_no', 'write_user_partial', 'write_user_yes')
          THEN 'current_code_failure_candidate'
        WHEN ib.inbound_body_preview ~* '(onboarding|didn''?t ask)' AND COALESCE(sp.persisted_user_no, FALSE) THEN 'false_outcome_written'
        WHEN ib.inbound_body_preview ~* '(i''?ll|tomorrow|going to)' AND COALESCE(sp.persisted_user_yes, FALSE) THEN 'false_outcome_written'
        WHEN COALESCE(sp.persisted_user_yes, FALSE) OR COALESCE(sp.persisted_user_no, FALSE) OR COALESCE(sp.persisted_user_partial, FALSE) THEN 'outcome_written_ok'
        ELSE 'server_no_outcome_expected'
      END AS cert_diagnostic
    FROM (
      SELECT
        LEFT(COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''), NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''), ''), 280) AS inbound_body_preview,
        COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''), NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')) AS message_sid
      FROM sms_inbound_messages m
      FULL OUTER JOIN sms_inbound_coach_jobs j ON j.message_sid = to_jsonb(m)->>'message_sid'
      CROSS JOIN bounds b
      WHERE COALESCE(NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) >= b.window_start
        AND COALESCE(NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz, NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz) < b.window_end
        AND COALESCE(NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''), NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')) IS NOT NULL
    ) ib
    LEFT JOIN LATERAL (
      SELECT NULLIF(BTRIM(e.payload_json->>'inbound_meaning_persistence'), '') AS persistence_decision
      FROM v2_commitment_event e
      WHERE e.event_type = 'sms_memory_signal' AND e.payload_json->>'inbound_turn_telemetry' = 'true'
        AND COALESCE(NULLIF(BTRIM(e.payload_json->>'message_sid'), ''), SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')) = ib.message_sid
      ORDER BY e.occurred_at DESC LIMIT 1
    ) tel ON TRUE
    LEFT JOIN LATERAL (
      SELECT BOOL_OR(ev.event_type IN ('user_yes','user_no','user_partial')) AS any_truth_row
      FROM v2_commitment_event ev
      WHERE COALESCE(NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''), SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')) = ib.message_sid
    ) truth ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        BOOL_OR(ev.event_type = 'user_yes') AS persisted_user_yes,
        BOOL_OR(ev.event_type = 'user_no') AS persisted_user_no,
        BOOL_OR(ev.event_type = 'user_partial') AS persisted_user_partial
      FROM v2_commitment_event ev
      WHERE COALESCE(NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''), SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')) = ib.message_sid
    ) sp ON TRUE
  ) x
),
vr_agg AS (
  SELECT COUNT(*) FILTER (WHERE likely_vr_missing_projection) AS victory_room_projection_failure_count
  FROM (
    SELECT
      ev.event_type IN ('user_yes','user_no','user_partial')
      AND COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)
      AND COALESCE(ev.payload_json->>'user_visible_proof_line', '') <> ''
      AND NOT (
        COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE)
        AND COALESCE(ev.payload_json->>'user_visible_proof_line', '') <> ''
        AND NOT COALESCE((ev.payload_json->>'season_lifecycle')::boolean, FALSE)
        AND COALESCE(ev.payload_json->>'proof_moment_type', '') NOT IN ('memory_updated')
      ) AS likely_vr_missing_projection
    FROM v2_commitment_event ev
    CROSS JOIN bounds b
    WHERE ev.occurred_at >= b.window_start AND ev.occurred_at < b.window_end
      AND ev.event_type IN ('user_yes','user_no','user_partial')
  ) v
),
weekly_base AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(w)->>'clerk_user_id', to_jsonb(w)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(w)->>'status', '') AS status,
    COALESCE(to_jsonb(w)->>'message_sid', to_jsonb(w)->>'outbound_message_sid', to_jsonb(w)#>>'{metadata,message_sid}', '') AS message_sid,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(w)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,north_star_gate,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,north_star_gate,original_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,v3_candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_voice_gate,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_voice_gate,final_body_with_suffix}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_voice_gate,final_voice_gate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,voice_send_decision,north_star_visible_body}'), ''),
      ''
    ) AS body_preview
  FROM sms_weekly_send_events w
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
weekly_agg AS (
  SELECT
    COUNT(*) FILTER (
      WHERE (
        status ~* '(sent|delivered|queued|accepted|sending|success)'
        OR message_sid <> ''
      )
      AND body_preview = ''
    ) AS weekly_body_missing_with_sid_count
  FROM weekly_base
),
sunday_daily_visible AS (
  SELECT
    c.clerk_user_id,
    (c.event_at AT TIME ZONE 'America/New_York')::date AS local_day,
    c.event_at,
    c.route_kind
  FROM classified c
  WHERE c.visible_sent
    AND EXTRACT(DOW FROM c.event_at AT TIME ZONE 'America/New_York') = 0
),
sunday_weekly_visible AS (
  SELECT
    wb.clerk_user_id,
    (wb.event_at AT TIME ZONE 'America/New_York')::date AS local_day,
    wb.event_at
  FROM weekly_base wb
  WHERE (
      wb.status ~* '(sent|delivered|queued|accepted|sending|success)'
      OR wb.message_sid <> ''
    )
    AND wb.body_preview <> ''
    AND EXTRACT(DOW FROM wb.event_at AT TIME ZONE 'America/New_York') = 0
),
sunday_collision_agg AS (
  SELECT
    (
      SELECT COUNT(*)::int
      FROM (
        SELECT DISTINCT d.clerk_user_id, d.local_day
        FROM sunday_daily_visible d
        INNER JOIN sunday_weekly_visible w
          ON w.clerk_user_id = d.clerk_user_id AND w.local_day = d.local_day
      ) pairs
    ) AS daily_visible_and_weekly_visible_same_sunday_count,
    (
      SELECT COUNT(*)::int
      FROM sunday_daily_visible d
      INNER JOIN sunday_weekly_visible w
        ON w.clerk_user_id = d.clerk_user_id AND w.local_day = d.local_day
       AND d.event_at > w.event_at
    ) AS sunday_daily_after_weekly_count,
    (
      SELECT COUNT(*)::int
      FROM sunday_daily_visible d
      WHERE d.route_kind IN (
        'main_active_accountability',
        'low_pressure_reactivation',
        'contract_prompt',
        'refresh_identity',
        'refresh_commitment'
      )
    ) AS sunday_weekly_expected_but_daily_sent_count
)
SELECT
  b.window_start,
  b.window_end,
  d.eligible_daily_rows,
  d.visible_sends,
  d.eligible_no_sends,
  d.eligible_no_send_rate_pct,
  d.zero_question_visible_violations,
  d.memory_thread_stale_blocks,
  t.inbound_truth_mismatch_count,
  t.no_send_truth_loss_count,
  v.victory_room_projection_failure_count,
  d.robot_recommit_language_count,
  d.time_of_day_copy_risk_count,
  d.coach_body_near_duplicate_no_send_count,
  d.daily_coach_body_near_duplicate_block_count,
  d.daily_duplicate_or_stagnation_sent_review_count,
  d.daily_writing_brief_v1_sent_count,
  d.legacy_packet_v1_sent_count,
  d.unknown_writer_path_sent_count,
  d.unsupported_praise_no_send_count,
  d.repeated_cta_no_send_count,
  d.weak_proof_bad_praise_visible_count,
  d.c1_brief_used_count,
  d.c1_brief_fallback_count,
  d.c1_brief_missing_reason_count,
  d.extension_thread_used_count,
  d.freshness_phrase_preview_present_count,
  d.open_loop_active_count,
  d.timing_guidance_present_count,
  d.durable_memory_present_count,
  d.durable_people_present_count,
  d.c1_brief_empty_thread_with_prior_visible_count,
  d.c1_brief_thread_over_cap_count,
  d.c1_brief_oldest_newest_reversed_count,
  d.c1_visible_repeated_cta_risk_count,
  d.skipped_sunday_weekly_pause_count,
  sc.daily_visible_and_weekly_visible_same_sunday_count,
  sc.sunday_daily_after_weekly_count,
  sc.sunday_weekly_expected_but_daily_sent_count,
  wk.weekly_body_missing_with_sid_count,
  tr.top_no_send_reasons,
  CASE
    WHEN sc.sunday_daily_after_weekly_count > 0 THEN 'sunday_daily_after_weekly_collision'
    WHEN sc.daily_visible_and_weekly_visible_same_sunday_count > 0 THEN 'sunday_daily_weekly_double_touch'
    WHEN sc.sunday_weekly_expected_but_daily_sent_count > 0 THEN 'sunday_suppressible_daily_still_visible'
    WHEN wk.weekly_body_missing_with_sid_count > 0 THEN 'weekly_body_observability_gap'
    WHEN d.weak_proof_bad_praise_visible_count > 0 THEN 'daily_writing_brief_unsupported_praise_visible'
    WHEN d.unsupported_praise_no_send_count > 0 THEN 'daily_writing_brief_unsupported_praise_seatbelt_monitor'
    WHEN d.repeated_cta_no_send_count > 0 THEN 'daily_writing_brief_repeated_cta_seatbelt_monitor'
    WHEN d.unknown_writer_path_sent_count > 0 AND d.visible_sends > 0 THEN 'daily_writing_brief_writer_path_telemetry_gap'
    WHEN d.coach_body_near_duplicate_no_send_count > 0 THEN 'daily_coach_body_anti_repeat_monitor'
    WHEN d.daily_duplicate_or_stagnation_sent_review_count > 0 THEN 'daily_thread_stagnation_writer_freshness'
    WHEN d.zero_question_visible_violations > 0 THEN 'zero_question_validator_or_card_alignment'
    WHEN d.memory_thread_stale_blocks::numeric / NULLIF(d.eligible_no_sends, 0) > 0.10 THEN 'thread_freshness_zero_question_hardening'
    WHEN t.no_send_truth_loss_count > 0 THEN 'inbound_no_send_truth_persistence'
    WHEN d.eligible_no_send_rate_pct IS NULL THEN 'no_eligible_rows'
    WHEN d.eligible_no_send_rate_pct <= 1.5 THEN 'target_zone_near_1_pct'
    WHEN d.eligible_no_send_rate_pct < 5 THEN 'keep_soaking'
    WHEN d.eligible_no_send_rate_pct < 15 THEN 'improving_under_15_pct'
    ELSE 'thread_freshness_zero_question_hardening'
  END AS next_recommended_slice
FROM bounds b
CROSS JOIN daily_agg d
CROSS JOIN truth_agg t
CROSS JOIN vr_agg v
CROSS JOIN top_reasons tr
CROSS JOIN weekly_agg wk
CROSS JOIN sunday_collision_agg sc;


-- =============================================================================
-- QUERY 02 — thread_timeline_time_of_day
-- Saved query name: SM_AUDIT_02_Thread_Timeline
-- Purpose: Full thread timeline with ET daypart copy-risk flags and inbound truth metadata.
-- Default window: last 9 days
-- MANUAL DATE OVERRIDE (optional — replace bounds lines below):
--   timestamptz '2026-06-10 00:00:00 America/New_York' AS window_start,
--   timestamptz '2026-06-19 00:00:00 America/New_York' AS window_end
-- =============================================================================

WITH bounds AS (
  SELECT
    now() - interval '9 days' AS window_start,
    now() AS window_end
),
inbound_messages AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz
    ) AS event_at,
    CASE
      WHEN NULLIF(to_jsonb(m)->>'received_at', '') IS NOT NULL THEN 'received_at'
      WHEN NULLIF(to_jsonb(m)->>'created_at', '') IS NOT NULL THEN 'created_at'
      WHEN NULLIF(to_jsonb(m)->>'updated_at', '') IS NOT NULL THEN 'updated_at'
      WHEN NULLIF(to_jsonb(m)->>'inserted_at', '') IS NOT NULL THEN 'inserted_at'
      ELSE 'unknown'
    END AS event_time_basis,
    'user_inbound'::text AS event_source,
    COALESCE(to_jsonb(m)->>'clerk_user_id', to_jsonb(m)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(m)->>'message_sid', to_jsonb(m)#>>'{metadata,message_sid}') AS message_sid,
    LEFT(COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''),
      NULLIF(BTRIM(to_jsonb(m)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(m)->>'message_body'), ''),
      NULLIF(BTRIM(to_jsonb(m)#>>'{metadata,raw_body}'), ''),
      ''
    ), 1200) AS body_preview,
    NULL::text AS status,
    NULL::text AS route_kind,
    NULL::text AS no_send_reason,
    NULL::text AS inbound_required_reply_move,
    NULL::text AS inbound_resolved_outcome,
    NULL::text AS inbound_truth_max_questions_override,
    to_jsonb(m) AS raw_json
  FROM sms_inbound_messages m
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz
    ) < b.window_end
),
inbound_replies AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) AS event_at,
    CASE
      WHEN NULLIF(to_jsonb(j)->>'processed_at', '') IS NOT NULL THEN 'processed_at'
      WHEN NULLIF(to_jsonb(j)->>'sent_at', '') IS NOT NULL THEN 'sent_at'
      WHEN NULLIF(to_jsonb(j)->>'created_at', '') IS NOT NULL THEN 'created_at'
      WHEN NULLIF(to_jsonb(j)->>'updated_at', '') IS NOT NULL THEN 'updated_at'
      ELSE 'unknown'
    END AS event_time_basis,
    'coach_inbound_reply'::text AS event_source,
    COALESCE(to_jsonb(j)->>'clerk_user_id', to_jsonb(j)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(j)->>'outbound_message_sid', to_jsonb(j)->>'message_sid') AS message_sid,
    LEFT(COALESCE(
      NULLIF(BTRIM(to_jsonb(j)->>'reply_body'), ''),
      NULLIF(BTRIM(to_jsonb(j)#>>'{metadata,reply_body}'), ''),
      ''
    ), 1200) AS body_preview,
    to_jsonb(j)->>'status' AS status,
    COALESCE(to_jsonb(j)#>>'{metadata,route_purpose}', to_jsonb(j)#>>'{metadata,branch_name}', '') AS route_kind,
    COALESCE(to_jsonb(j)->>'no_send_reason', to_jsonb(j)#>>'{metadata,no_send_reason}', to_jsonb(j)->>'last_error', '') AS no_send_reason,
    COALESCE(
      to_jsonb(j)#>>'{metadata,inbound_required_reply_move}',
      to_jsonb(j)#>>'{metadata,v3_inbound_lane,inbound_required_reply_move}',
      to_jsonb(j)#>>'{metadata,daily_v3_lane,inbound_required_reply_move}',
      ''
    ) AS inbound_required_reply_move,
    COALESCE(
      to_jsonb(j)#>>'{metadata,inbound_resolved_outcome}',
      to_jsonb(j)#>>'{metadata,v3_inbound_lane,inbound_resolved_outcome}',
      to_jsonb(j)#>>'{metadata,daily_v3_lane,inbound_resolved_outcome}',
      ''
    ) AS inbound_resolved_outcome,
    COALESCE(
      to_jsonb(j)#>>'{metadata,inbound_truth_max_questions_override}',
      to_jsonb(j)#>>'{metadata,v3_inbound_lane,inbound_truth_max_questions_override}',
      to_jsonb(j)#>>'{metadata,daily_v3_lane,inbound_truth_max_questions_override}',
      ''
    ) AS inbound_truth_max_questions_override,
    to_jsonb(j) AS raw_json
  FROM sms_inbound_coach_jobs j
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
daily_outbound AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) AS event_at,
    CASE
      WHEN NULLIF(to_jsonb(s)->>'sent_at', '') IS NOT NULL THEN 'sent_at'
      WHEN NULLIF(to_jsonb(s)->>'processed_at', '') IS NOT NULL THEN 'processed_at'
      WHEN NULLIF(to_jsonb(s)->>'created_at', '') IS NOT NULL THEN 'created_at'
      WHEN NULLIF(to_jsonb(s)->>'updated_at', '') IS NOT NULL THEN 'updated_at'
      ELSE 'unknown'
    END AS event_time_basis,
    'coach_daily_outbound'::text AS event_source,
    COALESCE(to_jsonb(s)->>'clerk_user_id', to_jsonb(s)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(s)->>'message_sid', to_jsonb(s)->>'outbound_message_sid', to_jsonb(s)#>>'{metadata,message_sid}') AS message_sid,
    LEFT(COALESCE(
      NULLIF(BTRIM(to_jsonb(s)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,body}'), ''),
      ''
    ), 1200) AS body_preview,
    COALESCE(to_jsonb(s)->>'status', to_jsonb(s)#>>'{metadata,status}', '') AS status,
    COALESCE(
      to_jsonb(s)#>>'{metadata,route_kind}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,route_kind}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_route_kind}',
      ''
    ) AS route_kind,
    COALESCE(
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      to_jsonb(s)#>>'{metadata,skip_source}',
      ''
    ) AS no_send_reason,
    NULL::text AS inbound_required_reply_move,
    NULL::text AS inbound_resolved_outcome,
    NULL::text AS inbound_truth_max_questions_override,
    to_jsonb(s) AS raw_json
  FROM sms_send_events s
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
weekly_outbound AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) AS event_at,
    CASE
      WHEN NULLIF(to_jsonb(w)->>'sent_at', '') IS NOT NULL THEN 'sent_at'
      WHEN NULLIF(to_jsonb(w)->>'processed_at', '') IS NOT NULL THEN 'processed_at'
      WHEN NULLIF(to_jsonb(w)->>'created_at', '') IS NOT NULL THEN 'created_at'
      WHEN NULLIF(to_jsonb(w)->>'updated_at', '') IS NOT NULL THEN 'updated_at'
      ELSE 'unknown'
    END AS event_time_basis,
    'coach_weekly_outbound'::text AS event_source,
    COALESCE(to_jsonb(w)->>'clerk_user_id', to_jsonb(w)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(w)->>'message_sid', to_jsonb(w)->>'outbound_message_sid', to_jsonb(w)#>>'{metadata,message_sid}') AS message_sid,
    LEFT(COALESCE(
      NULLIF(BTRIM(to_jsonb(w)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,north_star_gate,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,north_star_gate,original_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,v3_candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_voice_gate,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_voice_gate,final_body_with_suffix}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_voice_gate,final_voice_gate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,voice_send_decision,north_star_visible_body}'), ''),
      ''
    ), 1200) AS body_preview,
    COALESCE(to_jsonb(w)->>'status', to_jsonb(w)#>>'{metadata,status}', '') AS status,
    'weekly'::text AS route_kind,
    COALESCE(to_jsonb(w)->>'no_send_reason', to_jsonb(w)#>>'{metadata,no_send_reason}', '') AS no_send_reason,
    NULL::text AS inbound_required_reply_move,
    NULL::text AS inbound_resolved_outcome,
    NULL::text AS inbound_truth_max_questions_override,
    to_jsonb(w) AS raw_json
  FROM sms_weekly_send_events w
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
thread_events AS (
  SELECT * FROM inbound_messages
  UNION ALL SELECT * FROM inbound_replies
  UNION ALL SELECT * FROM daily_outbound
  UNION ALL SELECT * FROM weekly_outbound
),
thread_with_prev AS (
  SELECT
    te.*,
    LAG(te.body_preview) FILTER (WHERE te.event_source LIKE 'coach_%')
      OVER (PARTITION BY te.clerk_user_id ORDER BY te.event_at) AS prev_coach_body_preview
  FROM thread_events te
),
thread_scored AS (
  SELECT
    t.*,
    SUM(CASE
      WHEN t.event_source LIKE 'coach_%'
        AND t.body_preview <> ''
        AND (t.status ~* '(sent|delivered|queued|success|accepted|sending)' OR t.message_sid <> '')
      THEN 1 ELSE 0
    END) OVER (
      PARTITION BY t.clerk_user_id ORDER BY t.event_at
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS prior_visible_coach_count
  FROM thread_with_prev t
)
SELECT
  (event_at AT TIME ZONE 'America/New_York')::date AS local_day,
  TO_CHAR(event_at AT TIME ZONE 'America/New_York', 'HH24:MI:SS') AS local_time_et,
  EXTRACT(HOUR FROM event_at AT TIME ZONE 'America/New_York')::int AS local_hour_et,
  CASE
    WHEN EXTRACT(HOUR FROM event_at AT TIME ZONE 'America/New_York') BETWEEN 5 AND 8 THEN 'early_morning_5_8'
    WHEN EXTRACT(HOUR FROM event_at AT TIME ZONE 'America/New_York') BETWEEN 9 AND 11 THEN 'morning_9_11'
    WHEN EXTRACT(HOUR FROM event_at AT TIME ZONE 'America/New_York') BETWEEN 12 AND 16 THEN 'midday_12_16'
    WHEN EXTRACT(HOUR FROM event_at AT TIME ZONE 'America/New_York') BETWEEN 17 AND 20 THEN 'evening_17_20'
    ELSE 'night_21_4'
  END AS local_daypart_et,
  event_at,
  event_time_basis,
  event_source,
  clerk_user_id,
  message_sid,
  status,
  route_kind,
  no_send_reason,
  inbound_required_reply_move,
  inbound_resolved_outcome,
  inbound_truth_max_questions_override,
  body_preview,
  CASE
    WHEN event_source LIKE 'coach_%'
     AND EXTRACT(HOUR FROM event_at AT TIME ZONE 'America/New_York') < 10
     AND body_preview ~* '(did you|what did you|how did it go|what happened|proof|evidence|outcome|actually do|did it happen|hit your goal)'
    THEN 'morning_outcome_question_review'
    WHEN event_source LIKE 'coach_%'
     AND EXTRACT(HOUR FROM event_at AT TIME ZONE 'America/New_York') >= 17
     AND body_preview ~* '(what.*plan|first step|next step|will you|going to|before today ends|get.*done today|plan.*today|how will you)'
    THEN 'evening_plan_question_review'
    WHEN event_source LIKE 'coach_%'
     AND body_preview ~* '(did you hit your goal|reply yes|reply no|would you like to recommit|same line for a week)'
    THEN 'robot_or_recommit_review'
    WHEN event_source = 'coach_inbound_reply'
     AND COALESCE(inbound_resolved_outcome, '') ~* '(plan|future|tomorrow|going_to|gonna)'
     AND body_preview ~* '(did you hit|did you do|did you complete|outcome|proof|how did it go|what did you|hit your goal|did it happen)'
    THEN 'future_plan_immediate_outcome_question_review'
    WHEN event_source = 'coach_inbound_reply'
     AND COALESCE(inbound_resolved_outcome, '') ~* '(completion|completed|yes|hit|done|got_my|success)'
     AND body_preview ~* '(proof|evidence|what did you actually|show me|how did it go|did it happen|what happened|what proof)'
    THEN 'evidence_reasked_review'
    WHEN event_source = 'coach_inbound_reply'
     AND COALESCE(inbound_resolved_outcome, '') ~* '(completion|completed|yes|hit|done|got_my|success)'
     AND body_preview ~* '(what.*plan|first step|next step|will you|going to|how will you|plan.*today|before today ends)'
    THEN 'completion_treated_as_plan_review'
    ELSE ''
  END AS time_of_day_copy_risk,
  CASE
    WHEN event_source LIKE 'coach_%'
     AND prev_coach_body_preview IS NOT NULL
     AND body_preview <> ''
     AND (
       body_preview ~* 'aim for another hour'
       AND prev_coach_body_preview ~* 'aim for another hour'
     ) THEN true
    WHEN event_source LIKE 'coach_%'
     AND prev_coach_body_preview IS NOT NULL
     AND body_preview <> ''
     AND (
       body_preview ~* '(reflect on how to deepen|deepen your engagement with your students)'
       AND prev_coach_body_preview ~* '(reflect on how to deepen|deepen your engagement with your students)'
     ) THEN true
    WHEN event_source LIKE 'coach_%'
     AND prev_coach_body_preview IS NOT NULL
     AND LENGTH(body_preview) >= 48
     AND LENGTH(prev_coach_body_preview) >= 48
     AND LEFT(REGEXP_REPLACE(LOWER(body_preview), '[^a-z0-9 ]', '', 'g'), 100)
         = LEFT(REGEXP_REPLACE(LOWER(prev_coach_body_preview), '[^a-z0-9 ]', '', 'g'), 100)
     THEN true
    WHEN event_source LIKE 'coach_%'
     AND prev_coach_body_preview IS NOT NULL
     AND LENGTH(body_preview) >= 64
     AND LENGTH(prev_coach_body_preview) >= 64
     AND SUBSTRING(REGEXP_REPLACE(LOWER(body_preview), '[^a-z0-9 ]', '', 'g') FROM 20 FOR 80)
         = SUBSTRING(REGEXP_REPLACE(LOWER(prev_coach_body_preview), '[^a-z0-9 ]', '', 'g') FROM 20 FOR 80)
     THEN true
    ELSE false
  END AS near_duplicate_to_previous_coach_sms,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,writer_prompt_path}',
      raw_json#>>'{metadata,daily_v3_lane,writer_prompt_path}',
      ''
    )
    ELSE ''
  END AS writer_prompt_path,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_writing_brief_used}',
      raw_json#>>'{metadata,daily_v3_lane,daily_writing_brief_used}',
      ''
    )
    ELSE ''
  END AS daily_writing_brief_used,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_praise_allowed_level}',
      raw_json#>>'{metadata,daily_v3_lane,daily_praise_allowed_level}',
      ''
    )
    ELSE ''
  END AS daily_praise_allowed_level,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_proof_wins_7d}',
      raw_json#>>'{metadata,daily_v3_lane,daily_proof_wins_7d}',
      ''
    )
    ELSE ''
  END AS daily_proof_wins_7d,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_proof_last_user_yes_age_days}',
      raw_json#>>'{metadata,daily_v3_lane,daily_proof_last_user_yes_age_days}',
      ''
    )
    ELSE ''
  END AS daily_proof_last_user_yes_age_days,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_freshness_avoid_count}',
      raw_json#>>'{metadata,daily_v3_lane,daily_freshness_avoid_count}',
      ''
    )
    ELSE ''
  END AS daily_freshness_avoid_count,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_brief_thread_message_count}',
      raw_json#>>'{metadata,daily_v3_lane,daily_brief_thread_message_count}',
      ''
    )
    ELSE ''
  END AS daily_brief_thread_message_count,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_brief_thread_char_count}',
      raw_json#>>'{metadata,daily_v3_lane,daily_brief_thread_char_count}',
      ''
    )
    ELSE ''
  END AS daily_brief_thread_char_count,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_unsupported_praise_detected}',
      raw_json#>>'{metadata,daily_v3_lane,daily_unsupported_praise_detected}',
      ''
    )
    ELSE ''
  END AS unsupported_praise_detected,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_repeated_cta_detected}',
      raw_json#>>'{metadata,daily_v3_lane,daily_repeated_cta_detected}',
      ''
    )
    ELSE ''
  END AS repeated_cta_detected,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_writing_brief_build_status}',
      raw_json#>>'{metadata,daily_v3_lane,daily_writing_brief_build_status}',
      ''
    )
    ELSE ''
  END AS daily_writing_brief_build_status,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_writing_brief_skip_reason}',
      raw_json#>>'{metadata,daily_v3_lane,daily_writing_brief_skip_reason}',
      ''
    )
    ELSE ''
  END AS daily_writing_brief_skip_reason,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_suggested_move}',
      raw_json#>>'{metadata,daily_v3_lane,daily_suggested_move}',
      ''
    )
    ELSE ''
  END AS daily_suggested_move,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_suggested_posture}',
      raw_json#>>'{metadata,daily_v3_lane,daily_suggested_posture}',
      ''
    )
    ELSE ''
  END AS daily_suggested_posture,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_suggested_max_questions}',
      raw_json#>>'{metadata,daily_v3_lane,daily_suggested_max_questions}',
      ''
    )
    ELSE ''
  END AS daily_suggested_max_questions,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_suggested_move_reason_preview}',
      raw_json#>>'{metadata,daily_v3_lane,daily_suggested_move_reason_preview}',
      ''
    )
    ELSE ''
  END AS daily_suggested_move_reason_preview,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_brief_thread_floor_message_count}',
      raw_json#>>'{metadata,daily_v3_lane,daily_brief_thread_floor_message_count}',
      ''
    )
    ELSE ''
  END AS daily_brief_thread_floor_message_count,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_brief_thread_extension_message_count}',
      raw_json#>>'{metadata,daily_v3_lane,daily_brief_thread_extension_message_count}',
      ''
    )
    ELSE ''
  END AS daily_brief_thread_extension_message_count,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_brief_thread_oldest_at_local}',
      raw_json#>>'{metadata,daily_v3_lane,daily_brief_thread_oldest_at_local}',
      ''
    )
    ELSE ''
  END AS daily_brief_thread_oldest_at_local,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_brief_thread_newest_at_local}',
      raw_json#>>'{metadata,daily_v3_lane,daily_brief_thread_newest_at_local}',
      ''
    )
    ELSE ''
  END AS daily_brief_thread_newest_at_local,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_freshness_avoid_phrases_preview}',
      raw_json#>>'{metadata,daily_v3_lane,daily_freshness_avoid_phrases_preview}',
      ''
    )
    ELSE ''
  END AS daily_freshness_avoid_phrases_preview,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_open_loop_pending_active}',
      raw_json#>>'{metadata,daily_v3_lane,daily_open_loop_pending_active}',
      ''
    )
    ELSE ''
  END AS daily_open_loop_pending_active,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_open_question_pending}',
      raw_json#>>'{metadata,daily_v3_lane,daily_open_question_pending}',
      ''
    )
    ELSE ''
  END AS daily_open_question_pending,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_satisfied_do_not_repeat_count}',
      raw_json#>>'{metadata,daily_v3_lane,daily_satisfied_do_not_repeat_count}',
      ''
    )
    ELSE ''
  END AS daily_satisfied_do_not_repeat_count,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_goal_evolution_invite_active}',
      raw_json#>>'{metadata,daily_v3_lane,daily_goal_evolution_invite_active}',
      ''
    )
    ELSE ''
  END AS daily_goal_evolution_invite_active,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_pending_plan_active}',
      raw_json#>>'{metadata,daily_v3_lane,daily_pending_plan_active}',
      ''
    )
    ELSE ''
  END AS daily_pending_plan_active,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_local_daypart}',
      raw_json#>>'{metadata,daily_v3_lane,daily_local_daypart}',
      ''
    )
    ELSE ''
  END AS daily_local_daypart,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_timing_copy_guidance_count}',
      raw_json#>>'{metadata,daily_v3_lane,daily_timing_copy_guidance_count}',
      ''
    )
    ELSE ''
  END AS daily_timing_copy_guidance_count,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_timing_anchor_active}',
      raw_json#>>'{metadata,daily_v3_lane,daily_timing_anchor_active}',
      ''
    )
    ELSE ''
  END AS daily_timing_anchor_active,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_timing_anchor_confidence}',
      raw_json#>>'{metadata,daily_v3_lane,daily_timing_anchor_confidence}',
      ''
    )
    ELSE ''
  END AS daily_timing_anchor_confidence,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_timing_guidance_present}',
      raw_json#>>'{metadata,daily_v3_lane,daily_timing_guidance_present}',
      ''
    )
    ELSE ''
  END AS daily_timing_guidance_present,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_durable_memory_item_count}',
      raw_json#>>'{metadata,daily_v3_lane,daily_durable_memory_item_count}',
      ''
    )
    ELSE ''
  END AS daily_durable_memory_item_count,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_durable_people_count}',
      raw_json#>>'{metadata,daily_v3_lane,daily_durable_people_count}',
      ''
    )
    ELSE ''
  END AS daily_durable_people_count,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_durable_blocker_theme_count}',
      raw_json#>>'{metadata,daily_v3_lane,daily_durable_blocker_theme_count}',
      ''
    )
    ELSE ''
  END AS daily_durable_blocker_theme_count,
  CASE
    WHEN event_source = 'coach_daily_outbound' THEN COALESCE(
      raw_json#>>'{metadata,relationship_packet_observability,daily_durable_memory_background_only}',
      raw_json#>>'{metadata,daily_v3_lane,daily_durable_memory_background_only}',
      ''
    )
    ELSE ''
  END AS daily_durable_memory_background_only,
  CASE
    WHEN event_source = 'coach_daily_outbound'
      AND COALESCE(
        raw_json#>>'{metadata,relationship_packet_observability,writer_prompt_path}',
        raw_json#>>'{metadata,daily_v3_lane,writer_prompt_path}',
        ''
      ) = 'daily_writing_brief_v1'
      AND COALESCE(
        raw_json#>>'{metadata,relationship_packet_observability,daily_writing_brief_build_status}',
        raw_json#>>'{metadata,daily_v3_lane,daily_writing_brief_build_status}',
        ''
      ) = 'used'
      AND COALESCE(
        NULLIF(COALESCE(
          raw_json#>>'{metadata,relationship_packet_observability,daily_brief_thread_message_count}',
          raw_json#>>'{metadata,daily_v3_lane,daily_brief_thread_message_count}',
          ''
        ), ''),
        '0'
      )::int <= 1
      AND prior_visible_coach_count > 0
    THEN true ELSE false
  END AS c1_brief_empty_thread_with_prior_visible,
  CASE
    WHEN event_source = 'coach_daily_outbound'
      AND COALESCE(
        raw_json#>>'{metadata,relationship_packet_observability,writer_prompt_path}',
        raw_json#>>'{metadata,daily_v3_lane,writer_prompt_path}',
        ''
      ) = 'daily_writing_brief_v1'
      AND COALESCE(
        NULLIF(COALESCE(
          raw_json#>>'{metadata,relationship_packet_observability,daily_brief_thread_message_count}',
          raw_json#>>'{metadata,daily_v3_lane,daily_brief_thread_message_count}',
          ''
        ), ''),
        '0'
      )::int > 25
    THEN true ELSE false
  END AS c1_brief_thread_over_cap,
  CASE
    WHEN event_source = 'coach_daily_outbound'
      AND COALESCE(
        raw_json#>>'{metadata,relationship_packet_observability,daily_brief_thread_oldest_at_local}',
        raw_json#>>'{metadata,daily_v3_lane,daily_brief_thread_oldest_at_local}',
        ''
      ) <> ''
      AND COALESCE(
        raw_json#>>'{metadata,relationship_packet_observability,daily_brief_thread_newest_at_local}',
        raw_json#>>'{metadata,daily_v3_lane,daily_brief_thread_newest_at_local}',
        ''
      ) <> ''
      AND to_timestamp(
        COALESCE(
          raw_json#>>'{metadata,relationship_packet_observability,daily_brief_thread_oldest_at_local}',
          raw_json#>>'{metadata,daily_v3_lane,daily_brief_thread_oldest_at_local}',
          ''
        ),
        'Dy Mon DD HH12:MI AM'
      ) > to_timestamp(
        COALESCE(
          raw_json#>>'{metadata,relationship_packet_observability,daily_brief_thread_newest_at_local}',
          raw_json#>>'{metadata,daily_v3_lane,daily_brief_thread_newest_at_local}',
          ''
        ),
        'Dy Mon DD HH12:MI AM'
      )
    THEN true ELSE false
  END AS c1_brief_oldest_newest_reversed,
  CASE
    WHEN event_source LIKE 'coach_%'
      AND body_preview ~* '(hour.{0,30}distribution|distribution.{0,30}hour|another hour.{0,30}focused work|timer.{0,20}gentle sound|gentle sound.{0,20}timer|minutes.{0,30}morning|wake.{0,30}snooz)'
      AND (
        prev_coach_body_preview ~* '(hour.{0,30}distribution|distribution.{0,30}hour|another hour.{0,30}focused work|timer.{0,20}gentle sound|gentle sound.{0,20}timer|minutes.{0,30}morning|wake.{0,30}snooz)'
        OR body_preview ~* '(hour.{0,30}distribution|distribution.{0,30}hour)'
      )
    THEN true ELSE false
  END AS visible_repeated_cta_risk,
  CASE
    WHEN event_source = 'coach_daily_outbound'
      AND COALESCE(
        raw_json#>>'{metadata,relationship_packet_observability,writer_prompt_path}',
        raw_json#>>'{metadata,daily_v3_lane,writer_prompt_path}',
        ''
      ) = 'daily_writing_brief_v1'
      AND prev_coach_body_preview ~* '(hour.{0,30}distribution|distribution.{0,30}hour|that hour.{0,20}distribution|the hour.{0,20}distribution)'
      AND COALESCE(
        raw_json#>>'{metadata,relationship_packet_observability,daily_freshness_avoid_phrases_preview}',
        raw_json#>>'{metadata,daily_v3_lane,daily_freshness_avoid_phrases_preview}',
        ''
      ) !~* '(hour.{0,30}distribution|distribution.{0,30}hour)'
    THEN true ELSE false
  END AS freshness_preview_missed_visible_cta,
  raw_json
FROM thread_scored
WHERE event_at IS NOT NULL
ORDER BY clerk_user_id, event_at;


-- =============================================================================
-- QUERY 03 — eligible_no_send_forensics_scoreboard
-- Saved query name: SM_AUDIT_03_Eligible_No_Send
-- Purpose: Eligible no-send forensics with per-user repeated no-send window count.
-- Default window: last 24 hours
-- MANUAL DATE OVERRIDE (optional — replace bounds lines below):
--   timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
--   timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
-- =============================================================================

WITH bounds AS (
  SELECT
    now() - interval '24 hours' AS window_start,
    now() AS window_end
),
send_rows AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(s)->>'clerk_user_id', to_jsonb(s)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(
      to_jsonb(s)#>>'{metadata,route_kind}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,route_kind}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_route_kind}',
      ''
    ) AS route_kind,
    COALESCE(
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      to_jsonb(s)->>'no_send_reason',
      ''
    ) AS no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,skip_source}',
      to_jsonb(s)#>>'{metadata,voice_send_decision,skip_source}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,skip_source}',
      ''
    ) AS skip_source,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,lane_stage}',
      to_jsonb(s)#>>'{metadata,lane_stage}',
      ''
    ) AS lane_stage,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,v3_candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,v3_candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_candidate_body}'), ''),
      ''
    ) AS candidate_body,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_repaired_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,memory_repeat_repaired_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_repaired_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,memory_repeat_repaired_body_preview}'), ''),
      ''
    ) AS memory_repaired_body,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,thread_freshness_repaired_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,thread_freshness_repaired_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,thread_freshness_repaired_body_preview}'), ''),
      ''
    ) AS thread_freshness_repaired_body,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_lane_stale_ask_phrase}',
      to_jsonb(s)#>>'{metadata,daily_lane_stale_ask_phrase}',
      to_jsonb(s)#>>'{metadata,daily_post_fvg_stale_ask_phrase}',
      ''
    ) AS stale_phrase,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,repeated_phrases}',
      to_jsonb(s)#>>'{metadata,repeated_phrases}',
      ''
    ) AS repeated_phrases,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,coach_body_near_duplicate_detected}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,coach_body_near_duplicate_detected}',
      to_jsonb(s)#>>'{metadata,v3_brain,coach_body_near_duplicate_detected}',
      to_jsonb(s)#>>'{metadata,coach_body_near_duplicate_detected}',
      ''
    ) AS coach_body_near_duplicate_detected,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_coach_body_near_duplicate_blocked}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_coach_body_near_duplicate_blocked}',
      to_jsonb(s)#>>'{metadata,v3_brain,daily_coach_body_near_duplicate_blocked}',
      to_jsonb(s)#>>'{metadata,daily_coach_body_near_duplicate_blocked}',
      ''
    ) AS daily_coach_body_near_duplicate_blocked,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_no_send_reason}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_no_send_reason}',
      to_jsonb(s)#>>'{metadata,v3_brain,memory_repeat_no_send_reason}',
      to_jsonb(s)#>>'{metadata,memory_repeat_no_send_reason}',
      ''
    ) AS memory_repeat_no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_repair_skipped_reason}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_repair_skipped_reason}',
      to_jsonb(s)#>>'{metadata,v3_brain,memory_repeat_repair_skipped_reason}',
      to_jsonb(s)#>>'{metadata,memory_repeat_repair_skipped_reason}',
      ''
    ) AS memory_repeat_repair_skipped_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,prior_coach_body_preview}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,prior_coach_body_preview}',
      to_jsonb(s)#>>'{metadata,v3_brain,prior_coach_body_preview}',
      to_jsonb(s)#>>'{metadata,prior_coach_body_preview}',
      ''
    ) AS prior_coach_body_preview,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_guard_reason}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_guard_reason}',
      to_jsonb(s)#>>'{metadata,v3_brain,memory_repeat_guard_reason}',
      to_jsonb(s)#>>'{metadata,memory_repeat_guard_reason}',
      ''
    ) AS memory_repeat_guard_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,repeat_repair_attempted}',
      to_jsonb(s)#>>'{metadata,v3_brain,repeat_repair_attempted}',
      to_jsonb(s)#>>'{metadata,repeat_repair_attempted}',
      ''
    ) AS repeat_repair_attempted,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,writer_prompt_path}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,writer_prompt_path}',
      ''
    ) AS writer_prompt_path,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_writing_brief_used}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_writing_brief_used}',
      ''
    ) AS daily_writing_brief_used,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_praise_allowed_level}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_praise_allowed_level}',
      ''
    ) AS daily_praise_allowed_level,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,unsupported_praise_claim}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,unsupported_praise_claim}',
      ''
    ) AS unsupported_praise_claim,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_unsupported_praise_detected}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_unsupported_praise_detected}',
      ''
    ) AS daily_unsupported_praise_detected,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_repeated_cta_detected}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_repeated_cta_detected}',
      ''
    ) AS daily_repeated_cta_detected,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,repeated_cta_phrase}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,repeated_cta_phrase}',
      ''
    ) AS repeated_cta_phrase,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_fresh_move_guard_blocked}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_fresh_move_guard_blocked}',
      ''
    ) AS daily_fresh_move_guard_blocked,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_writing_brief_build_status}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_writing_brief_build_status}',
      ''
    ) AS daily_writing_brief_build_status,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_writing_brief_skip_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_writing_brief_skip_reason}',
      ''
    ) AS daily_writing_brief_skip_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_suggested_move}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_suggested_move}',
      ''
    ) AS daily_suggested_move,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_suggested_posture}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_suggested_posture}',
      ''
    ) AS daily_suggested_posture,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_suggested_max_questions}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_suggested_max_questions}',
      ''
    ) AS daily_suggested_max_questions,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_suggested_move_reason_preview}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_suggested_move_reason_preview}',
      ''
    ) AS daily_suggested_move_reason_preview,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_brief_thread_floor_message_count}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_brief_thread_floor_message_count}',
      ''
    ) AS daily_brief_thread_floor_message_count,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_brief_thread_extension_message_count}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_brief_thread_extension_message_count}',
      ''
    ) AS daily_brief_thread_extension_message_count,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_brief_thread_oldest_at_local}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_brief_thread_oldest_at_local}',
      ''
    ) AS daily_brief_thread_oldest_at_local,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_brief_thread_newest_at_local}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_brief_thread_newest_at_local}',
      ''
    ) AS daily_brief_thread_newest_at_local,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_freshness_avoid_phrases_preview}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_freshness_avoid_phrases_preview}',
      ''
    ) AS daily_freshness_avoid_phrases_preview,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_open_loop_pending_active}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_open_loop_pending_active}',
      ''
    ) AS daily_open_loop_pending_active,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_open_question_pending}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_open_question_pending}',
      ''
    ) AS daily_open_question_pending,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_satisfied_do_not_repeat_count}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_satisfied_do_not_repeat_count}',
      ''
    ) AS daily_satisfied_do_not_repeat_count,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_goal_evolution_invite_active}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_goal_evolution_invite_active}',
      ''
    ) AS daily_goal_evolution_invite_active,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_pending_plan_active}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_pending_plan_active}',
      ''
    ) AS daily_pending_plan_active,
    COALESCE(to_jsonb(s)->>'status', '') AS status,
    COALESCE(to_jsonb(s)->>'message_sid', to_jsonb(s)->>'outbound_message_sid', to_jsonb(s)#>>'{metadata,message_sid}', '') AS message_sid,
    COALESCE(to_jsonb(s)#>>'{metadata,note}', '') AS note,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,final_body}'), ''),
      ''
    ) AS body_preview,
    to_jsonb(s) AS raw_json
  FROM sms_send_events s
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
classified AS (
  SELECT
    *,
    CASE
      WHEN status ~* '^skipped_(not_fully_on_v2|no_active_commitment|duplicate|tapback|compliance|safety|crisis|invalid_phone|outside_send_window|active_inbound_thread|sunday_weekly_pause)$'
        THEN false
      WHEN no_send_reason ~* '(not.*v2|not_fully_on_v2|no_active_commitment|stopped|unsubscribed|duplicate|tapback|compliance|safety|crisis|invalid_phone|outside_send_window|skipped_not_time|skipped_active_inbound_thread|skipped_sunday_weekly_pause)'
        OR skip_source ~* '(not.*v2|not_fully_on_v2|no_active_commitment|duplicate|tapback|compliance|safety|crisis|active_inbound_thread|outside_send_window|sunday_weekly_pause)'
      THEN false
      ELSE true
    END AS eligible_coaching_row,
    CASE
      WHEN body_preview <> ''
       AND (status ~* '(sent|delivered|queued|success|accepted|sending)' OR message_sid <> '' OR note = 'sent_to_twilio')
       AND no_send_reason = '' AND skip_source = ''
      THEN true
      WHEN body_preview <> ''
       AND (status ~* '(sent|delivered|queued|success|accepted|sending)' OR message_sid <> '' OR note = 'sent_to_twilio')
       AND no_send_reason !~* '(blocked|no_send|stale|memory|freshness|missing|required|compliance|safety|duplicate|tapback|not_fully_on_v2|no_active_commitment|outside_send_window)'
       AND skip_source = ''
      THEN true
      ELSE false
    END AS visible_sent
  FROM send_rows
),
scored AS (
  SELECT
    c.*,
    CASE WHEN c.eligible_coaching_row THEN 'eligible' ELSE 'excluded' END AS eligible_classification,
    COUNT(*) FILTER (WHERE c.eligible_coaching_row AND NOT c.visible_sent) OVER (PARTITION BY c.clerk_user_id) AS user_repeated_no_send_count
  FROM classified c
)
SELECT
  clerk_user_id,
  event_at,
  route_kind,
  no_send_reason,
  skip_source,
  lane_stage,
  LEFT(candidate_body, 1000) AS candidate_body,
  LEFT(memory_repaired_body, 1000) AS memory_repaired_body,
  LEFT(thread_freshness_repaired_body, 1000) AS thread_freshness_repaired_body,
  stale_phrase,
  repeated_phrases,
  coach_body_near_duplicate_detected,
  daily_coach_body_near_duplicate_blocked,
  memory_repeat_no_send_reason,
  memory_repeat_repair_skipped_reason,
  LEFT(prior_coach_body_preview, 500) AS prior_coach_body_preview,
  memory_repeat_guard_reason,
  repeat_repair_attempted,
  writer_prompt_path,
  daily_writing_brief_used,
  daily_praise_allowed_level,
  unsupported_praise_claim,
  daily_unsupported_praise_detected,
  daily_repeated_cta_detected,
  repeated_cta_phrase,
  daily_fresh_move_guard_blocked,
  daily_writing_brief_build_status,
  daily_writing_brief_skip_reason,
  daily_suggested_move,
  daily_suggested_posture,
  daily_suggested_max_questions,
  daily_suggested_move_reason_preview,
  daily_brief_thread_floor_message_count,
  daily_brief_thread_extension_message_count,
  daily_brief_thread_oldest_at_local,
  daily_brief_thread_newest_at_local,
  daily_freshness_avoid_phrases_preview,
  daily_open_loop_pending_active,
  daily_open_question_pending,
  daily_satisfied_do_not_repeat_count,
  daily_goal_evolution_invite_active,
  daily_pending_plan_active,
  user_repeated_no_send_count,
  eligible_classification,
  raw_json
FROM scored
WHERE NOT visible_sent
ORDER BY user_repeated_no_send_count DESC NULLS LAST, event_at DESC;


-- =============================================================================
-- QUERY 04 — memory_stale_thread_freshness
-- Saved query name: SM_AUDIT_04_Memory_Thread_Freshness
-- Purpose: Memory repeat + stale/thread freshness repair diagnostics (Q6+Q7 combined).
-- Default window: last 24 hours
-- MANUAL DATE OVERRIDE (optional — replace bounds lines below):
--   timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
--   timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
-- =============================================================================

WITH bounds AS (
  SELECT
    now() - interval '24 hours' AS window_start,
    now() AS window_end
),
rows AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(s)->>'clerk_user_id', to_jsonb(s)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(
      to_jsonb(s)#>>'{metadata,route_kind}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,route_kind}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_route_kind}',
      ''
    ) AS route_kind,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,lane_stage}',
      to_jsonb(s)#>>'{metadata,lane_stage}',
      ''
    ) AS lane_stage,
    COALESCE(
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      to_jsonb(s)->>'no_send_reason',
      ''
    ) AS no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_repair_skipped_zero_question_mode}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_repair_skipped_zero_question_mode}',
      ''
    ) AS memory_repeat_repair_skipped_zero_question_mode,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_repair_skipped_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_repair_skipped_reason}',
      ''
    ) AS memory_repeat_repair_skipped_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,coach_body_near_duplicate_detected}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,coach_body_near_duplicate_detected}',
      to_jsonb(s)#>>'{metadata,v3_brain,coach_body_near_duplicate_detected}',
      to_jsonb(s)#>>'{metadata,coach_body_near_duplicate_detected}',
      ''
    ) AS coach_body_near_duplicate_detected,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_coach_body_near_duplicate_blocked}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_coach_body_near_duplicate_blocked}',
      to_jsonb(s)#>>'{metadata,v3_brain,daily_coach_body_near_duplicate_blocked}',
      to_jsonb(s)#>>'{metadata,daily_coach_body_near_duplicate_blocked}',
      ''
    ) AS daily_coach_body_near_duplicate_blocked,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_no_send_reason}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_no_send_reason}',
      to_jsonb(s)#>>'{metadata,v3_brain,memory_repeat_no_send_reason}',
      to_jsonb(s)#>>'{metadata,memory_repeat_no_send_reason}',
      ''
    ) AS memory_repeat_no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,prior_coach_body_preview}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,prior_coach_body_preview}',
      to_jsonb(s)#>>'{metadata,v3_brain,prior_coach_body_preview}',
      to_jsonb(s)#>>'{metadata,prior_coach_body_preview}',
      ''
    ) AS prior_coach_body_preview,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_guard_reason}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_guard_reason}',
      to_jsonb(s)#>>'{metadata,v3_brain,memory_repeat_guard_reason}',
      to_jsonb(s)#>>'{metadata,memory_repeat_guard_reason}',
      ''
    ) AS memory_repeat_guard_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,repeat_repair_attempted}',
      to_jsonb(s)#>>'{metadata,v3_brain,repeat_repair_attempted}',
      ''
    ) AS repeat_repair_attempted,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,thread_freshness_repair_succeeded}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,thread_freshness_repair_succeeded}',
      ''
    ) AS thread_freshness_repair_succeeded,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,thread_freshness_violation_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,thread_freshness_violation_reason}',
      ''
    ) AS thread_freshness_violation_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_lane_stale_ask_phrase}',
      to_jsonb(s)#>>'{metadata,daily_lane_stale_ask_phrase}',
      to_jsonb(s)#>>'{metadata,daily_post_fvg_stale_ask_phrase}',
      ''
    ) AS stale_phrase,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,repeated_phrases}',
      to_jsonb(s)#>>'{metadata,repeated_phrases}',
      ''
    ) AS repeated_phrases,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,v3_candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,v3_candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_candidate_body}'), ''),
      ''
    ) AS candidate_body,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_repaired_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,memory_repeat_repaired_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,memory_repeat_repaired_body_preview}'), ''),
      ''
    ) AS memory_repaired_body,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,thread_freshness_repaired_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,thread_freshness_repaired_body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,thread_freshness_repaired_body_preview}'), ''),
      ''
    ) AS thread_freshness_repaired_body,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,body}'), ''),
      ''
    ) AS final_body,
    to_jsonb(s) AS raw_json
  FROM sms_send_events s
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) < b.window_end
)
SELECT
  (event_at AT TIME ZONE 'America/New_York')::date AS local_day,
  event_at,
  clerk_user_id,
  route_kind,
  lane_stage,
  no_send_reason,
  memory_repeat_repair_skipped_zero_question_mode,
  memory_repeat_repair_skipped_reason,
  coach_body_near_duplicate_detected,
  daily_coach_body_near_duplicate_blocked,
  memory_repeat_no_send_reason,
  LEFT(prior_coach_body_preview, 500) AS prior_coach_body_preview,
  memory_repeat_guard_reason,
  repeat_repair_attempted,
  thread_freshness_repair_succeeded,
  thread_freshness_violation_reason,
  stale_phrase,
  repeated_phrases,
  LEFT(candidate_body, 1000) AS candidate_body,
  LEFT(memory_repaired_body, 1000) AS memory_repaired_body,
  LEFT(thread_freshness_repaired_body, 1000) AS thread_freshness_repaired_body,
  LEFT(final_body, 1000) AS final_body,
  (candidate_body ~* '\?|\b(tell me|let me know|reply with|what|how|why|when|did you|do you|will you|can you)\b') AS candidate_question_shape,
  (memory_repaired_body ~* '\?|\b(tell me|let me know|reply with|what|how|why|when|did you|do you|will you|can you)\b') AS memory_repaired_question_shape,
  (final_body ~* '\?|\b(tell me|let me know|reply with|what|how|why|when|did you|do you|will you|can you)\b') AS final_question_shape,
  CASE
    WHEN memory_repeat_no_send_reason = 'coach_body_near_duplicate'
      OR coach_body_near_duplicate_detected ~* 'true'
      OR daily_coach_body_near_duplicate_blocked ~* 'true'
      OR memory_repeat_guard_reason = 'repeated_recent_coach_body'
      THEN 'coach_body_near_duplicate_block'
    WHEN memory_repeat_repair_skipped_zero_question_mode ~* 'true' THEN 'slice2_repair_skipped_zero_question'
    WHEN memory_repeat_repair_skipped_reason = 'repair_disabled_zero_question_mode' THEN 'slice2_direct_no_send'
    WHEN memory_repeat_repair_skipped_reason = 'coach_body_near_duplicate_no_repair' THEN 'coach_body_near_duplicate_block'
    WHEN memory_repaired_body <> '' THEN 'memory_repair_attempted'
    WHEN no_send_reason ~* 'memory|repeat' OR lane_stage ~* 'memory|repeat' THEN 'memory_repeat_blocked'
    WHEN no_send_reason ~* 'stale' OR stale_phrase <> '' THEN 'stale_ask_block'
    WHEN no_send_reason ~* 'freshness' OR thread_freshness_violation_reason <> '' THEN 'thread_freshness_block'
    ELSE 'manual_review'
  END AS diagnostic,
  raw_json
FROM rows
WHERE memory_repeat_repair_skipped_zero_question_mode ~* 'true'
   OR memory_repeat_repair_skipped_reason <> ''
   OR coach_body_near_duplicate_detected ~* 'true'
   OR daily_coach_body_near_duplicate_blocked ~* 'true'
   OR memory_repeat_no_send_reason = 'coach_body_near_duplicate'
   OR memory_repeat_guard_reason = 'repeated_recent_coach_body'
   OR repeat_repair_attempted ~* 'true'
   OR memory_repaired_body <> ''
   OR thread_freshness_repair_succeeded ~* 'true'
   OR thread_freshness_violation_reason <> ''
   OR no_send_reason ~* 'memory|repeat|stale|freshness|thread_memory'
   OR lane_stage ~* 'memory|repeat|stale|freshness'
   OR stale_phrase <> ''
ORDER BY event_at DESC;


-- =============================================================================
-- QUERY 05 — zero_question_hidden_robot_scan
-- Saved query name: SM_AUDIT_05_Language_Scan
-- Purpose: Zero-question, hidden-question, and robot-language scan across daily/weekly/inbound.
-- Default window: last 24 hours
-- MANUAL DATE OVERRIDE (optional — replace bounds lines below):
--   timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
--   timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
-- =============================================================================

WITH bounds AS (
  SELECT
    now() - interval '24 hours' AS window_start,
    now() AS window_end
),
visible AS (
  SELECT
    'daily'::text AS source_table,
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(s)->>'clerk_user_id', to_jsonb(s)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(s)->>'status', '') AS status,
    COALESCE(to_jsonb(s)->>'message_sid', to_jsonb(s)->>'outbound_message_sid', to_jsonb(s)#>>'{metadata,message_sid}', '') AS message_sid,
    COALESCE(to_jsonb(s)#>>'{metadata,note}', '') AS note,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_zero_question_required}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,strategy_card_zero_question_required}',
      ''
    ) AS strategy_card_zero_question_required,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_high_repeat_risk}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,strategy_card_high_repeat_risk}',
      ''
    ) AS strategy_card_high_repeat_risk,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,v3_brain,daily_zero_question_mode_active}',
      ''
    ) AS daily_zero_question_mode_active,
    COALESCE(
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      ''
    ) AS no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,skip_source}',
      to_jsonb(s)#>>'{metadata,voice_send_decision,skip_source}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,skip_source}',
      ''
    ) AS skip_source,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,body}'), ''),
      ''
    ) AS body_preview,
    to_jsonb(s) AS raw_json
  FROM sms_send_events s
  UNION ALL
  SELECT
    'weekly'::text,
    COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ),
    COALESCE(to_jsonb(w)->>'clerk_user_id', to_jsonb(w)#>>'{metadata,clerk_user_id}'),
    COALESCE(to_jsonb(w)->>'status', ''),
    COALESCE(to_jsonb(w)->>'message_sid', to_jsonb(w)->>'outbound_message_sid', to_jsonb(w)#>>'{metadata,message_sid}', ''),
    '',
    '', '', '',
    COALESCE(to_jsonb(w)->>'no_send_reason', to_jsonb(w)#>>'{metadata,no_send_reason}', ''),
    '',
    COALESCE(
      NULLIF(BTRIM(to_jsonb(w)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,north_star_gate,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,north_star_gate,original_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,v3_candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_voice_gate,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_voice_gate,final_body_with_suffix}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_voice_gate,final_voice_gate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,voice_send_decision,north_star_visible_body}'), ''),
      ''
    ),
    to_jsonb(w)
  FROM sms_weekly_send_events w
  UNION ALL
  SELECT
    'inbound_reply'::text,
    COALESCE(
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ),
    COALESCE(to_jsonb(j)->>'clerk_user_id', to_jsonb(j)#>>'{metadata,clerk_user_id}'),
    COALESCE(to_jsonb(j)->>'status', ''),
    COALESCE(to_jsonb(j)->>'outbound_message_sid', to_jsonb(j)->>'message_sid', ''),
    '',
    '', '', '',
    COALESCE(to_jsonb(j)->>'no_send_reason', to_jsonb(j)#>>'{metadata,no_send_reason}', ''),
    '',
    COALESCE(
      NULLIF(BTRIM(to_jsonb(j)->>'reply_body'), ''),
      NULLIF(BTRIM(to_jsonb(j)#>>'{metadata,reply_body}'), ''),
      ''
    ),
    to_jsonb(j)
  FROM sms_inbound_coach_jobs j
),
classified AS (
  SELECT
    v.*,
    CASE
      WHEN v.source_table = 'inbound_reply'
       AND v.body_preview <> ''
       AND v.status ~* 'sent'
       AND v.message_sid <> ''
      THEN true
      WHEN v.body_preview <> ''
       AND (v.status ~* '(sent|delivered|queued|success|accepted|sending)' OR v.message_sid <> '' OR v.note = 'sent_to_twilio')
       AND v.no_send_reason = '' AND v.skip_source = ''
      THEN true
      WHEN v.body_preview <> ''
       AND (v.status ~* '(sent|delivered|queued|success|accepted|sending)' OR v.message_sid <> '' OR v.note = 'sent_to_twilio')
       AND v.no_send_reason !~* '(blocked|no_send|stale|memory|freshness|missing|required|compliance|safety|duplicate|tapback)'
       AND v.skip_source = ''
      THEN true
      ELSE false
    END AS visible_sent
  FROM visible v
),
scanned AS (
  SELECT
    c.*,
    CASE
      WHEN c.visible_sent
       AND c.body_preview <> ''
       AND (
         c.strategy_card_zero_question_required ~* 'true'
         OR c.strategy_card_high_repeat_risk ~* 'true'
         OR c.daily_zero_question_mode_active ~* 'true'
       )
       AND (
         c.body_preview LIKE '%?%'
         OR c.body_preview ~* '\b(tell me|let me know|reply with|name the blocker|choose one|send me|what|how|why|when|did you|do you|will you|can you|first step|next step|what evidence|what proof|what got in the way|did it happen|how did it go)\b'
       )
      THEN CASE
        WHEN c.body_preview LIKE '%?%' THEN 'question_mark_violation'
        WHEN c.body_preview ~* '\b(tell me|let me know|reply with|name the blocker|choose one|send me)\b' THEN 'hidden_question_command'
        ELSE 'question_cousin_review'
      END
      ELSE NULL
    END AS zero_question_compliance,
    CASE
      WHEN c.visible_sent
       AND c.body_preview ~* '\b(tell me|let me know|reply with|name the blocker|choose one|send me|what''s|what is|how|why|when|did you|do you|will you|can you|first step|next step|what evidence|what proof|what got in the way|did it happen|how did it go)\b|\?'
      THEN CASE
        WHEN c.body_preview ~* '\btell me\b' THEN 'tell_me'
        WHEN c.body_preview ~* '\blet me know\b' THEN 'let_me_know'
        WHEN c.body_preview ~* '\breply with\b' THEN 'reply_with'
        WHEN c.body_preview ~* '\bname the blocker\b' THEN 'name_the_blocker'
        WHEN c.body_preview ~* '\bchoose one\b' THEN 'choose_one'
        WHEN c.body_preview ~* '\bsend me\b' THEN 'send_me'
        WHEN c.body_preview ~* '\?' THEN 'question_mark'
        ELSE 'question_cousin_review'
      END
      ELSE NULL
    END AS hidden_question_family,
    CASE
      WHEN c.visible_sent
       AND c.body_preview ~* '(recommit|would you like to recommit|same line for a week|reply yes|reply no|text yes|text no|did you hit|did you do|did you complete|streak|badge|scoreboard|xp|points|as an ai|strategy card|relationship packet|internal|template|fallback|accountability bot|what can you tell me about|press|menu|checkbox|habit tracker)'
      THEN CASE
        WHEN c.body_preview ~* '(recommit|would you like to recommit|same line for a week|hold you to the same line)' THEN 'recommit_robot'
        WHEN c.body_preview ~* '(reply yes|reply no|reply stop|reply help|text yes|text no)' THEN 'menu_reply_language'
        WHEN c.body_preview ~* '(did you hit|did you do|did you complete).{0,30}(goal|commitment|today)' THEN 'daily_checkbox_language'
        WHEN c.body_preview ~* '(streak|badge|scoreboard|xp|points)' THEN 'gamified_language'
        WHEN c.body_preview ~* '(as an ai|strategy card|relationship packet|internal|template|fallback|accountability bot)' THEN 'internal_language'
        ELSE 'robotic_question'
      END
      ELSE NULL
    END AS robot_family,
    CASE
      WHEN c.visible_sent
       AND c.body_preview ~* '(hour.{0,30}distribution|distribution.{0,30}hour|another hour.{0,30}focused work|timer.{0,20}gentle sound|gentle sound.{0,20}timer|minutes.{0,30}morning|wake.{0,30}snooz)'
      THEN CASE
        WHEN c.body_preview ~* 'hour.{0,30}distribution' THEN 'hour_distribution_cta'
        WHEN c.body_preview ~* 'another hour.{0,30}focused work' THEN 'another_hour_focused'
        WHEN c.body_preview ~* 'timer.{0,20}gentle sound|gentle sound.{0,20}timer' THEN 'timer_gentle_sound'
        WHEN c.body_preview ~* 'wake.{0,30}snooz' THEN 'wake_without_snooze'
        WHEN c.body_preview ~* 'minutes.{0,30}morning' THEN 'morning_minutes'
        ELSE 'visible_repeated_cta_review'
      END
      ELSE NULL
    END AS repeated_cta_family
  FROM classified c
)
SELECT
  (event_at AT TIME ZONE 'America/New_York')::date AS local_day,
  event_at,
  source_table,
  clerk_user_id,
  body_preview,
  strategy_card_zero_question_required,
  strategy_card_high_repeat_risk,
  daily_zero_question_mode_active,
  zero_question_compliance,
  hidden_question_family,
  robot_family,
  repeated_cta_family,
  raw_json
FROM scanned s
CROSS JOIN bounds b
WHERE s.event_at >= b.window_start
  AND s.event_at < b.window_end
  AND s.visible_sent
  AND s.body_preview <> ''
  AND (s.zero_question_compliance IS NOT NULL OR s.hidden_question_family IS NOT NULL OR s.robot_family IS NOT NULL OR s.repeated_cta_family IS NOT NULL)
ORDER BY event_at DESC;


-- =============================================================================
-- QUERY 06 — inbound_pairing_truth_continuity
-- Saved query name: SM_AUDIT_06_Inbound_Pairing
-- Purpose: Inbound pairing, ghosting, and truth-continuity flags from job metadata.
-- Default window: last 24 hours
-- MANUAL DATE OVERRIDE (optional — replace bounds lines below):
--   timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
--   timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
-- =============================================================================

WITH bounds AS (
  SELECT
    now() - interval '24 hours' AS window_start,
    now() AS window_end
),
inbounds AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz
    ) AS inbound_at,
    COALESCE(to_jsonb(m)->>'clerk_user_id', to_jsonb(m)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(m)->>'message_sid', to_jsonb(m)#>>'{metadata,message_sid}') AS message_sid,
    LEFT(COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''),
      NULLIF(BTRIM(to_jsonb(m)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(m)#>>'{metadata,raw_body}'), ''),
      ''
    ), 1200) AS inbound_body,
    to_jsonb(m) AS raw_inbound_json
  FROM sms_inbound_messages m
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz
    ) < b.window_end
),
jobs_raw AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) AS job_at,
    COALESCE(to_jsonb(j)->>'clerk_user_id', to_jsonb(j)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(j)->>'message_sid', to_jsonb(j)->>'inbound_message_sid', to_jsonb(j)#>>'{metadata,inbound_message_sid}') AS inbound_message_sid,
    COALESCE(to_jsonb(j)->>'status', '') AS status,
    LEFT(COALESCE(
      NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''),
      NULLIF(BTRIM(to_jsonb(j)#>>'{metadata,raw_body}'), ''),
      ''
    ), 1200) AS job_raw_body,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(j)->>'reply_body'), ''),
      NULLIF(BTRIM(to_jsonb(j)#>>'{metadata,reply_body}'), ''),
      ''
    ) AS reply_body,
    COALESCE(to_jsonb(j)->>'last_error', '') AS last_error_raw,
    COALESCE(to_jsonb(j)#>>'{metadata,route_purpose}', to_jsonb(j)#>>'{metadata,branch_name}', '') AS route_or_branch,
    to_jsonb(j) AS raw_job_json
  FROM sms_inbound_coach_jobs j
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) >= b.window_start - interval '1 hour'
    AND COALESCE(
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) < b.window_end + interval '1 hour'
),
jobs AS (
  SELECT
    j.*,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(j.raw_job_json)->>'no_send_reason'), ''),
      NULLIF(BTRIM(j.raw_job_json#>>'{metadata,no_send_reason}'), ''),
      NULLIF(BTRIM((regexp_match(j.last_error_raw, '"no_send_reason"\s*:\s*"([^"]+)"'))[1]), ''),
      NULLIF(BTRIM((regexp_match(j.last_error_raw, '"inbound_reply_no_send_reason"\s*:\s*"([^"]+)"'))[1]), ''),
      NULLIF(BTRIM((regexp_match(j.last_error_raw, '"lane_no_send_reason"\s*:\s*"([^"]+)"'))[1]), ''),
      NULLIF(BTRIM((regexp_match(j.last_error_raw, '"unified_final_guard_no_send_reason"\s*:\s*"([^"]+)"'))[1]), ''),
      NULLIF(BTRIM((regexp_match(j.last_error_raw, '"tag"\s*:\s*"([^"]+)"'))[1]), ''),
      ''
    ) AS actual_job_no_send_reason,
    COALESCE(
      NULLIF(BTRIM((regexp_match(j.last_error_raw, '"tag"\s*:\s*"([^"]+)"'))[1]), ''),
      ''
    ) AS actual_job_no_send_tag,
    COALESCE(
      NULLIF(BTRIM(j.raw_job_json#>>'{metadata,inbound_required_reply_move}'), ''),
      NULLIF(BTRIM(j.raw_job_json#>>'{metadata,v3_inbound_lane,inbound_required_reply_move}'), ''),
      NULLIF(BTRIM((regexp_match(j.last_error_raw, '"inbound_required_reply_move"\s*:\s*"([^"]+)"'))[1]), ''),
      ''
    ) AS inbound_required_reply_move,
    COALESCE(
      NULLIF(BTRIM(j.raw_job_json#>>'{metadata,inbound_resolved_outcome}'), ''),
      NULLIF(BTRIM(j.raw_job_json#>>'{metadata,v3_inbound_lane,inbound_resolved_outcome}'), ''),
      NULLIF(BTRIM((regexp_match(j.last_error_raw, '"inbound_resolved_outcome"\s*:\s*"([^"]+)"'))[1]), ''),
      ''
    ) AS inbound_resolved_outcome,
    COALESCE(
      NULLIF(BTRIM(j.raw_job_json#>>'{metadata,inbound_resolved_temporal_scope}'), ''),
      NULLIF(BTRIM(j.raw_job_json#>>'{metadata,v3_inbound_lane,inbound_resolved_temporal_scope}'), ''),
      NULLIF(BTRIM((regexp_match(j.last_error_raw, '"inbound_resolved_temporal_scope"\s*:\s*"([^"]+)"'))[1]), ''),
      ''
    ) AS inbound_resolved_temporal_scope,
    COALESCE(
      NULLIF(BTRIM(j.raw_job_json#>>'{metadata,inbound_truth_max_questions_override}'), ''),
      NULLIF(BTRIM(j.raw_job_json#>>'{metadata,v3_inbound_lane,inbound_truth_max_questions_override}'), ''),
      NULLIF(BTRIM((regexp_match(j.last_error_raw, '"inbound_truth_max_questions_override"\s*:\s*"([^"]+)"'))[1]), ''),
      ''
    ) AS inbound_truth_max_questions_override,
    COALESCE(
      NULLIF(BTRIM(j.raw_job_json#>>'{metadata,inbound_truth_guardrails_applied}'), ''),
      NULLIF(BTRIM((regexp_match(j.last_error_raw, '"inbound_truth_guardrails_applied"\s*:\s*"([^"]+)"'))[1]), ''),
      ''
    ) AS inbound_truth_guardrails_applied,
    COALESCE(
      NULLIF(BTRIM(j.raw_job_json#>>'{metadata,inbound_resolved_truth_emitted}'), ''),
      NULLIF(BTRIM((regexp_match(j.last_error_raw, '"inbound_resolved_truth_emitted"\s*:\s*"([^"]+)"'))[1]), ''),
      ''
    ) AS inbound_resolved_truth_emitted
  FROM jobs_raw j
),
paired AS (
  SELECT
    i.inbound_at,
    i.clerk_user_id,
    i.message_sid,
    i.inbound_body,
    j.job_at,
    j.status AS job_status,
    j.route_or_branch,
    j.actual_job_no_send_reason,
    j.actual_job_no_send_tag,
    j.reply_body,
    j.inbound_required_reply_move,
    j.inbound_resolved_outcome,
    j.inbound_resolved_temporal_scope,
    j.inbound_truth_max_questions_override,
    j.inbound_truth_guardrails_applied,
    j.inbound_resolved_truth_emitted,
    j.pairing_quality,
    i.raw_inbound_json,
    j.raw_job_json
  FROM inbounds i
  LEFT JOIN LATERAL (
    SELECT j2.*,
      CASE
        WHEN j2.inbound_message_sid = i.message_sid THEN 1
        WHEN j2.clerk_user_id = i.clerk_user_id AND BTRIM(j2.job_raw_body) = BTRIM(i.inbound_body) AND BTRIM(i.inbound_body) <> '' THEN 2
        WHEN j2.clerk_user_id = i.clerk_user_id
          AND j2.job_at >= i.inbound_at
          AND j2.job_at <= i.inbound_at + interval '60 minutes' THEN 3
        ELSE 99
      END AS pairing_rank,
      CASE
        WHEN j2.inbound_message_sid = i.message_sid THEN 'exact_message_sid'
        WHEN j2.clerk_user_id = i.clerk_user_id AND BTRIM(j2.job_raw_body) = BTRIM(i.inbound_body) AND BTRIM(i.inbound_body) <> '' THEN 'exact_raw_body'
        WHEN j2.clerk_user_id = i.clerk_user_id
          AND j2.job_at >= i.inbound_at
          AND j2.job_at <= i.inbound_at + interval '60 minutes' THEN 'nearest_future_same_user'
        ELSE 'no_job_found'
      END AS pairing_quality
    FROM jobs j2
    WHERE j2.inbound_message_sid = i.message_sid
       OR (j2.clerk_user_id = i.clerk_user_id AND BTRIM(j2.job_raw_body) = BTRIM(i.inbound_body) AND BTRIM(i.inbound_body) <> '')
       OR (j2.clerk_user_id = i.clerk_user_id AND j2.job_at >= i.inbound_at AND j2.job_at <= i.inbound_at + interval '60 minutes')
    ORDER BY pairing_rank ASC, j2.job_at ASC
    LIMIT 1
  ) j ON true
),
paired_with_telemetry AS (
  SELECT
    p.*,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_required_reply_move'), ''),
      p.inbound_required_reply_move
    ) AS inbound_required_reply_move_resolved,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_resolved_outcome'), ''),
      p.inbound_resolved_outcome
    ) AS inbound_resolved_outcome_resolved,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_truth_max_questions_override'), ''),
      p.inbound_truth_max_questions_override
    ) AS inbound_truth_max_questions_override_resolved,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_resolved_truth_emitted'), ''),
      p.inbound_resolved_truth_emitted
    ) AS inbound_resolved_truth_emitted_resolved
  FROM paired p
  LEFT JOIN LATERAL (
    SELECT e.payload_json
    FROM v2_commitment_event e
    WHERE e.event_type = 'sms_memory_signal'
      AND e.payload_json->>'inbound_turn_telemetry' = 'true'
      AND COALESCE(
        NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
        SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
      ) = p.message_sid
    ORDER BY e.occurred_at DESC
    LIMIT 1
  ) tel ON TRUE
),
flagged AS (
  SELECT
    p.*,
    (p.job_status ~* 'sent' AND COALESCE(p.reply_body, '') <> '') AS reply_sent,
    (p.pairing_quality IS NOT NULL AND p.pairing_quality <> 'no_job_found'
      AND (p.job_status IS NULL OR p.job_status !~* 'sent' OR COALESCE(p.reply_body, '') = '')
      AND LENGTH(BTRIM(p.inbound_body)) > 40) AS meaningful_inbound_no_reply,
    (
      p.inbound_body ~* '(got my|got it done|hit the goal|completed|finished|ran this morning|miles done|knocked out|done this morning|did it)'
      AND COALESCE(p.reply_body, '') ~* '(what.*plan|first step|next step|will you|going to|how will you|plan.*today|before today ends)'
    ) AS completion_got_planning_reply,
    (
      p.inbound_body ~* '(i''?ll|i will|tomorrow|going to run|planning to|gonna run|before breakfast|after work)'
      AND COALESCE(p.reply_body, '') ~* '(did you hit|did you do|did you complete|outcome|proof|how did it go|what did you|hit your goal|did it happen)'
    ) AS future_plan_got_outcome_question,
    (
      p.inbound_body ~* '(got my|got it done|hit the goal|completed|finished|did it|miles done)'
      AND COALESCE(p.reply_body, '') ~* '(proof|evidence|what did you actually|show me|how did it go|did it happen|what happened|what proof)'
    ) AS evidence_reasked,
    (
      (p.job_status ~* 'cancelled' AND p.inbound_body ~* '(no real challenge|no challenges|it was great|no problem|went well|all good)')
      OR (COALESCE(p.reply_body, '') ~* '(what made it difficult|what challenges|what got in the way)' AND p.inbound_body ~* '(no real challenge|no challenges|it was great|no problem)')
      OR (COALESCE(p.reply_body, '') ~* '(strategies|what else|another approach)' AND p.inbound_body ~* '(plan|strategy|already|will )')
    ) AS contradiction_risk,
    (
      p.job_status ~* 'cancelled'
      AND (
        COALESCE(p.inbound_resolved_truth_emitted_resolved, '') ~* 'true'
        OR COALESCE(p.inbound_required_reply_move_resolved, '') <> ''
      )
      AND COALESCE(p.inbound_resolved_outcome_resolved, '') IN ('user_yes', 'user_no', 'user_partial', 'completion', 'miss', 'partial')
    ) AS cancelled_with_truth_expected
  FROM paired_with_telemetry p
)
SELECT
  (inbound_at AT TIME ZONE 'America/New_York')::date AS local_day,
  inbound_at AS user_inbound_event_at,
  clerk_user_id,
  message_sid,
  inbound_body,
  job_at AS coach_job_event_at,
  job_status,
  route_or_branch,
  COALESCE(actual_job_no_send_reason, '') AS no_send_reason,
  actual_job_no_send_tag,
  pairing_quality,
  LEFT(COALESCE(reply_body, ''), 1200) AS reply_body,
  inbound_required_reply_move_resolved AS inbound_required_reply_move,
  inbound_resolved_outcome_resolved AS inbound_resolved_outcome,
  inbound_resolved_temporal_scope,
  inbound_truth_max_questions_override_resolved AS inbound_truth_max_questions_override,
  inbound_truth_guardrails_applied,
  inbound_resolved_truth_emitted_resolved AS inbound_resolved_truth_emitted,
  reply_sent,
  meaningful_inbound_no_reply,
  completion_got_planning_reply,
  future_plan_got_outcome_question,
  evidence_reasked,
  contradiction_risk,
  cancelled_with_truth_expected,
  raw_inbound_json,
  raw_job_json
FROM flagged
WHERE reply_sent
   OR meaningful_inbound_no_reply
   OR completion_got_planning_reply
   OR future_plan_got_outcome_question
   OR evidence_reasked
   OR contradiction_risk
   OR cancelled_with_truth_expected
   OR pairing_quality IS NULL
   OR pairing_quality = 'no_job_found'
ORDER BY inbound_at DESC;


-- =============================================================================
-- QUERY 07 — truth_spine_outcome_certification
-- Saved query name: SM_AUDIT_07_Truth_Spine_Cert
-- Purpose: Simplified truth-spine outcome certification per inbound SMS.
-- Default window: last 24 hours
-- MANUAL DATE OVERRIDE (optional — replace bounds lines below):
--   timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
--   timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
-- =============================================================================

WITH bounds AS (
  SELECT
    now() - interval '24 hours' AS window_start,
    now() AS window_end,
    now() - interval '7 days' AS known_fix_cutover_at_user_yes,
    now() - interval '7 days' AS known_fix_cutover_at_meta_process,
    now() - interval '7 days' AS known_fix_cutover_at_weekly_miss_count
),
inbound_base AS (
  SELECT
    COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')
    ) AS inbound_message_sid,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'clerk_user_id'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'clerk_user_id'), '')
    ) AS clerk_user_id,
    COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) AS inbound_at,
    LEFT(
      COALESCE(
        NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''),
        NULLIF(BTRIM(to_jsonb(m)->>'body'), ''),
        NULLIF(BTRIM(to_jsonb(m)->>'message_body'), ''),
        NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''),
        ''
      ),
      280
    ) AS inbound_body_preview,
    to_jsonb(m) AS raw_inbound_json,
    to_jsonb(j) AS raw_job_json
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j
    ON j.message_sid = to_jsonb(m)->>'message_sid'
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) < b.window_end
    AND COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')
    ) IS NOT NULL
),
classified_inbound AS (
  SELECT
    ib.inbound_message_sid,
    ib.clerk_user_id,
    ib.inbound_at,
    (ib.inbound_at AT TIME ZONE 'America/New_York')::date AS local_day,
    ib.inbound_body_preview,
    CASE
      WHEN ib.inbound_body_preview ~* '(^|\s)(stop|unsubscribe|help|start)\b' THEN 'safety_or_support_candidate'
      WHEN ib.inbound_body_preview ~* '(onboarding|didn''?t ask me|did not ask me|did the onboarding matter|you didn''?t ask|coach forgot|process dispute|you said.*didn''?t)' THEN 'meta_process_candidate'
      WHEN ib.inbound_body_preview ~* '(amend|re-?state|restated?)\s+(the\s+)?(old\s+)?goals?|reset\s+(the\s+)?(old\s+)?goals?|old\s+goals?|revise\s+(the\s+)?goals?|update\s+(the\s+)?goals?|adjust\s+(the\s+)?goals?|alter\s+(the\s+)?goals?|change\s+(the\s+)?goals?|change\s+my\s+goal|new\s+goal|different\s+goal|goal\s+no\s+longer\s+fits|ready\s+for\s+a\s+new\s+goal|raise\s+the\s+bar|lower\s+the\s+bar|shrink\s+the\s+goal|make\s+it\s+(easier|harder)|replace.*goal|adjust\s+my\s+goal|need\s+to\s+amend|re-?state\s+old\s+goals?' THEN 'goal_change_candidate'
      WHEN ib.inbound_body_preview ~* '(got in the way|threw me off|blocker|rain|meetings|forgot my shoes|travel|sick|kids)' THEN 'blocker_candidate'
      WHEN ib.inbound_body_preview ~* '(i''?ll|i will|tomorrow|before breakfast|after work|setting my shoes|planning to|going to run|gonna run)' THEN 'plan_candidate'
      WHEN ib.inbound_body_preview ~* '(only did|half|started but didn''?t|did \d+ of \d+|some of it|part of it)' THEN 'partial_candidate'
      WHEN ib.inbound_body_preview ~* '(missed|didn''?t happen|did not happen|skipped|couldn''?t get|no run today|blew it|didn''?t hit)'
        AND ib.inbound_body_preview !~* '(didn''?t ask|onboarding matter)' THEN 'miss_candidate'
      WHEN ib.inbound_body_preview ~* '(got my|got it done|hit the goal|completed|finished|got my run in|ran this morning|miles done|steps today|knocked out|done this morning|did it)'
        AND ib.inbound_body_preview !~* '(should still|going to|tomorrow|plan to|gonna)' THEN 'completion_candidate'
      WHEN ib.inbound_body_preview ~* '(discouraged|struggling|overwhelmed|anxious|depressed|frustrated)' THEN 'emotional_state_candidate'
      WHEN ib.inbound_body_preview ~* '(my (wife|husband|mom|dad|daughter|son)|important person|identity)' THEN 'important_memory_candidate'
      ELSE 'other'
    END AS candidate_family,
    CASE
      WHEN ib.inbound_at < LEAST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'pre_known_fix_window'
      WHEN ib.inbound_at >= GREATEST(b.known_fix_cutover_at_user_yes, b.known_fix_cutover_at_meta_process, b.known_fix_cutover_at_weekly_miss_count) THEN 'post_known_fix_window'
      ELSE 'unknown_fix_era'
    END AS fix_era,
    CASE
      WHEN ib.inbound_body_preview ILIKE '%got my distribution done today%' AND ib.inbound_body_preview ILIKE '%hit the goal%' THEN 'distribution_completion'
      WHEN ib.inbound_body_preview ~* '10[,]?000 steps today' THEN 'steps_completion'
      WHEN ib.inbound_body_preview ILIKE '%onboarding%' AND ib.inbound_body_preview ~* 'didn''?t ask' THEN 'onboarding_meta_dispute'
      WHEN ib.inbound_body_preview ~* '(going to run tomorrow|tomorrow i''?ll get it done)' THEN 'future_plan_negative'
      ELSE NULL
    END AS is_known_historical_fixture,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), ''),
      NULLIF(BTRIM(tel.payload_json->'inbound_meaning'->>'persistence_decision'), '')
    ) AS persistence_decision,
    NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), '') AS server_reconciled_persistence_decision,
    COALESCE(sp.persisted_user_yes, FALSE) AS persisted_user_yes,
    COALESCE(sp.persisted_user_no, FALSE) AS persisted_user_no,
    COALESCE(sp.persisted_user_partial, FALSE) AS persisted_user_partial,
    CASE
      WHEN COALESCE(
        NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
        NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
      ) IN ('write_user_yes_today', 'write_user_yes') THEN 'write_user_yes'
      WHEN COALESCE(
        NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
        NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
      ) = 'write_user_no' THEN 'write_user_no'
      WHEN COALESCE(
        NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
        NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
      ) = 'write_user_partial' THEN 'write_user_partial'
      WHEN COALESCE(
        NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
        NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
      ) IN ('no_outcome_write', 'ack_only', 'defer_to_pending_resolution', 'defer_to_contract_consent') THEN 'no_outcome_write'
      WHEN ib.inbound_body_preview ~* '(onboarding|didn''?t ask me|did the onboarding matter)' THEN 'no_outcome_write'
      WHEN ib.inbound_body_preview ~* '(amend|re-?state|restated?)\s+(the\s+)?(old\s+)?goals?|reset\s+(the\s+)?(old\s+)?goals?|old\s+goals?|revise\s+(the\s+)?goals?|update\s+(the\s+)?goals?|adjust\s+(the\s+)?goals?|alter\s+(the\s+)?goals?|change\s+(the\s+)?goals?|change\s+my\s+goal|new\s+goal|different\s+goal|goal\s+no\s+longer\s+fits|ready\s+for\s+a\s+new\s+goal|raise\s+the\s+bar|lower\s+the\s+bar|shrink\s+the\s+goal|make\s+it\s+(easier|harder)|replace.*goal|adjust\s+my\s+goal|need\s+to\s+amend|re-?state\s+old\s+goals?' THEN 'no_outcome_write'
      WHEN ib.inbound_body_preview ~* '(i''?ll|i will|tomorrow|going to run|planning to)' THEN 'no_outcome_write'
      WHEN COALESCE(
        NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
        NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), '')
      ) IS NULL THEN 'unknown'
      ELSE 'unknown'
    END AS expected_persistence_decision
  FROM inbound_base ib
  CROSS JOIN bounds b
  LEFT JOIN LATERAL (
    SELECT e.payload_json
    FROM v2_commitment_event e
    WHERE e.event_type = 'sms_memory_signal'
      AND e.payload_json->>'inbound_turn_telemetry' = 'true'
      AND COALESCE(
        NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
        SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
      ) = ib.inbound_message_sid
    ORDER BY e.occurred_at DESC
    LIMIT 1
  ) tel ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      BOOL_OR(ev.event_type = 'user_yes') AS persisted_user_yes,
      BOOL_OR(ev.event_type = 'user_no') AS persisted_user_no,
      BOOL_OR(ev.event_type = 'user_partial') AS persisted_user_partial
    FROM v2_commitment_event ev
    WHERE COALESCE(
      NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(ev.payload_json->>'inbound_resolution_message_sid'), ''),
      SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) = ib.inbound_message_sid
  ) sp ON TRUE
),
classified_with_diag AS (
  SELECT
    c.*,
    CASE
      WHEN c.fix_era = 'pre_known_fix_window' AND c.is_known_historical_fixture IS NOT NULL THEN 'historical_pre_fix_observation'
      WHEN c.candidate_family IN ('meta_process_candidate', 'plan_candidate', 'safety_or_support_candidate', 'goal_change_candidate')
        AND (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'false_outcome_written'
      WHEN c.persistence_decision IS NULL AND c.server_reconciled_persistence_decision IS NULL
        AND c.candidate_family NOT IN ('other', 'emotional_state_candidate', 'important_memory_candidate') THEN 'telemetry_missing'
      WHEN c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial THEN 'outcome_written_ok'
      WHEN c.expected_persistence_decision IN ('write_user_yes', 'write_user_no', 'write_user_partial')
        AND c.fix_era = 'post_known_fix_window'
        AND NOT (
          (c.expected_persistence_decision = 'write_user_yes' AND c.persisted_user_yes)
          OR (c.expected_persistence_decision = 'write_user_no' AND c.persisted_user_no)
          OR (c.expected_persistence_decision = 'write_user_partial' AND c.persisted_user_partial)
        ) THEN 'expected_write_but_missing'
      WHEN c.expected_persistence_decision = 'no_outcome_write'
        AND NOT (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'server_no_outcome_expected'
      WHEN c.candidate_family = 'other' THEN 'regex_weak_manual_review'
      WHEN c.expected_persistence_decision = 'unknown' THEN 'cert_join_uncertain'
      ELSE 'cert_join_uncertain'
    END AS cert_diagnostic,
    CASE
      WHEN c.candidate_family = 'other' THEN 'regex_family_uncertain_review_body'
      WHEN c.persistence_decision IS NULL AND c.server_reconciled_persistence_decision IS NULL THEN 'missing_turn_telemetry'
      WHEN c.candidate_family = 'plan_candidate' THEN 'plan_manual_review_expected_no_outcome_proof'
      ELSE NULL
    END AS needs_human_review_reason
  FROM classified_inbound c
)
SELECT
  local_day,
  inbound_at,
  clerk_user_id,
  inbound_message_sid,
  inbound_body_preview,
  candidate_family,
  expected_persistence_decision,
  cert_diagnostic,
  fix_era,
  needs_human_review_reason,
  persisted_user_yes,
  persisted_user_no,
  persisted_user_partial,
  is_known_historical_fixture
FROM classified_with_diag
ORDER BY inbound_at DESC, clerk_user_id;


-- =============================================================================
-- QUERY 08 — no_send_truth_loss_persistence_timing
-- Saved query name: SM_AUDIT_08_NoSend_Truth_Loss
-- Purpose: Inbound no-send truth persistence timing — expected write vs spine, v2 persist telemetry.
-- Default window: last 24 hours
-- MANUAL DATE OVERRIDE (optional — replace bounds lines below):
--   timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
--   timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
-- =============================================================================

WITH bounds AS (
  SELECT
    now() - interval '24 hours' AS window_start,
    now() AS window_end
),
inbound_base AS (
  SELECT
    COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')
    ) AS message_sid,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'clerk_user_id'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'clerk_user_id'), '')
    ) AS clerk_user_id,
    COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) AS inbound_at,
    LEFT(
      COALESCE(
        NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''),
        NULLIF(BTRIM(to_jsonb(m)->>'body'), ''),
        NULLIF(BTRIM(to_jsonb(m)->>'message_body'), ''),
        NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''),
        ''
      ),
      280
    ) AS inbound_body_preview,
    COALESCE(to_jsonb(j)->>'status', '') AS job_status,
    COALESCE(to_jsonb(j)->>'last_error', '') AS last_error_raw
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j
    ON j.message_sid = to_jsonb(m)->>'message_sid'
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) < b.window_end
    AND COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')
    ) IS NOT NULL
),
job_extracted AS (
  SELECT
    ib.*,
    COALESCE(
      NULLIF(BTRIM((regexp_match(ib.last_error_raw, '"no_send_reason"\s*:\s*"([^"]+)"'))[1]), ''),
      NULLIF(BTRIM((regexp_match(ib.last_error_raw, '"inbound_reply_no_send_reason"\s*:\s*"([^"]+)"'))[1]), ''),
      NULLIF(BTRIM((regexp_match(ib.last_error_raw, '"lane_no_send_reason"\s*:\s*"([^"]+)"'))[1]), ''),
      NULLIF(BTRIM((regexp_match(ib.last_error_raw, '"unified_final_guard_no_send_reason"\s*:\s*"([^"]+)"'))[1]), ''),
      ''
    ) AS actual_job_no_send_reason,
    (ib.job_status ~* 'cancelled') AS job_is_cancelled_no_send
  FROM inbound_base ib
),
enriched AS (
  SELECT
    je.*,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), ''),
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), ''),
      NULLIF(BTRIM(tel.payload_json->>'persistence_decision_at_no_send'), ''),
      NULLIF(BTRIM(outcome.payload_json->>'inbound_meaning_persistence'), '')
    ) AS expected_write,
    COALESCE(
      NULLIF(BTRIM(je.actual_job_no_send_reason), ''),
      NULLIF(BTRIM(tel.payload_json->>'no_send_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->>'unified_final_guard_no_send_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_reply_no_send_reason'), ''),
      NULLIF(BTRIM(tel.payload_json->>'inbound_reply_no_send_reason'), ''),
      NULLIF(BTRIM((regexp_match(je.last_error_raw, '"inbound_reply_no_send_reason"\s*:\s*"([^"]+)"'))[1]), ''),
      ''
    ) AS no_send_reason_resolved,
    COALESCE(
      (tel.payload_json->>'inbound_truth_persist_attempted_before_writer')::boolean,
      COALESCE((regexp_match(je.last_error_raw, '"inbound_truth_persist_attempted_before_writer"\s*:\s*(true|false)'))[1] = 'true', FALSE),
      (outcome.payload_json->>'inbound_truth_persist_attempted_before_writer')::boolean,
      FALSE
    ) AS persist_attempted_before_writer,
    COALESCE(
      (tel.payload_json->>'inbound_truth_persist_attempted_on_no_send')::boolean,
      COALESCE((regexp_match(je.last_error_raw, '"inbound_truth_persist_attempted_on_no_send"\s*:\s*(true|false)'))[1] = 'true', FALSE),
      (outcome.payload_json->>'inbound_truth_persist_attempted_on_no_send')::boolean,
      FALSE
    ) AS persist_attempted_on_no_send,
    COALESCE(
      (tel.payload_json->>'inbound_truth_persist_succeeded_before_writer')::boolean,
      COALESCE((regexp_match(je.last_error_raw, '"inbound_truth_persist_succeeded_before_writer"\s*:\s*(true|false)'))[1] = 'true', FALSE),
      (outcome.payload_json->>'inbound_truth_persist_succeeded_before_writer')::boolean,
      FALSE
    ) AS persist_succeeded_before_writer,
    COALESCE(
      (tel.payload_json->>'inbound_truth_persist_succeeded_on_no_send')::boolean,
      COALESCE((regexp_match(je.last_error_raw, '"inbound_truth_persist_succeeded_on_no_send"\s*:\s*(true|false)'))[1] = 'true', FALSE),
      (outcome.payload_json->>'inbound_truth_persist_succeeded_on_no_send')::boolean,
      FALSE
    ) AS persist_succeeded_on_no_send,
    COALESCE(sp.persisted_user_yes, FALSE) AS persisted_user_yes,
    COALESCE(sp.persisted_user_no, FALSE) AS persisted_user_no,
    COALESCE(sp.persisted_user_partial, FALSE) AS persisted_user_partial,
    COALESCE(sp.any_truth_row, FALSE) AS any_truth_row,
    to_jsonb(tel.payload_json) AS raw_telemetry_json
  FROM job_extracted je
  LEFT JOIN LATERAL (
    SELECT e.payload_json
    FROM v2_commitment_event e
    WHERE e.event_type = 'sms_memory_signal'
      AND e.payload_json->>'inbound_turn_telemetry' = 'true'
      AND COALESCE(
        NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
        SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
      ) = je.message_sid
    ORDER BY e.occurred_at DESC
    LIMIT 1
  ) tel ON TRUE
  LEFT JOIN LATERAL (
    SELECT ev.payload_json
    FROM v2_commitment_event ev
    WHERE ev.event_type IN ('user_yes', 'user_no', 'user_partial')
      AND COALESCE(
        NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''),
        SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
      ) = je.message_sid
    ORDER BY ev.occurred_at DESC
    LIMIT 1
  ) outcome ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      BOOL_OR(ev.event_type = 'user_yes') AS persisted_user_yes,
      BOOL_OR(ev.event_type = 'user_no') AS persisted_user_no,
      BOOL_OR(ev.event_type = 'user_partial') AS persisted_user_partial,
      BOOL_OR(ev.event_type IN ('user_yes', 'user_no', 'user_partial', 'blocker_captured')) AS any_truth_row
    FROM v2_commitment_event ev
    WHERE COALESCE(
      NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''),
      SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) = je.message_sid
  ) sp ON TRUE
)
SELECT
  e.inbound_at,
  (e.inbound_at AT TIME ZONE 'America/New_York')::date AS local_day,
  e.clerk_user_id,
  e.message_sid,
  e.inbound_body_preview,
  e.job_status,
  e.expected_write,
  e.persisted_user_yes,
  e.persisted_user_no,
  e.persisted_user_partial,
  e.actual_job_no_send_reason,
  e.no_send_reason_resolved,
  e.persist_attempted_before_writer,
  e.persist_succeeded_before_writer,
  e.persist_attempted_on_no_send,
  e.persist_succeeded_on_no_send,
  (
    e.any_truth_row
    AND (e.job_is_cancelled_no_send OR e.job_status IS DISTINCT FROM 'sent' OR e.no_send_reason_resolved <> '')
  ) AS persisted_despite_no_send,
  (
    e.inbound_body_preview ~* '(hit the goal|got my|missed|didn''?t hit|did half|only did|half)'
    AND NOT e.any_truth_row
    AND e.expected_write IN ('write_user_yes_today', 'write_user_yes', 'write_user_no', 'write_user_partial')
    AND (e.job_is_cancelled_no_send OR e.job_status IS DISTINCT FROM 'sent' OR e.no_send_reason_resolved <> '')
    AND NOT e.persist_succeeded_before_writer
    AND NOT e.persist_succeeded_on_no_send
  ) AS possible_truth_loss_due_to_no_send,
  CASE
    WHEN e.inbound_body_preview ~* '(hit the goal|got my|missed|didn''?t hit|did half|blocker|change my goal)'
      AND e.any_truth_row
      AND (e.job_is_cancelled_no_send OR e.job_status IS DISTINCT FROM 'sent' OR e.no_send_reason_resolved <> '')
      THEN 'truth_persisted_despite_no_send'
    WHEN e.inbound_body_preview ~* '(hit the goal|got my|missed|didn''?t hit|did half)'
      AND NOT e.any_truth_row
      AND e.expected_write IN ('write_user_yes_today', 'write_user_yes', 'write_user_no', 'write_user_partial')
      AND (e.job_is_cancelled_no_send OR e.job_status IS DISTINCT FROM 'sent' OR e.no_send_reason_resolved <> '')
      THEN 'current_code_failure_candidate'
    WHEN e.expected_write IN ('no_outcome_write', 'ack_only', 'defer_to_pending_resolution', 'defer_to_contract_consent')
      AND NOT e.any_truth_row THEN 'server_no_outcome_expected'
    WHEN e.any_truth_row THEN 'outcome_written_ok'
    WHEN e.job_status ~* 'sent' AND NOT e.job_is_cancelled_no_send AND e.no_send_reason_resolved = '' THEN 'reply_sent_not_no_send'
    ELSE 'manual_review'
  END AS no_send_truth_diagnostic,
  e.raw_telemetry_json
FROM enriched e
WHERE e.inbound_body_preview ~* '(hit the goal|got my|missed|didn''?t|did half|only did|blocker|change my goal|onboarding)'
  AND (
    e.job_is_cancelled_no_send
    OR e.job_status IS DISTINCT FROM 'sent'
    OR e.no_send_reason_resolved <> ''
    OR e.persist_attempted_before_writer
    OR e.persist_attempted_on_no_send
  )
ORDER BY e.inbound_at DESC;


-- =============================================================================
-- QUERY 09 — plans_blockers_goal_changes_certification
-- Saved query name: SM_AUDIT_09_Plans_Blockers_Goals
-- Purpose: Plans must not become proof; blockers captured; goal changes route to contract not outcome.
-- Default window: last 24 hours
-- MANUAL DATE OVERRIDE (optional — replace bounds lines below):
--   timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
--   timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
-- =============================================================================

WITH bounds AS (
  SELECT
    now() - interval '24 hours' AS window_start,
    now() AS window_end
),
inbound_base AS (
  SELECT
    COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')
    ) AS inbound_message_sid,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'clerk_user_id'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'clerk_user_id'), '')
    ) AS clerk_user_id,
    COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) AS inbound_at,
    LEFT(
      COALESCE(
        NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''),
        NULLIF(BTRIM(to_jsonb(m)->>'body'), ''),
        NULLIF(BTRIM(to_jsonb(m)->>'message_body'), ''),
        NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''),
        ''
      ),
      280
    ) AS inbound_body_preview,
    CASE
      WHEN COALESCE(
        NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''),
        NULLIF(BTRIM(to_jsonb(m)->>'body'), ''),
        NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''),
        ''
      ) ~* '(amend|re-?state|restated?)\s+(the\s+)?(old\s+)?goals?|reset\s+(the\s+)?(old\s+)?goals?|old\s+goals?|revise\s+(the\s+)?goals?|update\s+(the\s+)?goals?|adjust\s+(the\s+)?goals?|alter\s+(the\s+)?goals?|change\s+(the\s+)?goals?|change\s+my\s+goal|new\s+goal|different\s+goal|goal\s+no\s+longer\s+fits|ready\s+for\s+a\s+new\s+goal|raise\s+the\s+bar|lower\s+the\s+bar|shrink\s+the\s+goal|make\s+it\s+(easier|harder)|replace.*goal|adjust\s+my\s+goal|need\s+to\s+amend|re-?state\s+old\s+goals?' THEN 'goal_change'
      WHEN COALESCE(
        NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''),
        NULLIF(BTRIM(to_jsonb(m)->>'body'), ''),
        NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''),
        ''
      ) ~* '(got in the way|threw me off|blocker|rain|meetings|forgot my shoes|travel|sick|kids)' THEN 'blocker'
      WHEN COALESCE(
        NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''),
        NULLIF(BTRIM(to_jsonb(m)->>'body'), ''),
        NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''),
        ''
      ) ~* '(i''?ll|i will|tomorrow|before breakfast|after work|setting my shoes|planning to|going to run|gonna run)' THEN 'plan'
      WHEN COALESCE(
        NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''),
        NULLIF(BTRIM(to_jsonb(m)->>'body'), ''),
        NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''),
        ''
      ) ~* '(going to run tomorrow|tomorrow i''?ll get it done)' THEN 'plan'
      ELSE NULL
    END AS cert_lane
  FROM sms_inbound_messages m
  FULL OUTER JOIN sms_inbound_coach_jobs j
    ON j.message_sid = to_jsonb(m)->>'message_sid'
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) < b.window_end
    AND COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'message_sid'), ''),
      NULLIF(BTRIM(to_jsonb(j)->>'message_sid'), '')
    ) IS NOT NULL
),
classified AS (
  SELECT
    ib.*,
    COALESCE(
      NULLIF(BTRIM(tel.payload_json->>'inbound_meaning_persistence'), ''),
      NULLIF(BTRIM(tel.payload_json->>'server_reconciled_persistence_decision'), '')
    ) AS persistence_decision,
    COALESCE(sp.persisted_user_yes, FALSE) AS persisted_user_yes,
    COALESCE(sp.persisted_user_no, FALSE) AS persisted_user_no,
    COALESCE(sp.persisted_user_partial, FALSE) AS persisted_user_partial,
    COALESCE(sp.persisted_blocker, FALSE) AS persisted_blocker,
    COALESCE(sp.persisted_plan_signal, FALSE) AS persisted_plan_signal,
    COALESCE(sp.persisted_goal_change, FALSE) AS persisted_goal_change,
    to_jsonb(tel.payload_json) AS raw_telemetry_json
  FROM inbound_base ib
  LEFT JOIN LATERAL (
    SELECT e.payload_json
    FROM v2_commitment_event e
    WHERE e.event_type = 'sms_memory_signal'
      AND e.payload_json->>'inbound_turn_telemetry' = 'true'
      AND COALESCE(
        NULLIF(BTRIM(e.payload_json->>'message_sid'), ''),
        SUBSTRING(e.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
      ) = ib.inbound_message_sid
    ORDER BY e.occurred_at DESC
    LIMIT 1
  ) tel ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      BOOL_OR(ev.event_type = 'user_yes') AS persisted_user_yes,
      BOOL_OR(ev.event_type = 'user_no') AS persisted_user_no,
      BOOL_OR(ev.event_type = 'user_partial') AS persisted_user_partial,
      BOOL_OR(ev.event_type = 'blocker_captured') AS persisted_blocker,
      BOOL_OR(
        ev.event_type = 'sms_memory_signal'
        AND ev.payload_json->'memory_signal' IS NOT NULL
        AND COALESCE(ev.payload_json->'memory_signal'->>'memory_signal_detected', 'false') = 'true'
      ) AS persisted_plan_signal,
      BOOL_OR(ev.event_type IN ('contract_overlay_proposed', 'contract_overlay_activated', 'ask_shrunk')) AS persisted_goal_change
    FROM v2_commitment_event ev
    WHERE COALESCE(
      NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''),
      NULLIF(BTRIM(ev.payload_json->>'inbound_resolution_message_sid'), ''),
      SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) = ib.inbound_message_sid
  ) sp ON TRUE
  WHERE ib.cert_lane IS NOT NULL
)
SELECT
  c.inbound_at,
  (c.inbound_at AT TIME ZONE 'America/New_York')::date AS local_day,
  c.clerk_user_id,
  c.inbound_message_sid,
  c.inbound_body_preview,
  c.cert_lane,
  c.persistence_decision,
  c.persisted_user_yes,
  c.persisted_user_no,
  c.persisted_user_partial,
  c.persisted_blocker,
  c.persisted_plan_signal,
  c.persisted_goal_change,
  CASE
    WHEN c.cert_lane = 'plan' AND (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'false_outcome_written'
    WHEN c.cert_lane = 'plan' AND c.persisted_plan_signal THEN 'plan_saved_ok'
    WHEN c.cert_lane = 'plan' AND NOT c.persisted_plan_signal THEN 'plan_without_memory_signal'
    WHEN c.cert_lane = 'plan' THEN 'plan_expected_no_proof'
    WHEN c.cert_lane = 'blocker' AND c.persisted_blocker THEN 'blocker_saved_ok'
    WHEN c.cert_lane = 'blocker' AND NOT c.persisted_blocker THEN 'blocker_without_memory_signal'
    WHEN c.cert_lane = 'goal_change' AND c.persisted_goal_change THEN 'goal_change_state_event_ok'
    WHEN c.cert_lane = 'goal_change' AND (c.persisted_user_yes OR c.persisted_user_no OR c.persisted_user_partial) THEN 'false_outcome_written'
    WHEN c.cert_lane = 'goal_change' AND NOT c.persisted_goal_change THEN 'goal_change_without_state_event'
    ELSE 'manual_review'
  END AS cert_diagnostic,
  c.raw_telemetry_json
FROM classified c
ORDER BY c.inbound_at DESC;


-- =============================================================================
-- QUERY 10 — victory_room_projection_certification
-- Saved query name: SM_AUDIT_10_Victory_Room
-- Purpose: Spine proof fields → Victory Room display eligibility and projection gaps.
-- Default window: last 24 hours
-- MANUAL DATE OVERRIDE (optional — replace bounds lines below):
--   timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
--   timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
-- =============================================================================

WITH bounds AS (
  SELECT
    now() - interval '24 hours' AS window_start,
    now() AS window_end
),
spine AS (
  SELECT
    ev.occurred_at,
    ev.clerk_user_id,
    ev.commitment_id,
    ev.event_type,
    ev.id AS event_id,
    COALESCE(
      NULLIF(BTRIM(ev.payload_json->>'message_sid'), ''),
      SUBSTRING(ev.idempotency_key FROM '(SM[0-9A-Fa-f]{32})$')
    ) AS message_sid,
    LEFT(COALESCE(
      ev.payload_json->>'message',
      ev.payload_json->>'message_preview',
      ev.payload_json->>'raw_body_preview',
      ''
    ), 280) AS inbound_body_preview,
    COALESCE((ev.payload_json->>'proof_moment')::boolean, FALSE) AS proof_moment,
    ev.payload_json->>'proof_moment_type' AS proof_moment_type,
    LEFT(COALESCE(
      ev.payload_json->>'user_visible_proof_line',
      ev.payload_json->>'proof_meaning_line',
      ''
    ), 220) AS user_visible_proof_line,
    COALESCE((ev.payload_json->>'season_lifecycle')::boolean, FALSE) AS season_lifecycle,
    COALESCE((ev.payload_json->>'exclude_from_proof_curation')::boolean, FALSE) AS exclude_from_proof_curation,
    to_jsonb(ev.payload_json) AS raw_payload_json
  FROM v2_commitment_event ev
  CROSS JOIN bounds b
  WHERE ev.occurred_at >= b.window_start
    AND ev.occurred_at < b.window_end
    AND ev.event_type IN (
      'user_yes', 'user_no', 'user_partial', 'blocker_captured',
      'contract_overlay_proposed', 'contract_overlay_activated', 'contract_overlay_declined',
      'sms_memory_signal', 'ask_shrunk', 'coaching_refresh_resolved'
    )
)
SELECT
  s.occurred_at,
  (s.occurred_at AT TIME ZONE 'America/New_York')::date AS local_day,
  s.clerk_user_id,
  s.commitment_id,
  s.event_type,
  s.message_sid,
  s.inbound_body_preview,
  s.proof_moment AS spine_has_proof,
  (COALESCE(s.user_visible_proof_line, '') <> '') AS proof_has_display_line,
  (
    s.proof_moment
    AND COALESCE(s.user_visible_proof_line, '') <> ''
    AND NOT s.season_lifecycle
    AND NOT s.exclude_from_proof_curation
    AND COALESCE(s.proof_moment_type, '') NOT IN ('memory_updated')
    AND s.inbound_body_preview !~* '(onboarding|didn''?t ask me|plan to|tomorrow|going to)'
  ) AS should_display_in_vr,
  (
    s.event_type IN ('user_yes', 'user_no', 'user_partial')
    AND s.proof_moment
    AND COALESCE(s.user_visible_proof_line, '') <> ''
    AND NOT (
      s.proof_moment
      AND COALESCE(s.user_visible_proof_line, '') <> ''
      AND NOT s.season_lifecycle
      AND NOT s.exclude_from_proof_curation
      AND COALESCE(s.proof_moment_type, '') NOT IN ('memory_updated')
      AND s.inbound_body_preview !~* '(onboarding|didn''?t ask me|plan to|tomorrow|going to)'
    )
  ) AS likely_vr_missing_projection,
  CASE
    WHEN s.inbound_body_preview ~* '(onboarding|didn''?t ask)' THEN 'meta_process_should_not_display'
    WHEN s.inbound_body_preview ~* '(plan to|tomorrow|going to)' THEN 'future_plan_should_not_display'
    WHEN s.proof_moment_type = 'memory_updated' THEN 'memory_updated_should_not_display'
    WHEN NOT s.proof_moment AND s.event_type IN ('user_yes', 'user_no', 'user_partial') THEN 'spine_missing_truth_not_vr_bug'
    ELSE NULL
  END AS negative_control_reason,
  (
    s.inbound_body_preview ~* '(onboarding|plan to|tomorrow|going to)'
    OR s.proof_moment_type = 'memory_updated'
  ) AS plan_meta_future_should_not_display,
  (COALESCE(s.proof_moment_type, '') = 'comeback_after_miss') AS comeback_after_miss,
  s.proof_moment_type,
  s.user_visible_proof_line,
  CASE
    WHEN s.proof_moment AND COALESCE(s.user_visible_proof_line, '') <> '' THEN 'victory_room_projection_candidate'
    WHEN NOT s.proof_moment AND s.event_type IN ('user_yes', 'user_no', 'user_partial') THEN 'victory_room_missing_projection_candidate'
    ELSE 'non_proof_expected'
  END AS cert_diagnostic,
  s.raw_payload_json
FROM spine s
ORDER BY s.occurred_at DESC, s.clerk_user_id;


-- =============================================================================
-- QUERY 11 — weekly_pending_state_sensitive_audit
-- Saved query name: SM_AUDIT_11_Weekly_Pending
-- Purpose: Weekly miss-count/recommit/gamified language; pending resolution; state-sensitive stuck users.
-- Default window: last 24 hours
-- MANUAL DATE OVERRIDE (optional — replace bounds lines below):
--   timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
--   timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
-- =============================================================================

WITH bounds AS (
  SELECT
    now() - interval '24 hours' AS window_start,
    now() AS window_end
),
weekly AS (
  SELECT
    'sms_weekly_send_events'::text AS source_table,
    COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(w)->>'clerk_user_id', to_jsonb(w)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(w)->>'status', '') AS status,
    COALESCE(to_jsonb(w)#>>'{metadata,no_send_reason}', to_jsonb(w)->>'no_send_reason', '') AS no_send_reason,
    COALESCE(to_jsonb(w)#>>'{metadata,no_send_reason}', to_jsonb(w)->>'no_send_reason', '') AS actual_no_send_reason,
    COALESCE(to_jsonb(w)#>>'{metadata,v2_weekly_proof_pack,raw_user_no_count}', to_jsonb(w)#>>'{metadata,raw_user_no_count}', '') AS raw_user_no_count,
    COALESCE(to_jsonb(w)#>>'{metadata,v2_weekly_proof_pack,distinct_user_no_day_count}', to_jsonb(w)#>>'{metadata,distinct_user_no_day_count}', '') AS distinct_user_no_day_count,
    COALESCE(to_jsonb(w)#>>'{metadata,v2_weekly_proof_pack,exact_miss_day_count_reliable}', to_jsonb(w)#>>'{metadata,exact_miss_day_count_reliable}', '') AS exact_miss_day_count_reliable,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(w)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,north_star_gate,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,north_star_gate,original_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,v3_candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_voice_gate,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_voice_gate,final_body_with_suffix}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_voice_gate,final_voice_gate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,voice_send_decision,north_star_visible_body}'), ''),
      ''
    ) AS body_preview,
    ''::text AS pending_resolution_kind,
    ''::text AS missing_required_verbatim,
    ''::text AS route_kind,
    to_jsonb(w) AS raw_json
  FROM sms_weekly_send_events w
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
daily_state AS (
  SELECT
    'sms_send_events'::text AS source_table,
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(s)->>'clerk_user_id', to_jsonb(s)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(s)->>'status', '') AS status,
    COALESCE(
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      to_jsonb(s)->>'no_send_reason',
      ''
    ) AS no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,unified_final_product_law_guard,no_send_reason}',
      to_jsonb(s)#>>'{metadata,unified_final_guard_no_send_reason}',
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      to_jsonb(s)->>'no_send_reason',
      ''
    ) AS actual_no_send_reason,
    ''::text AS raw_user_no_count,
    ''::text AS distinct_user_no_day_count,
    ''::text AS exact_miss_day_count_reliable,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,final_body}'), ''),
      ''
    ) AS body_preview,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,pending_resolution_kind}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_daily_pending_resolution_kind}',
      to_jsonb(s)#>>'{metadata,voice_send_decision,pending_resolution_kind}',
      ''
    ) AS pending_resolution_kind,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,required_verbatim_missing}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,required_verbatim_missing}',
      to_jsonb(s)#>>'{metadata,unified_final_product_law_guard,required_verbatim_missing}',
      ''
    ) AS missing_required_verbatim,
    COALESCE(
      to_jsonb(s)#>>'{metadata,route_kind}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,route_kind}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_route_kind}',
      ''
    ) AS route_kind,
    to_jsonb(s) AS raw_json
  FROM sms_send_events s
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) < b.window_end
    AND (
      COALESCE(
        to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
        to_jsonb(s)#>>'{metadata,no_send_reason}',
        to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
        ''
      ) ~* '(pending|missing_required_verbatim)'
      OR COALESCE(
        to_jsonb(s)#>>'{metadata,daily_v3_lane,pending_resolution_kind}',
        to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_daily_pending_resolution_kind}',
        ''
      ) <> ''
      OR COALESCE(
        to_jsonb(s)#>>'{metadata,daily_v3_lane,required_verbatim_missing}',
        to_jsonb(s)#>>'{metadata,relationship_packet_observability,required_verbatim_missing}',
        ''
      ) <> ''
      OR COALESCE(
        to_jsonb(s)#>>'{metadata,route_kind}',
        to_jsonb(s)#>>'{metadata,daily_v3_lane,route_kind}',
        ''
      ) IN (
        'contract_prompt', 'pending_resolution', 'refresh_identity',
        'refresh_commitment', 'guided_shrink_contract_prompt', 'guided_contract_proposal'
      )
    )
),
combined AS (
  SELECT * FROM weekly
  UNION ALL
  SELECT * FROM daily_state
)
SELECT
  (c.event_at AT TIME ZONE 'America/New_York')::date AS local_day,
  c.event_at,
  c.source_table,
  c.clerk_user_id,
  c.status,
  c.no_send_reason,
  c.raw_user_no_count,
  c.distinct_user_no_day_count,
  c.exact_miss_day_count_reliable,
  c.pending_resolution_kind,
  c.missing_required_verbatim,
  c.route_kind,
  c.actual_no_send_reason,
  c.body_preview,
  CASE
    WHEN c.actual_no_send_reason ~* 'turn_understanding_stale_ask_blocked' THEN 'inbound_stale_ask_no_send'
    WHEN c.source_table = 'sms_weekly_send_events'
      AND c.body_preview ~* '(couple|few|several|two|2).{0,30}(missed|misses|missed days|days missed)' THEN 'exact_multi_miss_claim'
    WHEN c.body_preview ~* '(recommit|would you like to recommit|same line for a week|hold you to the same line)' THEN 'recommit_language'
    WHEN c.body_preview ~* '(reply yes|reply no|reply stop|reply help|text yes|text no|menu|checkbox|habit tracker)' THEN 'menu_reply_language'
    WHEN c.body_preview ~* '(streak|badge|scoreboard|xp|points)' THEN 'gamified_language'
    WHEN c.actual_no_send_reason ~* '(pending|missing_required_verbatim)' THEN 'pending_resolution_no_send'
    WHEN c.pending_resolution_kind <> '' THEN 'state_sensitive_pending_route'
    WHEN c.missing_required_verbatim <> '' THEN 'state_sensitive_missing_verbatim'
    WHEN c.route_kind IN ('contract_prompt', 'pending_resolution', 'refresh_identity', 'refresh_commitment', 'guided_shrink_contract_prompt', 'guided_contract_proposal') THEN 'state_sensitive_route'
    WHEN c.body_preview = '' AND c.actual_no_send_reason <> '' THEN 'weekly_or_daily_no_send'
    ELSE 'manual_review'
  END AS audit_flag,
  c.raw_json
FROM combined c
WHERE c.body_preview ~* '(recommit|same line|reply yes|reply no|text yes|text no|did you hit|did you do|did you complete|streak|badge|scoreboard|xp|points|missed|misses|couple|few|several|menu|checkbox|habit tracker|would you like to recommit)'
   OR c.actual_no_send_reason ~* '(pending|missing_required_verbatim|turn_understanding_stale_ask_blocked)'
   OR c.pending_resolution_kind <> ''
   OR c.missing_required_verbatim <> ''
   OR c.route_kind IN ('contract_prompt', 'pending_resolution', 'refresh_identity', 'refresh_commitment', 'guided_shrink_contract_prompt', 'guided_contract_proposal')
ORDER BY c.event_at DESC;


-- =============================================================================
-- QUERY 12 — final_guard_product_law_side_room_audit
-- Saved query name: SM_AUDIT_12_Final_Guard_SideRoom
-- Purpose: Final guard / product-law / side-room — distinguish visible impact vs telemetry noise.
-- Default window: last 24 hours
-- MANUAL DATE OVERRIDE (optional — replace bounds lines below):
--   timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
--   timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
-- =============================================================================

WITH bounds AS (
  SELECT
    now() - interval '24 hours' AS window_start,
    now() AS window_end
),
rows AS (
  SELECT
    'sms_send_events'::text AS source_table,
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(s)->>'clerk_user_id', to_jsonb(s)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(
      to_jsonb(s)#>>'{metadata,route_kind}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,route_kind}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_route_kind}',
      ''
    ) AS route_kind,
    COALESCE(to_jsonb(s)->>'status', '') AS status,
    COALESCE(to_jsonb(s)->>'message_sid', to_jsonb(s)->>'outbound_message_sid', to_jsonb(s)#>>'{metadata,message_sid}', '') AS message_sid,
    COALESCE(to_jsonb(s)#>>'{metadata,note}', '') AS note,
    COALESCE(
      to_jsonb(s)#>>'{metadata,unified_final_product_law_guard,no_send_reason}',
      to_jsonb(s)#>>'{metadata,unified_final_guard_no_send_reason}',
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      to_jsonb(s)->>'no_send_reason',
      ''
    ) AS no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,unified_final_product_law_guard,no_send_reason}',
      to_jsonb(s)#>>'{metadata,unified_final_guard_no_send_reason}',
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      to_jsonb(s)->>'no_send_reason',
      ''
    ) AS actual_no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,skip_source}',
      to_jsonb(s)#>>'{metadata,voice_send_decision,skip_source}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,skip_source}',
      ''
    ) AS skip_source,
    COALESCE(
      to_jsonb(s)#>>'{metadata,unified_final_product_law_guard,no_send_reason}',
      to_jsonb(s)#>>'{metadata,unified_final_guard_no_send_reason}',
      to_jsonb(s)#>>'{metadata,final_guard_no_send_reason}',
      ''
    ) AS final_guard_no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,unified_final_product_law_guard,violations}',
      to_jsonb(s)#>>'{metadata,final_guard_violations}',
      ''
    ) AS final_guard_violations,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,body}'), ''),
      ''
    ) AS body_preview,
    to_jsonb(s) AS raw_json
  FROM sms_send_events s
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) < b.window_end

  UNION ALL

  SELECT
    'sms_weekly_send_events'::text,
    COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ),
    COALESCE(to_jsonb(w)->>'clerk_user_id', to_jsonb(w)#>>'{metadata,clerk_user_id}'),
    'weekly',
    COALESCE(to_jsonb(w)->>'status', ''),
    COALESCE(to_jsonb(w)->>'message_sid', to_jsonb(w)->>'outbound_message_sid', ''),
    '',
    COALESCE(to_jsonb(w)->>'no_send_reason', to_jsonb(w)#>>'{metadata,no_send_reason}', ''),
    COALESCE(to_jsonb(w)->>'no_send_reason', to_jsonb(w)#>>'{metadata,no_send_reason}', ''),
    '',
    COALESCE(to_jsonb(w)#>>'{metadata,unified_final_guard_no_send_reason}', to_jsonb(w)#>>'{metadata,final_guard_no_send_reason}', ''),
    COALESCE(to_jsonb(w)#>>'{metadata,final_guard_violations}', ''),
    COALESCE(
      NULLIF(BTRIM(to_jsonb(w)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,north_star_gate,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,north_star_gate,original_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,v3_candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_voice_gate,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_voice_gate,final_body_with_suffix}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_voice_gate,final_voice_gate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,voice_send_decision,north_star_visible_body}'), ''),
      ''
    ),
    to_jsonb(w)
  FROM sms_weekly_send_events w
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) < b.window_end

  UNION ALL

  SELECT
    'sms_inbound_coach_jobs'::text,
    COALESCE(
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ),
    COALESCE(to_jsonb(j)->>'clerk_user_id', to_jsonb(j)#>>'{metadata,clerk_user_id}'),
    COALESCE(to_jsonb(j)#>>'{metadata,route_purpose}', to_jsonb(j)#>>'{metadata,branch_name}', 'inbound_coach'),
    COALESCE(to_jsonb(j)->>'status', ''),
    COALESCE(to_jsonb(j)->>'message_sid', ''),
    '',
    COALESCE(
      NULLIF(BTRIM(to_jsonb(j)#>>'{metadata,no_send_reason}'), ''),
      NULLIF(BTRIM((regexp_match(COALESCE(to_jsonb(j)->>'last_error', ''), '"no_send_reason"\s*:\s*"([^"]+)"'))[1]), ''),
      NULLIF(BTRIM((regexp_match(COALESCE(to_jsonb(j)->>'last_error', ''), '"inbound_reply_no_send_reason"\s*:\s*"([^"]+)"'))[1]), ''),
      ''
    ),
    COALESCE(
      NULLIF(BTRIM(to_jsonb(j)#>>'{metadata,no_send_reason}'), ''),
      NULLIF(BTRIM((regexp_match(COALESCE(to_jsonb(j)->>'last_error', ''), '"no_send_reason"\s*:\s*"([^"]+)"'))[1]), ''),
      NULLIF(BTRIM((regexp_match(COALESCE(to_jsonb(j)->>'last_error', ''), '"inbound_reply_no_send_reason"\s*:\s*"([^"]+)"'))[1]), ''),
      ''
    ),
    '',
    COALESCE(
      NULLIF(BTRIM((regexp_match(COALESCE(to_jsonb(j)->>'last_error', ''), '"unified_final_guard_no_send_reason"\s*:\s*"([^"]+)"'))[1]), ''),
      ''
    ),
    COALESCE(
      NULLIF(BTRIM((regexp_match(COALESCE(to_jsonb(j)->>'last_error', ''), '"final_guard_violations"\s*:\s*"([^"]+)"'))[1]), ''),
      NULLIF(BTRIM((regexp_match(COALESCE(to_jsonb(j)->>'last_error', ''), '"final_guard_violations"\s*:\s*\[([^\]]*)\]'))[1]), ''),
      ''
    ),
    COALESCE(
      NULLIF(BTRIM(to_jsonb(j)->>'reply_body'), ''),
      NULLIF(BTRIM(to_jsonb(j)#>>'{metadata,reply_body}'), ''),
      ''
    ),
    to_jsonb(j)
  FROM sms_inbound_coach_jobs j
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) < b.window_end
    AND (
      COALESCE(to_jsonb(j)->>'status', '') ~* 'cancelled'
      OR COALESCE(to_jsonb(j)->>'last_error', '') ~* '(final|product_law|voice|fvg|north_star|side_room|stale_ask|turn_understanding)'
    )
),
classified AS (
  SELECT
    r.*,
    CASE
      WHEN r.status ~* '^skipped_(not_fully_on_v2|no_active_commitment|duplicate|tapback|compliance|safety|crisis|invalid_phone|outside_send_window|active_inbound_thread|sunday_weekly_pause)$'
        THEN false
      WHEN r.no_send_reason ~* '(not.*v2|not_fully_on_v2|no_active_commitment|stopped|unsubscribed|duplicate|tapback|compliance|safety|crisis|invalid_phone|outside_send_window|skipped_not_time|skipped_active_inbound_thread|skipped_sunday_weekly_pause)'
        OR r.skip_source ~* '(not.*v2|not_fully_on_v2|no_active_commitment|duplicate|tapback|compliance|safety|crisis|active_inbound_thread|outside_send_window|sunday_weekly_pause)'
      THEN false
      ELSE true
    END AS eligible_coaching_row,
    CASE
      WHEN r.body_preview <> ''
       AND (r.status ~* '(sent|delivered|queued|success|accepted|sending)' OR r.message_sid <> '' OR r.note = 'sent_to_twilio')
       AND r.no_send_reason = '' AND r.skip_source = '' THEN true
      WHEN r.body_preview <> ''
       AND (r.status ~* '(sent|delivered|queued|success|accepted|sending)' OR r.message_sid <> '' OR r.note = 'sent_to_twilio')
       AND r.no_send_reason !~* '(blocked|no_send|stale|memory|freshness|missing|required|compliance|safety|duplicate|tapback|not_fully_on_v2|no_active_commitment|outside_send_window)'
       AND r.skip_source = '' THEN true
      ELSE false
    END AS visible_sent,
    (
      r.final_guard_no_send_reason <> ''
      OR r.final_guard_violations <> ''
      OR r.actual_no_send_reason ~* '(final|product_law|voice|fvg|north_star|ownership|unsafe|blocked|turn_understanding_stale_ask_blocked)'
      OR r.no_send_reason ~* '(final|product_law|voice|fvg|north_star|ownership|unsafe|blocked)'
      OR (r.source_table = 'sms_inbound_coach_jobs' AND r.actual_no_send_reason <> '')
      OR (r.body_preview <> '' AND r.raw_json::text ~* '(unified_final_product_law_guard|final_voice_gate|north_star|side_room|legacy_fallback|shadow|contract_prompt|deterministic|hardcoded|template|machine|recommit|\bv1\b|\bc2\b|\bc3\b)')
      OR (r.body_preview <> '' AND r.body_preview ~* '(recommit|same line for a week|reply yes|reply no|as an ai|strategy card|relationship packet|internal|template|fallback|accountability bot)')
    ) AS matched_guard_or_side_room
  FROM rows r
)
SELECT
  (c.event_at AT TIME ZONE 'America/New_York')::date AS local_day,
  c.event_at,
  c.source_table,
  c.clerk_user_id,
  c.route_kind,
  c.status,
  c.no_send_reason,
  c.actual_no_send_reason,
  c.final_guard_no_send_reason,
  c.final_guard_violations,
  LEFT(c.body_preview, 1000) AS body_preview,
  CASE
    WHEN c.actual_no_send_reason ~* 'turn_understanding_stale_ask_blocked' THEN 'inbound_stale_ask_no_send'
    WHEN c.visible_sent AND (
      c.body_preview ~* '(recommit|same line|reply yes|reply no|as an ai|strategy card|relationship packet|internal|template|fallback|accountability bot|north star|victory room)'
      OR c.final_guard_violations <> ''
    ) THEN 'actual_visible_impact'
    WHEN c.eligible_coaching_row AND NOT c.visible_sent AND (
      c.final_guard_no_send_reason <> ''
      OR c.actual_no_send_reason ~* '(final|product_law|voice|fvg|north_star|ownership|unsafe|blocked|side_room|legacy|fallback|template|machine|recommit)'
    ) THEN 'actual_no_send'
    WHEN NOT c.visible_sent
      AND c.final_guard_no_send_reason = ''
      AND c.actual_no_send_reason !~* '(final|product_law|voice|fvg|north_star|ownership|unsafe|blocked|side_room|legacy|fallback|template|machine|recommit|turn_understanding_stale_ask_blocked)'
      AND (
        c.final_guard_violations <> ''
        OR (c.body_preview <> '' AND c.raw_json::text ~* '(unified_final_product_law_guard|final_voice_gate|north_star|side_room|legacy_fallback|shadow|contract_prompt|deterministic|hardcoded|template|machine|recommit|\bv1\b|\bc2\b|\bc3\b)')
      ) THEN 'telemetry_only_mention'
    WHEN c.body_preview = ''
      AND c.final_guard_no_send_reason = ''
      AND c.actual_no_send_reason = ''
      AND c.raw_json::text ~* '(unified_final_product_law_guard|final_voice_gate|north_star|side_room|legacy_fallback|shadow|contract_prompt|deterministic|hardcoded|template|machine|recommit|\bv1\b|\bc2\b|\bc3\b)'
      THEN 'raw_json_only_noise_review'
    ELSE 'manual_review'
  END AS impact_classification,
  c.raw_json
FROM classified c
WHERE c.matched_guard_or_side_room
ORDER BY c.event_at DESC;


-- =============================================================================
-- QUERY 13 — observability_denominator_sanity_check
-- Saved query name: SM_AUDIT_13_Denominator_Sanity
-- Purpose: Telemetry completeness — rows that could make eligible/visible SQL denominators lie.
-- v2.9: sunday_daily_suppressed_before_weekly when daily suppressed but no visible weekly same local Sunday.
-- v2.8: weekly_body_missing_with_sid warning rows (visible weekly send with empty body paths).
-- v2.3: DailySmsWritingBriefV1 sent-row telemetry sanity (writer_prompt_path, brief_used, writer_total_chars).
-- v2.2: coach-body duplicate telemetry sanity + per-issue impacted_query + severity.
-- Default window: last 24 hours
-- MANUAL DATE OVERRIDE (optional — replace bounds lines below):
--   timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
--   timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
-- =============================================================================

WITH bounds AS (
  SELECT
    now() - interval '24 hours' AS window_start,
    now() AS window_end
),
send_base AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(s)->>'clerk_user_id', to_jsonb(s)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(s)->>'status', '') AS status,
    COALESCE(to_jsonb(s)->>'message_sid', to_jsonb(s)->>'outbound_message_sid', to_jsonb(s)#>>'{metadata,message_sid}', '') AS message_sid,
    COALESCE(to_jsonb(s)#>>'{metadata,note}', '') AS note,
    COALESCE(
      to_jsonb(s)#>>'{metadata,route_kind}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,route_kind}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_route_kind}',
      ''
    ) AS route_kind,
    COALESCE(
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      to_jsonb(s)->>'no_send_reason',
      ''
    ) AS no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,skip_source}',
      to_jsonb(s)#>>'{metadata,voice_send_decision,skip_source}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,skip_source}',
      ''
    ) AS skip_source,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_zero_question_mode_active}',
      to_jsonb(s)#>>'{metadata,v3_brain,daily_zero_question_mode_active}',
      ''
    ) AS daily_zero_question_mode_active,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,inbound_resolved_truth_emitted}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,inbound_resolved_truth_emitted}',
      to_jsonb(s)#>>'{metadata,inbound_resolved_truth_emitted}',
      ''
    ) AS inbound_resolved_truth_emitted,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_guard_attempted}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_guard_attempted}',
      ''
    ) AS memory_repeat_guard_attempted,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,coach_body_near_duplicate_detected}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,coach_body_near_duplicate_detected}',
      to_jsonb(s)#>>'{metadata,v3_brain,coach_body_near_duplicate_detected}',
      to_jsonb(s)#>>'{metadata,coach_body_near_duplicate_detected}',
      ''
    ) AS coach_body_near_duplicate_detected,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_coach_body_near_duplicate_blocked}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_coach_body_near_duplicate_blocked}',
      to_jsonb(s)#>>'{metadata,v3_brain,daily_coach_body_near_duplicate_blocked}',
      to_jsonb(s)#>>'{metadata,daily_coach_body_near_duplicate_blocked}',
      ''
    ) AS daily_coach_body_near_duplicate_blocked,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,memory_repeat_no_send_reason}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,memory_repeat_no_send_reason}',
      to_jsonb(s)#>>'{metadata,v3_brain,memory_repeat_no_send_reason}',
      to_jsonb(s)#>>'{metadata,memory_repeat_no_send_reason}',
      ''
    ) AS memory_repeat_no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,daily_v3_lane,prior_coach_body_preview}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,prior_coach_body_preview}',
      to_jsonb(s)#>>'{metadata,v3_brain,prior_coach_body_preview}',
      to_jsonb(s)#>>'{metadata,prior_coach_body_preview}',
      ''
    ) AS prior_coach_body_preview,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,writer_prompt_path}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,writer_prompt_path}',
      ''
    ) AS writer_prompt_path,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_writing_brief_used}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_writing_brief_used}',
      ''
    ) AS daily_writing_brief_used,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,writer_total_chars}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,writer_total_chars}',
      ''
    ) AS writer_total_chars,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_praise_allowed_level}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_praise_allowed_level}',
      ''
    ) AS daily_praise_allowed_level,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_writing_brief_build_status}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_writing_brief_build_status}',
      ''
    ) AS daily_writing_brief_build_status,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_writing_brief_skip_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_writing_brief_skip_reason}',
      ''
    ) AS daily_writing_brief_skip_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_suggested_move}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_suggested_move}',
      ''
    ) AS daily_suggested_move,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_brief_thread_floor_message_count}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_brief_thread_floor_message_count}',
      ''
    ) AS daily_brief_thread_floor_message_count,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_brief_thread_extension_message_count}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_brief_thread_extension_message_count}',
      ''
    ) AS daily_brief_thread_extension_message_count,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_brief_thread_message_count}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_brief_thread_message_count}',
      ''
    ) AS daily_brief_thread_message_count,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_brief_thread_oldest_at_local}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_brief_thread_oldest_at_local}',
      ''
    ) AS daily_brief_thread_oldest_at_local,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_brief_thread_newest_at_local}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_brief_thread_newest_at_local}',
      ''
    ) AS daily_brief_thread_newest_at_local,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_freshness_avoid_count}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_freshness_avoid_count}',
      ''
    ) AS daily_freshness_avoid_count,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_freshness_avoid_phrases_preview}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_freshness_avoid_phrases_preview}',
      ''
    ) AS daily_freshness_avoid_phrases_preview,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_open_loop_pending_active}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_open_loop_pending_active}',
      ''
    ) AS daily_open_loop_pending_active,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_local_daypart}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_local_daypart}',
      ''
    ) AS daily_local_daypart,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_timing_guidance_present}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_timing_guidance_present}',
      ''
    ) AS daily_timing_guidance_present,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_durable_memory_item_count}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_durable_memory_item_count}',
      ''
    ) AS daily_durable_memory_item_count,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,daily_durable_memory_background_only}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,daily_durable_memory_background_only}',
      ''
    ) AS daily_durable_memory_background_only,
    COALESCE(
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,thread_freshness_violation_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,thread_freshness_violation_reason}',
      ''
    ) AS thread_freshness_violation_reason,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(s)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,body}'), ''),
      ''
    ) AS body_preview,
    to_jsonb(s) AS raw_json
  FROM sms_send_events s
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
classified_base AS (
  SELECT
    sb.*,
    CASE
      WHEN sb.status ~* '^skipped_(not_fully_on_v2|no_active_commitment|duplicate|tapback|compliance|safety|crisis|invalid_phone|outside_send_window|active_inbound_thread|sunday_weekly_pause)$'
        THEN false
      WHEN sb.no_send_reason ~* '(not.*v2|not_fully_on_v2|no_active_commitment|stopped|unsubscribed|duplicate|tapback|compliance|safety|crisis|invalid_phone|outside_send_window|skipped_not_time|skipped_active_inbound_thread|skipped_sunday_weekly_pause)'
        OR sb.skip_source ~* '(not.*v2|not_fully_on_v2|no_active_commitment|duplicate|tapback|compliance|safety|crisis|active_inbound_thread|outside_send_window|sunday_weekly_pause)'
      THEN false
      ELSE true
    END AS eligible_coaching_row,
    CASE
      WHEN sb.body_preview <> ''
       AND (sb.status ~* '(sent|delivered|queued|success|accepted|sending)' OR sb.message_sid <> '' OR sb.note = 'sent_to_twilio')
       AND sb.no_send_reason = '' AND sb.skip_source = '' THEN true
      WHEN sb.body_preview <> ''
       AND (sb.status ~* '(sent|delivered|queued|success|accepted|sending)' OR sb.message_sid <> '' OR sb.note = 'sent_to_twilio')
       AND sb.no_send_reason !~* '(blocked|no_send|stale|memory|freshness|missing|required|compliance|safety|duplicate|tapback|not_fully_on_v2|no_active_commitment|outside_send_window)'
       AND sb.skip_source = '' THEN true
      ELSE false
    END AS visible_sent,
    (sb.status ~* 'accepted' AND sb.body_preview <> '') AS accepted_visible_candidate,
    (sb.body_preview <> '') AS has_body_path_coverage
  FROM send_base sb
),
inbounds AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz
    ) AS inbound_at,
    COALESCE(to_jsonb(m)->>'clerk_user_id', to_jsonb(m)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(m)->>'message_sid', '') AS message_sid,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''),
      NULLIF(BTRIM(to_jsonb(m)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(m)->>'message_body'), ''),
      ''
    ) AS inbound_body
  FROM sms_inbound_messages m
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz
    ) < b.window_end
),
inbound_jobs AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) AS job_at,
    COALESCE(to_jsonb(j)->>'clerk_user_id', to_jsonb(j)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(j)->>'message_sid', '') AS inbound_message_sid,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''),
      NULLIF(BTRIM(to_jsonb(j)#>>'{metadata,raw_body}'), ''),
      ''
    ) AS job_raw_body,
    COALESCE(to_jsonb(j)->>'status', '') AS job_status,
    COALESCE(to_jsonb(j)->>'last_error', '') AS last_error_raw
  FROM sms_inbound_coach_jobs j
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) >= b.window_start - interval '1 hour'
    AND COALESCE(
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) < b.window_end + interval '1 hour'
),
inbound_pairing AS (
  SELECT
    i.*,
    j.job_at,
    j.job_status,
    CASE
      WHEN j.inbound_message_sid = i.message_sid THEN 'exact_message_sid'
      WHEN j.clerk_user_id = i.clerk_user_id AND BTRIM(j.job_raw_body) = BTRIM(i.inbound_body) AND BTRIM(i.inbound_body) <> '' THEN 'exact_raw_body'
      WHEN j.clerk_user_id = i.clerk_user_id
        AND j.job_at >= i.inbound_at
        AND j.job_at <= i.inbound_at + interval '60 minutes' THEN 'nearest_future_same_user'
      ELSE 'no_job_found'
    END AS pairing_quality,
    COALESCE(
      NULLIF(BTRIM((regexp_match(j.last_error_raw, '"no_send_reason"\s*:\s*"([^"]+)"'))[1]), ''),
      NULLIF(BTRIM((regexp_match(j.last_error_raw, '"inbound_reply_no_send_reason"\s*:\s*"([^"]+)"'))[1]), ''),
      ''
    ) AS actual_job_no_send_reason
  FROM inbounds i
  LEFT JOIN LATERAL (
    SELECT j2.*,
      CASE
        WHEN j2.inbound_message_sid = i.message_sid THEN 1
        WHEN j2.clerk_user_id = i.clerk_user_id AND BTRIM(j2.job_raw_body) = BTRIM(i.inbound_body) AND BTRIM(i.inbound_body) <> '' THEN 2
        WHEN j2.clerk_user_id = i.clerk_user_id
          AND j2.job_at >= i.inbound_at
          AND j2.job_at <= i.inbound_at + interval '60 minutes' THEN 3
        ELSE 99
      END AS pairing_rank
    FROM inbound_jobs j2
    WHERE j2.inbound_message_sid = i.message_sid
       OR (j2.clerk_user_id = i.clerk_user_id AND BTRIM(j2.job_raw_body) = BTRIM(i.inbound_body) AND BTRIM(i.inbound_body) <> '')
       OR (j2.clerk_user_id = i.clerk_user_id AND j2.job_at >= i.inbound_at AND j2.job_at <= i.inbound_at + interval '60 minutes')
    ORDER BY pairing_rank ASC, j2.job_at ASC
    LIMIT 1
  ) j ON true
),
weekly_send_obs AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) AS event_at,
    COALESCE(to_jsonb(w)->>'clerk_user_id', to_jsonb(w)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(w)->>'status', '') AS status,
    COALESCE(to_jsonb(w)->>'message_sid', to_jsonb(w)->>'outbound_message_sid', to_jsonb(w)#>>'{metadata,message_sid}', '') AS message_sid,
    COALESCE(
      NULLIF(BTRIM(to_jsonb(w)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,north_star_gate,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,north_star_gate,original_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,v3_candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_voice_gate,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_voice_gate,final_body_with_suffix}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_voice_gate,final_voice_gate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,voice_send_decision,north_star_visible_body}'), ''),
      ''
    ) AS body_preview
  FROM sms_weekly_send_events w
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
issues AS (
  SELECT
    'Query 01 / 03 denominator unreliable'::text AS impacted_query,
    'blocker'::text AS severity,
    'skipped_status_wrongly_eligible_without_status_gate'::text AS issue_kind,
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    ''::text AS pairing_quality,
    ''::text AS actual_job_no_send_reason,
    'Legitimate skip status would be counted eligible if status gate missing'::text AS diagnostic_detail
  FROM classified_base cb
  WHERE cb.status ~* '^skipped_(not_fully_on_v2|no_active_commitment|duplicate|tapback|compliance|safety|crisis|invalid_phone|outside_send_window|active_inbound_thread|sunday_weekly_pause)$'
    AND cb.no_send_reason = ''
    AND cb.skip_source = ''

  UNION ALL

  SELECT
    'Query 01 / 03 denominator unreliable',
    'warning',
    'eligible_row_missing_no_send_or_skip_source',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'Eligible coaching row has empty no_send_reason and skip_source — denominator may over-count'
  FROM classified_base cb
  WHERE cb.eligible_coaching_row
    AND NOT cb.visible_sent
    AND cb.no_send_reason = ''
    AND cb.skip_source = ''
    AND cb.body_preview = ''

  UNION ALL

  SELECT
    'Query 06 inbound pairing unreliable',
    CASE WHEN ip.pairing_quality = 'no_job_found' THEN 'blocker' ELSE 'warning' END,
    'weak_inbound_job_pairing',
    ip.inbound_at,
    ip.clerk_user_id,
    COALESCE(ip.job_status, ''),
    '',
    '',
    ip.pairing_quality,
    COALESCE(ip.actual_job_no_send_reason, ''),
    CASE
      WHEN ip.pairing_quality = 'no_job_found' THEN 'Inbound message has no coach job within pairing rules'
      WHEN ip.pairing_quality = 'nearest_future_same_user' THEN 'Inbound paired by time proximity only — verify message_sid/raw_body'
      ELSE 'Inbound pairing quality review'
    END
  FROM inbound_pairing ip
  WHERE ip.pairing_quality IN ('no_job_found', 'nearest_future_same_user')
    AND LENGTH(BTRIM(ip.inbound_body)) > 20

  UNION ALL

  SELECT
    'Query 06 inbound pairing unreliable',
    'warning',
    'cancelled_job_missing_extracted_no_send_reason',
    ip.inbound_at,
    ip.clerk_user_id,
    ip.job_status,
    '',
    '',
    ip.pairing_quality,
    ip.actual_job_no_send_reason,
    'Cancelled inbound coach job has last_error but extracted actual_job_no_send_reason is empty'
  FROM inbound_pairing ip
  WHERE ip.job_status ~* 'cancelled'
    AND ip.pairing_quality <> 'no_job_found'
    AND ip.actual_job_no_send_reason = ''
    AND EXISTS (
      SELECT 1 FROM inbound_jobs j
      WHERE j.inbound_message_sid = ip.message_sid
        AND j.last_error_raw <> ''
    )

  UNION ALL

  SELECT
    'Query 08 truth-loss unreliable',
    'blocker',
    'cancelled_inbound_possible_truth_loss',
    ip.inbound_at,
    ip.clerk_user_id,
    ip.job_status,
    COALESCE(ip.actual_job_no_send_reason, ''),
    '',
    ip.pairing_quality,
    ip.actual_job_no_send_reason,
    'Cancelled inbound job — verify truth persistence before writer (Q08 no_send_truth_diagnostic)'
  FROM inbound_pairing ip
  WHERE ip.job_status ~* 'cancelled'
    AND ip.pairing_quality IN ('exact_message_sid', 'exact_raw_body')
    AND LENGTH(BTRIM(ip.inbound_body)) > 20

  UNION ALL

  SELECT
    'Query 11 pending classification unreliable',
    'warning',
    'stale_ask_visible_in_raw_json_only',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'raw_json mentions turn_understanding_stale_ask_blocked but extracted no_send_reason path empty — Q11 may misclassify'
  FROM classified_base cb
  WHERE cb.raw_json::text ~* 'turn_understanding_stale_ask_blocked'
    AND cb.no_send_reason !~* 'turn_understanding_stale_ask_blocked'
    AND COALESCE(
      cb.raw_json#>>'{metadata,unified_final_product_law_guard,no_send_reason}',
      cb.raw_json#>>'{metadata,unified_final_guard_no_send_reason}',
      cb.raw_json#>>'{metadata,voice_send_decision,no_send_reason}',
      cb.raw_json#>>'{metadata,no_send_reason}',
      ''
    ) !~* 'turn_understanding_stale_ask_blocked'

  UNION ALL

  SELECT
    'Query 12 final/side-room classification unreliable',
    'warning',
    'guard_mention_raw_json_only',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'Final guard / side-room keywords only in raw_json with empty body — Q12 may emit raw_json_only_noise_review'
  FROM classified_base cb
  WHERE cb.body_preview = ''
    AND cb.no_send_reason = ''
    AND cb.skip_source = ''
    AND cb.raw_json::text ~* '(unified_final_product_law_guard|final_voice_gate|north_star|side_room|legacy_fallback)'

  UNION ALL

  SELECT
    'Query 01 / 03 denominator unreliable',
    'info',
    'body_path_coverage_gap',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'Row lacks body_preview path coverage — visible/eligible classification may be wrong'
  FROM classified_base cb
  WHERE NOT cb.has_body_path_coverage
    AND (cb.status ~* '(sent|delivered|accepted)' OR cb.message_sid <> '')

  UNION ALL

  SELECT
    'Query 03 / 04 coach-body duplicate telemetry unreliable',
    'warning',
    'coach_body_duplicate_raw_json_only',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'raw_json mentions coach_body_near_duplicate but extracted coach_body_near_duplicate_detected / memory_repeat_no_send_reason / prior_coach_body_preview paths are empty'
  FROM classified_base cb
  WHERE cb.raw_json::text ~* 'coach_body_near_duplicate'
    AND cb.coach_body_near_duplicate_detected = ''
    AND cb.daily_coach_body_near_duplicate_blocked = ''
    AND cb.memory_repeat_no_send_reason = ''
    AND cb.prior_coach_body_preview = ''

  UNION ALL

  SELECT
    'Query 04 memory/thread freshness unreliable',
    'warning',
    'coach_body_duplicate_blocked_but_diagnostic_blank',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'Coach-body near-duplicate telemetry present in metadata paths but Q04 may miss if lane_stage/no_send_reason paths differ'
  FROM classified_base cb
  WHERE (
      cb.coach_body_near_duplicate_detected ~* 'true'
      OR cb.daily_coach_body_near_duplicate_blocked ~* 'true'
      OR cb.memory_repeat_no_send_reason = 'coach_body_near_duplicate'
    )
    AND cb.no_send_reason !~* 'memory|repeat|thread'
    AND cb.memory_repeat_guard_attempted = ''

  UNION ALL

  SELECT
    'Query 01 / 02 DailySmsWritingBriefV1 telemetry unreliable',
    'warning',
    'brief_telemetry_missing_on_c1_sent',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'Visible C1 daily send missing writer_prompt_path / daily_writing_brief_used in relationship_packet_observability paths'
  FROM classified_base cb
  WHERE cb.visible_sent
    AND cb.route_kind IN ('main_active_accountability', 'low_pressure_reactivation', '')
    AND cb.writer_prompt_path = ''
    AND cb.daily_writing_brief_used = ''
    AND cb.raw_json::text ~* 'sent_to_twilio|v2_accountability'

  UNION ALL

  SELECT
    'Query 01 / 02 DailySmsWritingBriefV1 telemetry unreliable',
    'warning',
    'writer_prompt_path_unknown_on_visible_daily_send',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'Visible daily send has empty writer_prompt_path — cannot confirm brief vs legacy hallway'
  FROM classified_base cb
  WHERE cb.visible_sent
    AND cb.writer_prompt_path = ''
    AND cb.body_preview <> ''

  UNION ALL

  SELECT
    'Query 01 DailySmsWritingBriefV1 telemetry unreliable',
    'info',
    'daily_writing_brief_used_missing',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'C1-eligible visible send missing daily_writing_brief_used telemetry'
  FROM classified_base cb
  WHERE cb.visible_sent
    AND cb.route_kind IN ('main_active_accountability', 'low_pressure_reactivation')
    AND cb.daily_writing_brief_used = ''

  UNION ALL

  SELECT
    'Query 01 DailySmsWritingBriefV1 telemetry unreliable',
    'info',
    'writer_total_chars_missing',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'Visible daily send missing writer_total_chars — prompt size SQL may under-report'
  FROM classified_base cb
  WHERE cb.visible_sent
    AND cb.writer_total_chars = ''
    AND cb.writer_prompt_path = 'daily_writing_brief_v1'

  UNION ALL

  SELECT
    'Query 01 / 02 DailySmsWritingBriefV1 telemetry unreliable',
    'warning',
    'c1_legacy_without_skip_reason',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'C1-eligible visible send used legacy_packet_v1 but daily_writing_brief_skip_reason is blank'
  FROM classified_base cb
  WHERE cb.visible_sent
    AND cb.route_kind IN ('main_active_accountability', 'low_pressure_reactivation')
    AND cb.writer_prompt_path = 'legacy_packet_v1'
    AND cb.daily_writing_brief_skip_reason = ''

  UNION ALL

  SELECT
    'Query 01 / 02 DailySmsWritingBriefV1 telemetry unreliable',
    'warning',
    'c1_brief_used_missing_suggested_move',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'Brief build_status=used but daily_suggested_move telemetry missing'
  FROM classified_base cb
  WHERE cb.visible_sent
    AND cb.writer_prompt_path = 'daily_writing_brief_v1'
    AND cb.daily_writing_brief_build_status = 'used'
    AND cb.daily_suggested_move = ''

  UNION ALL

  SELECT
    'Query 01 / 02 DailySmsWritingBriefV1 telemetry unreliable',
    'info',
    'c1_brief_thread_counts_missing',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'Brief used but thread floor/extension counts missing from observability paths'
  FROM classified_base cb
  WHERE cb.visible_sent
    AND cb.writer_prompt_path = 'daily_writing_brief_v1'
    AND cb.daily_writing_brief_build_status = 'used'
    AND cb.daily_brief_thread_floor_message_count = ''
    AND cb.daily_brief_thread_extension_message_count = ''

  UNION ALL

  SELECT
    'Query 01 / 02 DailySmsWritingBriefV1 telemetry unreliable',
    'info',
    'c1_freshness_count_without_preview',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'daily_freshness_avoid_count > 0 but daily_freshness_avoid_phrases_preview blank'
  FROM classified_base cb
  WHERE cb.visible_sent
    AND cb.writer_prompt_path = 'daily_writing_brief_v1'
    AND COALESCE(NULLIF(cb.daily_freshness_avoid_count, ''), '0')::int > 0
    AND cb.daily_freshness_avoid_phrases_preview = ''

  UNION ALL

  SELECT
    'Query 01 / 02 DailySmsWritingBriefV1 telemetry unreliable',
    'info',
    'c1_open_loop_flags_missing',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'Brief used but daily_open_loop_pending_active flag missing from observability paths'
  FROM classified_base cb
  WHERE cb.visible_sent
    AND cb.writer_prompt_path = 'daily_writing_brief_v1'
    AND cb.daily_writing_brief_build_status = 'used'
    AND cb.daily_open_loop_pending_active = ''

  UNION ALL

  SELECT
    'Query 01 / 02 DailySmsWritingBriefV1 telemetry unreliable',
    'warning',
    'c1_brief_missing_timing_observability',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'Brief used but daily_timing_guidance_present / daily_local_daypart missing from observability paths'
  FROM classified_base cb
  WHERE cb.visible_sent
    AND cb.writer_prompt_path = 'daily_writing_brief_v1'
    AND cb.daily_writing_brief_build_status = 'used'
    AND (cb.daily_timing_guidance_present = '' OR cb.daily_local_daypart = '')

  UNION ALL

  SELECT
    'Query 01 / 02 DailySmsWritingBriefV1 telemetry unreliable',
    'info',
    'c1_brief_missing_durable_memory_observability',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'Brief used but daily_durable_memory_item_count missing from observability paths'
  FROM classified_base cb
  WHERE cb.visible_sent
    AND cb.writer_prompt_path = 'daily_writing_brief_v1'
    AND cb.daily_writing_brief_build_status = 'used'
    AND cb.daily_durable_memory_item_count = ''

  UNION ALL

  SELECT
    'Query 01 / 02 DailySmsWritingBriefV1 telemetry unreliable',
    'warning',
    'c1_brief_durable_memory_not_background_only',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'Brief durable memory telemetry reports daily_durable_memory_background_only is not true'
  FROM classified_base cb
  WHERE cb.visible_sent
    AND cb.writer_prompt_path = 'daily_writing_brief_v1'
    AND cb.daily_writing_brief_build_status = 'used'
    AND cb.daily_durable_memory_background_only <> ''
    AND cb.daily_durable_memory_background_only !~* 'true'

  UNION ALL

  SELECT
    'Query 01 / 02 DailySmsWritingBriefV1 telemetry unreliable',
    'info',
    'c1_brief_missing_daypart',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'Brief used but daily_local_daypart missing — morning/evening copy-risk SQL may be blind'
  FROM classified_base cb
  WHERE cb.visible_sent
    AND cb.writer_prompt_path = 'daily_writing_brief_v1'
    AND cb.daily_writing_brief_build_status = 'used'
    AND cb.daily_local_daypart = ''

  UNION ALL

  SELECT
    'Query 01 / 02 DailySmsWritingBriefV1 telemetry unreliable',
    'warning',
    'c1_brief_thread_over_cap',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'Brief thread_message_count telemetry exceeds cap of 25'
  FROM classified_base cb
  WHERE cb.visible_sent
    AND cb.writer_prompt_path = 'daily_writing_brief_v1'
    AND COALESCE(NULLIF(cb.daily_brief_thread_message_count, ''), '0')::int > 25

  UNION ALL

  SELECT
    'Query 01 / 02 DailySmsWritingBriefV1 telemetry unreliable',
    'warning',
    'c1_brief_oldest_newest_reversed',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'Brief thread oldest_at_local is chronologically after newest_at_local'
  FROM classified_base cb
  WHERE cb.visible_sent
    AND cb.writer_prompt_path = 'daily_writing_brief_v1'
    AND cb.daily_brief_thread_oldest_at_local <> ''
    AND cb.daily_brief_thread_newest_at_local <> ''
    AND to_timestamp(cb.daily_brief_thread_oldest_at_local, 'Dy Mon DD HH12:MI AM')
      > to_timestamp(cb.daily_brief_thread_newest_at_local, 'Dy Mon DD HH12:MI AM')

  UNION ALL

  SELECT
    'Query 01 / 02 DailySmsWritingBriefV1 telemetry unreliable',
    'warning',
    'c1_brief_empty_thread_with_prior_visible',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'Brief used with thread_message_count <= 1 despite prior visible coach sends in timeline'
  FROM classified_base cb
  WHERE cb.visible_sent
    AND cb.writer_prompt_path = 'daily_writing_brief_v1'
    AND cb.daily_writing_brief_build_status = 'used'
    AND COALESCE(NULLIF(cb.daily_brief_thread_message_count, ''), '0')::int <= 1
    AND EXISTS (
      SELECT 1
      FROM sms_send_events s2
      WHERE COALESCE(to_jsonb(s2)->>'clerk_user_id', to_jsonb(s2)#>>'{metadata,clerk_user_id}', '') = cb.clerk_user_id
        AND COALESCE(
          NULLIF(to_jsonb(s2)->>'created_at', '')::timestamptz,
          NULLIF(to_jsonb(s2)->>'sent_at', '')::timestamptz,
          NULLIF(to_jsonb(s2)->>'updated_at', '')::timestamptz
        ) < cb.event_at
        AND COALESCE(
          NULLIF(BTRIM(to_jsonb(s2)->>'sms_body'), ''),
          NULLIF(BTRIM(to_jsonb(s2)->>'body'), ''),
          NULLIF(BTRIM(to_jsonb(s2)->>'final_body'), ''),
          NULLIF(BTRIM(to_jsonb(s2)#>>'{metadata,daily_v3_lane,final_body}'), ''),
          ''
        ) <> ''
        AND (
          COALESCE(to_jsonb(s2)->>'status', '') ~* '(sent|delivered|queued|success|accepted|sending)'
          OR COALESCE(to_jsonb(s2)->>'message_sid', to_jsonb(s2)->>'outbound_message_sid', '') <> ''
        )
    )

  UNION ALL

  SELECT
    'Query 01 / 02 DailySmsWritingBriefV1 telemetry unreliable',
    'warning',
    'c1_freshness_missed_visible_cta',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'Prior visible coach CTA (hour/distribution) not reflected in freshness_avoid_phrases_preview'
  FROM classified_base cb
  WHERE cb.visible_sent
    AND cb.writer_prompt_path = 'daily_writing_brief_v1'
    AND cb.body_preview ~* '(hour.{0,30}distribution|distribution.{0,30}hour|that hour.{0,20}distribution|the hour.{0,20}distribution)'
    AND cb.daily_freshness_avoid_phrases_preview !~* '(hour.{0,30}distribution|distribution.{0,30}hour)'

  UNION ALL

  SELECT
    'Query 02 / 11 / 14 weekly body unreliable',
    'warning',
    'weekly_body_missing_with_sid',
    w.event_at,
    w.clerk_user_id,
    w.status,
    '',
    '',
    '',
    '',
    'Weekly row has Twilio SID or sent status but all known body paths are empty — Q14/thread review may hide Pat Pause text'
  FROM weekly_send_obs w
  WHERE (
      w.status ~* '(sent|delivered|queued|accepted|sending|success)'
      OR w.message_sid <> ''
    )
    AND w.body_preview = ''

  UNION ALL

  SELECT
    'Query 01 / 03 / 14 Sunday weekly pause',
    'warning',
    'sunday_daily_suppressed_before_weekly',
    cb.event_at,
    cb.clerk_user_id,
    cb.status,
    cb.no_send_reason,
    cb.skip_source,
    '',
    '',
    'Daily intentionally suppressed for Sunday weekly pause but no visible weekly send same local Sunday — check Q14 for weekly body; user may have zero proactive touch'
  FROM classified_base cb
  WHERE (
      cb.status = 'skipped_sunday_weekly_pause'
      OR cb.no_send_reason = 'skipped_sunday_weekly_pause'
      OR cb.skip_source = 'sunday_weekly_pause'
    )
    AND EXTRACT(DOW FROM cb.event_at AT TIME ZONE 'America/New_York') = 0
    AND NOT EXISTS (
      SELECT 1
      FROM weekly_send_obs w
      WHERE w.clerk_user_id = cb.clerk_user_id
        AND (w.event_at AT TIME ZONE 'America/New_York')::date
          = (cb.event_at AT TIME ZONE 'America/New_York')::date
        AND (
          w.status ~* '(sent|delivered|queued|accepted|sending|success)'
          OR w.message_sid <> ''
        )
        AND w.body_preview <> ''
    )
),
agg AS (
  SELECT
    COUNT(*) AS total_daily_rows,
    COUNT(*) FILTER (WHERE eligible_coaching_row) AS eligible_daily_rows,
    COUNT(*) FILTER (WHERE visible_sent) AS visible_sends,
    COUNT(*) FILTER (WHERE could_make_sql_lie) AS rows_that_could_make_sql_lie
  FROM (
    SELECT
      cb.*,
      (
        (cb.eligible_coaching_row AND NOT cb.visible_sent AND cb.no_send_reason = '' AND cb.skip_source = '' AND cb.body_preview = '')
        OR (cb.visible_sent AND cb.body_preview = '')
        OR (cb.status ~* 'accepted' AND cb.body_preview = '' AND cb.message_sid <> '')
        OR (cb.eligible_coaching_row AND cb.no_send_reason ~* '(memory|thread|freshness|stale)' AND cb.memory_repeat_guard_attempted = '' AND cb.thread_freshness_violation_reason = '')
      ) AS could_make_sql_lie
    FROM classified_base cb
  ) x
)
SELECT
  b.window_start,
  b.window_end,
  i.impacted_query,
  i.severity,
  i.issue_kind,
  i.event_at,
  (i.event_at AT TIME ZONE 'America/New_York')::date AS local_day,
  i.clerk_user_id,
  i.status,
  i.no_send_reason,
  i.skip_source,
  i.pairing_quality,
  i.actual_job_no_send_reason,
  i.diagnostic_detail,
  a.total_daily_rows,
  a.eligible_daily_rows,
  a.visible_sends,
  a.rows_that_could_make_sql_lie
FROM bounds b
CROSS JOIN agg a
LEFT JOIN issues i ON true
WHERE i.issue_kind IS NOT NULL
ORDER BY
  CASE i.severity WHEN 'blocker' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
  i.event_at DESC NULLS LAST;


-- =============================================================================
-- QUERY 14 — relationship_thread_review
-- Saved query name: SM_AUDIT_14_Relationship_Thread_Review
-- Purpose: Chronological user/coach relationship thread for manual review (visible rows only).
-- Default window: last 9 days
-- MANUAL DATE OVERRIDE (optional — replace bounds lines below):
--   timestamptz '2026-06-10 00:00:00 America/New_York' AS window_start,
--   timestamptz '2026-06-19 00:00:00 America/New_York' AS window_end
-- =============================================================================

WITH bounds AS (
  SELECT
    now() - interval '9 days' AS window_start,
    now() AS window_end
),
user_inbound AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz
    ) AS event_at,
    'user_inbound'::text AS event_source,
    'user'::text AS thread_role,
    COALESCE(to_jsonb(m)->>'clerk_user_id', to_jsonb(m)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(m)->>'message_sid', to_jsonb(m)#>>'{metadata,message_sid}', '') AS message_sid,
    ''::text AS outbound_message_sid,
    ''::text AS status,
    ''::text AS route_kind,
    ''::text AS note,
    ''::text AS no_send_reason,
    ''::text AS voice_no_send_reason,
    ''::text AS lane_no_send_reason,
    ''::text AS skip_source,
    LEFT(COALESCE(
      NULLIF(BTRIM(to_jsonb(m)->>'raw_body'), ''),
      NULLIF(BTRIM(to_jsonb(m)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(m)->>'message_body'), ''),
      NULLIF(BTRIM(to_jsonb(m)#>>'{metadata,raw_body}'), ''),
      NULLIF(BTRIM(to_jsonb(m)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(m)#>>'{metadata,message_body}'), ''),
      ''
    ), 1200) AS body_preview,
    NULL::jsonb AS raw_json
  FROM sms_inbound_messages m
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(m)->>'received_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(m)->>'inserted_at', '')::timestamptz
    ) < b.window_end
),
user_inbound_job AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz
    ) AS event_at,
    'user_inbound_job'::text AS event_source,
    'user'::text AS thread_role,
    COALESCE(to_jsonb(j)->>'clerk_user_id', to_jsonb(j)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(j)->>'message_sid', to_jsonb(j)#>>'{metadata,message_sid}', '') AS message_sid,
    ''::text AS outbound_message_sid,
    COALESCE(to_jsonb(j)->>'status', '') AS status,
    COALESCE(to_jsonb(j)#>>'{metadata,route_purpose}', to_jsonb(j)#>>'{metadata,branch_name}', '') AS route_kind,
    COALESCE(to_jsonb(j)#>>'{metadata,note}', '') AS note,
    COALESCE(to_jsonb(j)->>'no_send_reason', to_jsonb(j)#>>'{metadata,no_send_reason}', '') AS no_send_reason,
    COALESCE(to_jsonb(j)#>>'{metadata,voice_send_decision,no_send_reason}', '') AS voice_no_send_reason,
    COALESCE(to_jsonb(j)#>>'{metadata,daily_v3_lane,no_send_reason}', '') AS lane_no_send_reason,
    COALESCE(to_jsonb(j)#>>'{metadata,skip_source}', '') AS skip_source,
    LEFT(COALESCE(
      NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''),
      NULLIF(BTRIM(to_jsonb(j)#>>'{metadata,raw_body}'), ''),
      ''
    ), 1200) AS body_preview,
    NULL::jsonb AS raw_json
  FROM sms_inbound_coach_jobs j
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz
    ) < b.window_end
    AND COALESCE(
      NULLIF(BTRIM(to_jsonb(j)->>'raw_body'), ''),
      NULLIF(BTRIM(to_jsonb(j)#>>'{metadata,raw_body}'), ''),
      ''
    ) <> ''
),
coach_inbound_reply AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) AS event_at,
    'coach_inbound_reply'::text AS event_source,
    'coach'::text AS thread_role,
    COALESCE(to_jsonb(j)->>'clerk_user_id', to_jsonb(j)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(j)->>'message_sid', to_jsonb(j)#>>'{metadata,message_sid}', '') AS message_sid,
    COALESCE(to_jsonb(j)->>'outbound_message_sid', to_jsonb(j)#>>'{metadata,outbound_message_sid}', '') AS outbound_message_sid,
    COALESCE(to_jsonb(j)->>'status', '') AS status,
    COALESCE(to_jsonb(j)#>>'{metadata,route_purpose}', to_jsonb(j)#>>'{metadata,branch_name}', '') AS route_kind,
    COALESCE(to_jsonb(j)#>>'{metadata,note}', '') AS note,
    COALESCE(to_jsonb(j)->>'no_send_reason', to_jsonb(j)#>>'{metadata,no_send_reason}', '') AS no_send_reason,
    COALESCE(to_jsonb(j)#>>'{metadata,voice_send_decision,no_send_reason}', '') AS voice_no_send_reason,
    COALESCE(to_jsonb(j)#>>'{metadata,daily_v3_lane,no_send_reason}', '') AS lane_no_send_reason,
    COALESCE(to_jsonb(j)#>>'{metadata,skip_source}', '') AS skip_source,
    LEFT(COALESCE(
      NULLIF(BTRIM(to_jsonb(j)->>'reply_body'), ''),
      NULLIF(BTRIM(to_jsonb(j)#>>'{metadata,reply_body}'), ''),
      ''
    ), 1200) AS body_preview,
    to_jsonb(j) AS raw_json
  FROM sms_inbound_coach_jobs j
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(j)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(j)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
coach_daily_outbound AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) AS event_at,
    'coach_daily_outbound'::text AS event_source,
    'coach'::text AS thread_role,
    COALESCE(to_jsonb(s)->>'clerk_user_id', to_jsonb(s)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(s)->>'message_sid', to_jsonb(s)#>>'{metadata,message_sid}', '') AS message_sid,
    COALESCE(to_jsonb(s)->>'outbound_message_sid', to_jsonb(s)#>>'{metadata,outbound_message_sid}', '') AS outbound_message_sid,
    COALESCE(to_jsonb(s)->>'status', to_jsonb(s)#>>'{metadata,status}', '') AS status,
    COALESCE(
      to_jsonb(s)#>>'{metadata,route_kind}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,route_kind}',
      to_jsonb(s)#>>'{metadata,relationship_packet_observability,strategy_card_route_kind}',
      ''
    ) AS route_kind,
    COALESCE(to_jsonb(s)#>>'{metadata,note}', '') AS note,
    COALESCE(
      to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}',
      to_jsonb(s)#>>'{metadata,no_send_reason}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}',
      to_jsonb(s)->>'no_send_reason',
      ''
    ) AS no_send_reason,
    COALESCE(to_jsonb(s)#>>'{metadata,voice_send_decision,no_send_reason}', '') AS voice_no_send_reason,
    COALESCE(to_jsonb(s)#>>'{metadata,daily_v3_lane,no_send_reason}', '') AS lane_no_send_reason,
    COALESCE(
      to_jsonb(s)#>>'{metadata,skip_source}',
      to_jsonb(s)#>>'{metadata,voice_send_decision,skip_source}',
      to_jsonb(s)#>>'{metadata,daily_v3_lane,skip_source}',
      ''
    ) AS skip_source,
    LEFT(COALESCE(
      NULLIF(BTRIM(to_jsonb(s)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'message_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(s)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,voice_send_decision,north_star_visible_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,final_voice_gate,final_voice_gate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,daily_v3_lane,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(s)#>>'{metadata,v3_brain,body}'), ''),
      ''
    ), 1200) AS body_preview,
    to_jsonb(s) AS raw_json
  FROM sms_send_events s
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(s)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(s)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
coach_weekly_outbound AS (
  SELECT
    COALESCE(
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) AS event_at,
    'coach_weekly_outbound'::text AS event_source,
    'coach'::text AS thread_role,
    COALESCE(to_jsonb(w)->>'clerk_user_id', to_jsonb(w)#>>'{metadata,clerk_user_id}') AS clerk_user_id,
    COALESCE(to_jsonb(w)->>'message_sid', to_jsonb(w)#>>'{metadata,message_sid}', '') AS message_sid,
    COALESCE(to_jsonb(w)->>'outbound_message_sid', to_jsonb(w)#>>'{metadata,outbound_message_sid}', '') AS outbound_message_sid,
    COALESCE(to_jsonb(w)->>'status', to_jsonb(w)#>>'{metadata,status}', '') AS status,
    'weekly'::text AS route_kind,
    COALESCE(to_jsonb(w)#>>'{metadata,note}', '') AS note,
    COALESCE(to_jsonb(w)->>'no_send_reason', to_jsonb(w)#>>'{metadata,no_send_reason}', '') AS no_send_reason,
    COALESCE(to_jsonb(w)#>>'{metadata,voice_send_decision,no_send_reason}', '') AS voice_no_send_reason,
    COALESCE(to_jsonb(w)#>>'{metadata,daily_v3_lane,no_send_reason}', '') AS lane_no_send_reason,
    COALESCE(to_jsonb(w)#>>'{metadata,skip_source}', '') AS skip_source,
    LEFT(COALESCE(
      NULLIF(BTRIM(to_jsonb(w)->>'body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'sms_body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'final_body'), ''),
      NULLIF(BTRIM(to_jsonb(w)->>'body_preview'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,sms_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,north_star_gate,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,north_star_gate,original_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,v3_candidate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_voice_gate,final_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_voice_gate,final_body_with_suffix}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,final_voice_gate,final_voice_gate_body}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,voice_send_decision,body_preview}'), ''),
      NULLIF(BTRIM(to_jsonb(w)#>>'{metadata,voice_send_decision,north_star_visible_body}'), ''),
      ''
    ), 1200) AS body_preview,
    to_jsonb(w) AS raw_json
  FROM sms_weekly_send_events w
  CROSS JOIN bounds b
  WHERE COALESCE(
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) >= b.window_start
    AND COALESCE(
      NULLIF(to_jsonb(w)->>'sent_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'processed_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'created_at', '')::timestamptz,
      NULLIF(to_jsonb(w)->>'updated_at', '')::timestamptz
    ) < b.window_end
),
thread_union AS (
  SELECT * FROM user_inbound
  UNION ALL SELECT * FROM user_inbound_job
  UNION ALL SELECT * FROM coach_inbound_reply
  UNION ALL SELECT * FROM coach_daily_outbound
  UNION ALL SELECT * FROM coach_weekly_outbound
),
classified AS (
  SELECT
    u.*,
    CASE
      WHEN u.thread_role = 'user'
       AND u.body_preview <> ''
       AND NOT (
         LENGTH(BTRIM(u.body_preview)) <= 12
         AND BTRIM(u.body_preview) ~* '^(stop|start|help|unstop|cancel)$'
       )
      THEN true
      WHEN u.thread_role = 'coach'
       AND u.body_preview <> ''
       AND u.note <> 'daily_v3_lane_no_send'
       AND u.no_send_reason = ''
       AND u.voice_no_send_reason = ''
       AND u.lane_no_send_reason = ''
       AND u.skip_source = ''
       AND NOT (u.status ~* '^(skipped|reserved|cancelled|canceled|preview|dry_run)$' OR u.status LIKE 'skipped_%')
       AND (
         u.status ~* '(sent|delivered|queued|accepted|sending|success)'
         OR u.message_sid <> ''
         OR u.outbound_message_sid <> ''
         OR u.note = 'sent_to_twilio'
       )
       AND (
         u.event_source <> 'coach_inbound_reply'
         OR (
           u.status ~* 'sent'
           OR u.outbound_message_sid <> ''
           OR COALESCE(to_jsonb(u.raw_json)->>'sent_at', '') <> ''
         )
       )
      THEN true
      ELSE false
    END AS visible_relationship_row,
    CASE
      WHEN u.body_preview = '' THEN 'empty_body'
      WHEN u.thread_role = 'user'
       AND LENGTH(BTRIM(u.body_preview)) <= 12
       AND BTRIM(u.body_preview) ~* '^(stop|start|help|unstop|cancel)$'
      THEN 'compliance_command'
      WHEN u.note = 'daily_v3_lane_no_send' THEN 'daily_v3_lane_no_send'
      WHEN u.no_send_reason <> '' OR u.voice_no_send_reason <> '' OR u.lane_no_send_reason <> '' THEN 'no_send_reason'
      WHEN u.skip_source <> '' THEN 'skip_source'
      WHEN u.status ~* '^(skipped|reserved|cancelled|canceled|preview|dry_run)$' OR u.status LIKE 'skipped_%' THEN 'skipped_or_cancelled_or_preview'
      WHEN u.thread_role = 'coach'
       AND u.event_source = 'coach_inbound_reply'
       AND NOT (
         u.status ~* 'sent'
         OR u.outbound_message_sid <> ''
         OR COALESCE(to_jsonb(u.raw_json)->>'sent_at', '') <> ''
       )
      THEN 'inbound_reply_not_sent'
      WHEN u.thread_role = 'coach'
       AND NOT (
         u.status ~* '(sent|delivered|queued|accepted|sending|success)'
         OR u.message_sid <> ''
         OR u.outbound_message_sid <> ''
         OR u.note = 'sent_to_twilio'
       )
      THEN 'not_visible_sent'
      ELSE ''
    END AS exclusion_reason
  FROM thread_union u
  WHERE u.event_at IS NOT NULL
),
deduped AS (
  SELECT
    c.*,
    ROW_NUMBER() OVER (
      PARTITION BY c.clerk_user_id, c.thread_role,
        COALESCE(
          NULLIF(c.message_sid, ''),
          NULLIF(c.outbound_message_sid, ''),
          c.event_at::text || '|' || c.event_source
        )
      ORDER BY c.event_at
    ) AS coach_sid_dup_rank,
    ROW_NUMBER() OVER (
      PARTITION BY c.clerk_user_id, c.thread_role,
        LEFT(REGEXP_REPLACE(LOWER(BTRIM(c.body_preview)), '[^a-z0-9 ]', '', 'g'), 100),
        (EXTRACT(EPOCH FROM c.event_at)::bigint / 5)
      ORDER BY
        CASE c.event_source WHEN 'user_inbound' THEN 0 WHEN 'user_inbound_job' THEN 1 ELSE 0 END,
        c.event_at
    ) AS user_near_dup_rank
  FROM classified c
),
visible_deduped AS (
  SELECT
    d.*,
    CASE
      WHEN NOT d.visible_relationship_row THEN d.exclusion_reason
      WHEN d.thread_role = 'coach'
       AND (d.message_sid <> '' OR d.outbound_message_sid <> '')
       AND d.coach_sid_dup_rank > 1
      THEN 'duplicate_message_sid'
      WHEN d.thread_role = 'user'
       AND d.user_near_dup_rank > 1
      THEN 'duplicate_user_near_time'
      ELSE d.exclusion_reason
    END AS final_exclusion_reason,
    CASE
      WHEN NOT d.visible_relationship_row THEN false
      WHEN d.thread_role = 'coach'
       AND (d.message_sid <> '' OR d.outbound_message_sid <> '')
       AND d.coach_sid_dup_rank > 1
      THEN false
      WHEN d.thread_role = 'user'
       AND d.user_near_dup_rank > 1
      THEN false
      ELSE d.visible_relationship_row
    END AS final_visible_relationship_row
  FROM deduped d
),
thread_numbered AS (
  SELECT
    v.*,
    ROW_NUMBER() OVER (
      PARTITION BY v.clerk_user_id
      ORDER BY v.event_at, v.event_source, v.message_sid
    ) AS thread_seq
  FROM visible_deduped v
  WHERE v.final_visible_relationship_row
)
SELECT
  t.clerk_user_id,
  t.thread_seq,
  t.thread_role,
  t.event_source,
  t.event_at,
  (t.event_at AT TIME ZONE 'America/New_York') AS event_at_et,
  TO_CHAR(t.event_at AT TIME ZONE 'America/New_York', 'HH24:MI:SS') AS local_time_et,
  t.message_sid,
  t.status,
  t.route_kind,
  true AS visible_relationship_row,
  t.final_exclusion_reason AS exclusion_reason,
  t.body_preview,
  CASE WHEN t.event_source = 'coach_daily_outbound' THEN COALESCE(
    t.raw_json#>>'{metadata,relationship_packet_observability,writer_prompt_path}',
    t.raw_json#>>'{metadata,daily_v3_lane,writer_prompt_path}',
    ''
  ) ELSE '' END AS writer_prompt_path,
  CASE WHEN t.event_source = 'coach_daily_outbound' THEN COALESCE(
    t.raw_json#>>'{metadata,relationship_packet_observability,daily_writing_brief_used}',
    t.raw_json#>>'{metadata,daily_v3_lane,daily_writing_brief_used}',
    ''
  ) ELSE '' END AS daily_writing_brief_used,
  CASE WHEN t.event_source = 'coach_daily_outbound' THEN COALESCE(
    t.raw_json#>>'{metadata,relationship_packet_observability,daily_brief_thread_message_count}',
    t.raw_json#>>'{metadata,daily_v3_lane,daily_brief_thread_message_count}',
    ''
  ) ELSE '' END AS daily_brief_thread_message_count,
  CASE WHEN t.event_source = 'coach_daily_outbound' THEN COALESCE(
    t.raw_json#>>'{metadata,relationship_packet_observability,daily_freshness_avoid_phrases_preview}',
    t.raw_json#>>'{metadata,daily_v3_lane,daily_freshness_avoid_phrases_preview}',
    ''
  ) ELSE '' END AS daily_freshness_avoid_phrases_preview,
  CASE WHEN t.event_source = 'coach_daily_outbound' THEN COALESCE(
    t.raw_json#>>'{metadata,relationship_packet_observability,daily_durable_memory_item_count}',
    t.raw_json#>>'{metadata,daily_v3_lane,daily_durable_memory_item_count}',
    ''
  ) ELSE '' END AS daily_durable_memory_item_count,
  CASE WHEN t.event_source = 'coach_daily_outbound' THEN COALESCE(
    t.raw_json#>>'{metadata,relationship_packet_observability,daily_durable_people_count}',
    t.raw_json#>>'{metadata,daily_v3_lane,daily_durable_people_count}',
    ''
  ) ELSE '' END AS daily_durable_people_count,
  CASE WHEN t.event_source = 'coach_daily_outbound' THEN COALESCE(
    t.raw_json#>>'{metadata,relationship_packet_observability,daily_durable_blocker_theme_count}',
    t.raw_json#>>'{metadata,daily_v3_lane,daily_durable_blocker_theme_count}',
    ''
  ) ELSE '' END AS daily_durable_blocker_theme_count,
  CASE WHEN t.event_source = 'coach_daily_outbound' THEN COALESCE(
    t.raw_json#>>'{metadata,relationship_packet_observability,daily_durable_memory_background_only}',
    t.raw_json#>>'{metadata,daily_v3_lane,daily_durable_memory_background_only}',
    ''
  ) ELSE '' END AS daily_durable_memory_background_only,
  CASE
    WHEN t.thread_role = 'user'
     AND t.body_preview ~* '(because|matters|so that|reason why|why i|why this|why the)'
    THEN true ELSE false
  END AS user_stated_why_signal,
  CASE
    WHEN t.thread_role = 'user'
     AND t.body_preview ~* '(my (wife|husband|partner|kids|children|son|daughter|mom|dad|mother|father)|for my )'
    THEN true ELSE false
  END AS user_stated_people_signal,
  CASE
    WHEN t.thread_role = 'user'
     AND t.body_preview ~* '(busy|tired|distracted|can''?t|hard to|struggle|overwhelm|exhausted)'
    THEN true ELSE false
  END AS user_stated_blocker_signal,
  CASE
    WHEN t.thread_role = 'user'
     AND t.body_preview ~* '(morning|evening|afternoon|night|after work|before bed|before work|weekend)'
    THEN true ELSE false
  END AS user_stated_timing_signal,
  CASE
    WHEN t.thread_role = 'user'
     AND t.body_preview ~* '(i am|i want to be|as a |who i am|identity|kind of person)'
    THEN true ELSE false
  END AS user_stated_identity_signal
FROM thread_numbered t
ORDER BY t.clerk_user_id, t.thread_seq;

