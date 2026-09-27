-- Weekly TTO apply-same-text locks.
-- Three invoker-rights functions. No new table, column, or index.
-- Does not read a generation status column (that column does not exist).
-- Does not read an event updated-at column (that column does not exist).
--
-- Lock law: weekly_tto_reserve_send and weekly_tto_apply_tyler_body both
-- lock current weekly_review drafts for one clerk_user_id ORDER BY id
-- before any send-event check or body write. The RPC transaction commits
-- before the application calls Twilio.
-- tto_finish_generation_persistence locks only the single current draft
-- for (user, day, slot). It never locks a second draft row, so it cannot
-- deadlock against the ordered weekly lock.

CREATE OR REPLACE FUNCTION public.weekly_tto_reserve_send(
  p_clerk_user_id text,
  p_week_key text,
  p_send_source text
)
RETURNS TABLE (
  ok boolean,
  reason text,
  event_id text,
  draft_id uuid,
  generation_id uuid,
  body text,
  week_start text,
  week_end text,
  draft_for_day_key text,
  timezone text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_draft public.sms_daily_drafts%ROWTYPE;
  v_gen public.sms_daily_draft_generations%ROWTYPE;
  v_match public.sms_daily_drafts%ROWTYPE;
  v_match_gen public.sms_daily_draft_generations%ROWTYPE;
  v_match_count integer := 0;
  v_event_id text;
  v_body text;
  v_note text;
  v_week_start text;
  v_week_end text;
  v_timezone text;
BEGIN
  IF p_clerk_user_id IS NULL OR btrim(p_clerk_user_id) = ''
     OR p_week_key IS NULL OR btrim(p_week_key) = '' THEN
    RETURN QUERY SELECT false, 'no_draft'::text, NULL::text, NULL::uuid, NULL::uuid,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF p_send_source IS DISTINCT FROM 'weekly_tto_cron'
     AND p_send_source IS DISTINCT FROM 'weekly_tto_manual' THEN
    RETURN QUERY SELECT false, 'bad_send_source'::text, NULL::text, NULL::uuid, NULL::uuid,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  v_note := CASE
    WHEN p_send_source = 'weekly_tto_cron' THEN 'reserved_by_weekly_tto_cron'
    ELSE 'reserved_by_weekly_tto_manual_send'
  END;

  FOR v_draft IN
    SELECT d.*
    FROM public.sms_daily_drafts d
    WHERE d.clerk_user_id = p_clerk_user_id
      AND d.send_slot = 'weekly_review'
      AND d.status = 'current'
    ORDER BY d.id
    FOR UPDATE
  LOOP
    SELECT g.* INTO v_gen
    FROM public.sms_daily_draft_generations g
    WHERE g.id = v_draft.current_generation_id;

    IF v_gen.id IS NOT NULL
       AND v_gen.generation_metadata->>'week_key' = p_week_key THEN
      v_match_count := v_match_count + 1;
      v_match := v_draft;
      v_match_gen := v_gen;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.sms_weekly_send_events e
    WHERE e.clerk_user_id = p_clerk_user_id
      AND e.week_key = p_week_key
  ) THEN
    RETURN QUERY SELECT false, 'duplicate_weekly_send'::text, NULL::text, NULL::uuid, NULL::uuid,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF v_match_count = 0 THEN
    RETURN QUERY SELECT false, 'no_draft'::text, NULL::text, NULL::uuid, NULL::uuid,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF v_match_count > 1 THEN
    RETURN QUERY SELECT false, 'ambiguous_weekly_draft'::text, NULL::text, NULL::uuid, NULL::uuid,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF v_match_gen.id IS NULL THEN
    RETURN QUERY SELECT false, 'missing_generation'::text, NULL::text, NULL::uuid, NULL::uuid,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  v_body := btrim(coalesce(v_match.current_body_to_send, ''));
  IF v_body = '' THEN
    RETURN QUERY SELECT false, 'blank_body'::text, NULL::text, NULL::uuid, NULL::uuid,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  v_week_start := v_match_gen.generation_metadata->>'week_start';
  v_week_end := v_match_gen.generation_metadata->>'week_end';
  v_timezone := coalesce(
    NULLIF(btrim(coalesce(v_match_gen.timezone_snapshot, '')), ''),
    v_match_gen.generation_metadata->>'timezone'
  );

  BEGIN
    INSERT INTO public.sms_weekly_send_events (
      clerk_user_id,
      week_key,
      status,
      metadata
    ) VALUES (
      p_clerk_user_id,
      p_week_key,
      'reserved',
      jsonb_build_object(
        'send_source', p_send_source,
        'draft_id', v_match.id,
        'generation_id', v_match.current_generation_id,
        'week_key', p_week_key,
        'week_start', v_week_start,
        'week_end', v_week_end,
        'draft_for_day_key', v_match.draft_for_day_key,
        'timezone', v_timezone,
        'note', v_note
      )
    )
    RETURNING id::text INTO v_event_id;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN QUERY SELECT false, 'duplicate_weekly_send'::text, NULL::text, NULL::uuid, NULL::uuid,
        NULL::text, NULL::text, NULL::text, NULL::text, NULL::text;
      RETURN;
  END;

  RETURN QUERY SELECT
    true,
    'reserved'::text,
    v_event_id,
    v_match.id,
    v_match.current_generation_id,
    v_body,
    v_week_start,
    v_week_end,
    v_match.draft_for_day_key,
    v_timezone;
END;
$$;

CREATE OR REPLACE FUNCTION public.weekly_tto_apply_tyler_body(
  p_draft_id uuid,
  p_clerk_user_id text,
  p_draft_for_day_key text,
  p_week_key text,
  p_body text,
  p_body_hash text,
  p_edit_distance_chars integer,
  p_edited_at timestamptz
)
RETURNS TABLE (
  ok boolean,
  reason text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_draft public.sms_daily_drafts%ROWTYPE;
  v_gen public.sms_daily_draft_generations%ROWTYPE;
  v_match public.sms_daily_drafts%ROWTYPE;
  v_match_gen public.sms_daily_draft_generations%ROWTYPE;
  v_match_count integer := 0;
  v_footer text := 'Reply STOP to opt out. Reply HELP for help.';
  v_max integer;
  v_updated integer := 0;
BEGIN
  IF p_body IS NULL OR btrim(p_body) = '' OR p_body <> btrim(p_body) THEN
    RETURN QUERY SELECT false, 'empty_body'::text;
    RETURN;
  END IF;

  v_max := 1600 - 2 - char_length(v_footer);
  IF char_length(p_body) > v_max THEN
    RETURN QUERY SELECT false, 'body_too_long'::text;
    RETURN;
  END IF;

  FOR v_draft IN
    SELECT d.*
    FROM public.sms_daily_drafts d
    WHERE d.clerk_user_id = p_clerk_user_id
      AND d.send_slot = 'weekly_review'
      AND d.status = 'current'
    ORDER BY d.id
    FOR UPDATE
  LOOP
    SELECT g.* INTO v_gen
    FROM public.sms_daily_draft_generations g
    WHERE g.id = v_draft.current_generation_id;

    IF v_gen.id IS NOT NULL
       AND v_gen.generation_metadata->>'week_key' = p_week_key THEN
      v_match_count := v_match_count + 1;
      v_match := v_draft;
      v_match_gen := v_gen;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.sms_weekly_send_events e
    WHERE e.clerk_user_id = p_clerk_user_id
      AND e.week_key = p_week_key
  ) THEN
    RETURN QUERY SELECT false, 'send_event_exists'::text;
    RETURN;
  END IF;

  IF v_match_count = 0 THEN
    RETURN QUERY SELECT false, 'no_current_for_week'::text;
    RETURN;
  END IF;

  IF v_match_count > 1 THEN
    RETURN QUERY SELECT false, 'ambiguous_week'::text;
    RETURN;
  END IF;

  IF v_match.id IS DISTINCT FROM p_draft_id
     OR v_match.draft_for_day_key IS DISTINCT FROM p_draft_for_day_key THEN
    RETURN QUERY SELECT false, 'draft_mismatch'::text;
    RETURN;
  END IF;

  IF v_match_gen.id IS NULL THEN
    RETURN QUERY SELECT false, 'missing_generation'::text;
    RETURN;
  END IF;

  IF v_match_gen.send_slot IS DISTINCT FROM 'weekly_review'
     OR v_match_gen.generation_metadata->>'week_key' IS DISTINCT FROM p_week_key
     OR v_match_gen.generation_metadata->>'week_end' IS DISTINCT FROM p_draft_for_day_key THEN
    RETURN QUERY SELECT false, 'bad_week_linkage'::text;
    RETURN;
  END IF;

  IF v_match.status IS DISTINCT FROM 'current' THEN
    RETURN QUERY SELECT false, 'not_current'::text;
    RETURN;
  END IF;

  UPDATE public.sms_daily_drafts
  SET
    current_body_to_send = p_body,
    current_body_source = 'tyler_edit',
    edited_by_tyler = true,
    edited_at = p_edited_at,
    edit_distance_chars = p_edit_distance_chars,
    current_body_hash = p_body_hash,
    updated_at = p_edited_at
  WHERE id = v_match.id
    AND status = 'current'
    AND send_slot = 'weekly_review'
    AND draft_for_day_key = p_draft_for_day_key;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RETURN QUERY SELECT false, 'not_current'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'applied'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.tto_finish_generation_persistence(
  p_clerk_user_id text,
  p_draft_for_day_key text,
  p_send_slot text,
  p_new_generation_id uuid,
  p_machine_body text,
  p_machine_body_hash text,
  p_now timestamptz,
  p_protect_tyler_provenance_only boolean
)
RETURNS TABLE (
  ok boolean,
  protected boolean,
  reason text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_draft public.sms_daily_drafts%ROWTYPE;
  v_inserted boolean := false;
  v_nonempty boolean;
  v_tyler boolean;
  v_protected boolean;
BEGIN
  IF p_send_slot IS DISTINCT FROM 'morning'
     AND p_send_slot IS DISTINCT FROM 'evening_checkin'
     AND p_send_slot IS DISTINCT FROM 'weekly_review' THEN
    RETURN QUERY SELECT false, false, 'bad_slot'::text;
    RETURN;
  END IF;

  SELECT d.* INTO v_draft
  FROM public.sms_daily_drafts d
  WHERE d.clerk_user_id = p_clerk_user_id
    AND d.draft_for_day_key = p_draft_for_day_key
    AND d.send_slot = p_send_slot
    AND d.status = 'current'
  FOR UPDATE;

  v_nonempty := v_draft.id IS NOT NULL
    AND v_draft.current_body_to_send IS NOT NULL
    AND length(btrim(v_draft.current_body_to_send)) > 0;
  v_tyler := v_draft.id IS NOT NULL
    AND (
      v_draft.edited_by_tyler IS TRUE
      OR v_draft.current_body_source = 'tyler_edit'
    );
  v_protected := v_draft.id IS NOT NULL
    AND (
      v_tyler
      OR (
        NOT coalesce(p_protect_tyler_provenance_only, false)
        AND v_nonempty
      )
    );

  IF v_protected THEN
    IF v_draft.current_generation_id IS NOT NULL THEN
      UPDATE public.sms_daily_draft_generations
      SET
        superseded_by_generation_id = v_draft.current_generation_id,
        superseded_at = p_now
      WHERE id = p_new_generation_id;
    END IF;
    RETURN QUERY SELECT true, true, 'protected'::text;
    RETURN;
  END IF;

  IF v_draft.id IS NULL THEN
    BEGIN
      INSERT INTO public.sms_daily_drafts (
        clerk_user_id,
        draft_for_day_key,
        send_slot,
        current_generation_id,
        current_body_to_send,
        current_body_source,
        edited_by_tyler,
        edited_at,
        edit_distance_chars,
        machine_body_hash,
        current_body_hash,
        status,
        updated_at
      ) VALUES (
        p_clerk_user_id,
        p_draft_for_day_key,
        p_send_slot,
        p_new_generation_id,
        p_machine_body,
        'machine',
        false,
        NULL,
        NULL,
        p_machine_body_hash,
        p_machine_body_hash,
        'current',
        p_now
      );
      v_inserted := true;
    EXCEPTION
      WHEN unique_violation THEN
        v_inserted := false;
        SELECT d.* INTO v_draft
        FROM public.sms_daily_drafts d
        WHERE d.clerk_user_id = p_clerk_user_id
          AND d.draft_for_day_key = p_draft_for_day_key
          AND d.send_slot = p_send_slot
        FOR UPDATE;

        v_nonempty := v_draft.id IS NOT NULL
          AND v_draft.status = 'current'
          AND v_draft.current_body_to_send IS NOT NULL
          AND length(btrim(v_draft.current_body_to_send)) > 0;
        v_tyler := v_draft.id IS NOT NULL
          AND v_draft.status = 'current'
          AND (
            v_draft.edited_by_tyler IS TRUE
            OR v_draft.current_body_source = 'tyler_edit'
          );
        v_protected := v_draft.id IS NOT NULL
          AND v_draft.status = 'current'
          AND (
            v_tyler
            OR (
              NOT coalesce(p_protect_tyler_provenance_only, false)
              AND v_nonempty
            )
          );

        IF v_protected THEN
          IF v_draft.current_generation_id IS NOT NULL THEN
            UPDATE public.sms_daily_draft_generations
            SET
              superseded_by_generation_id = v_draft.current_generation_id,
              superseded_at = p_now
            WHERE id = p_new_generation_id;
          END IF;
          RETURN QUERY SELECT true, true, 'protected'::text;
          RETURN;
        END IF;
    END;
  END IF;

  UPDATE public.sms_daily_draft_generations
  SET
    superseded_by_generation_id = p_new_generation_id,
    superseded_at = p_now
  WHERE clerk_user_id = p_clerk_user_id
    AND draft_for_day_key = p_draft_for_day_key
    AND send_slot = p_send_slot
    AND id <> p_new_generation_id
    AND superseded_at IS NULL;

  IF v_inserted THEN
    RETURN QUERY SELECT true, false, 'applied'::text;
    RETURN;
  END IF;

  UPDATE public.sms_daily_drafts
  SET
    current_generation_id = p_new_generation_id,
    current_body_to_send = p_machine_body,
    current_body_source = 'machine',
    edited_by_tyler = false,
    edited_at = NULL,
    edit_distance_chars = NULL,
    machine_body_hash = p_machine_body_hash,
    current_body_hash = p_machine_body_hash,
    status = 'current',
    updated_at = p_now
  WHERE id = v_draft.id
    AND send_slot = p_send_slot
    AND draft_for_day_key = p_draft_for_day_key
    AND clerk_user_id = p_clerk_user_id;

  RETURN QUERY SELECT true, false, 'applied'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.weekly_tto_reserve_send(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.weekly_tto_reserve_send(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.weekly_tto_reserve_send(text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.weekly_tto_reserve_send(text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.weekly_tto_apply_tyler_body(uuid, text, text, text, text, text, integer, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.weekly_tto_apply_tyler_body(uuid, text, text, text, text, text, integer, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.weekly_tto_apply_tyler_body(uuid, text, text, text, text, text, integer, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.weekly_tto_apply_tyler_body(uuid, text, text, text, text, text, integer, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.tto_finish_generation_persistence(text, text, text, uuid, text, text, timestamptz, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tto_finish_generation_persistence(text, text, text, uuid, text, text, timestamptz, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.tto_finish_generation_persistence(text, text, text, uuid, text, text, timestamptz, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.tto_finish_generation_persistence(text, text, text, uuid, text, text, timestamptz, boolean) TO service_role;
