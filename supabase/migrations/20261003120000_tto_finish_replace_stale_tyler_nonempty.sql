-- Replace the single live tto_finish_generation_persistence signature.
-- Production currently has exactly one overload:
--   (text, text, text, uuid, text, text, timestamptz, boolean)
-- Adding an argument creates a second overload unless the old one is dropped
-- in the same transaction. After this script there is one 9-argument function.
-- The new argument defaults to false. Existing callers keep today's pin.
--
-- Run this whole file as one transaction.
-- The Supabase migration runner already wraps a migration file.
-- In the SQL editor, keep the BEGIN/COMMIT below.

BEGIN;

DROP FUNCTION IF EXISTS public.tto_finish_generation_persistence(
  text,
  text,
  text,
  uuid,
  text,
  text,
  timestamptz,
  boolean
);

CREATE FUNCTION public.tto_finish_generation_persistence(
  p_clerk_user_id text,
  p_draft_for_day_key text,
  p_send_slot text,
  p_new_generation_id uuid,
  p_machine_body text,
  p_machine_body_hash text,
  p_now timestamptz,
  p_protect_tyler_provenance_only boolean,
  p_allow_replace_stale_tyler_nonempty boolean DEFAULT false
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
  v_replace_stale_tyler_nonempty boolean;
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
  -- The override lifts the Tyler pin only for a nonempty Tyler sentence.
  -- A Tyler blank stays protected even when the flag is true.
  v_replace_stale_tyler_nonempty :=
    coalesce(p_allow_replace_stale_tyler_nonempty, false)
    AND v_tyler
    AND v_nonempty;
  v_protected := v_draft.id IS NOT NULL
    AND (
      (v_tyler AND NOT v_replace_stale_tyler_nonempty)
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
        v_replace_stale_tyler_nonempty :=
          coalesce(p_allow_replace_stale_tyler_nonempty, false)
          AND v_tyler
          AND v_nonempty;
        v_protected := v_draft.id IS NOT NULL
          AND v_draft.status = 'current'
          AND (
            (v_tyler AND NOT v_replace_stale_tyler_nonempty)
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

REVOKE ALL ON FUNCTION public.tto_finish_generation_persistence(
  text, text, text, uuid, text, text, timestamptz, boolean, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tto_finish_generation_persistence(
  text, text, text, uuid, text, text, timestamptz, boolean, boolean
) FROM anon;
REVOKE ALL ON FUNCTION public.tto_finish_generation_persistence(
  text, text, text, uuid, text, text, timestamptz, boolean, boolean
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.tto_finish_generation_persistence(
  text, text, text, uuid, text, text, timestamptz, boolean, boolean
) TO service_role;

COMMIT;
