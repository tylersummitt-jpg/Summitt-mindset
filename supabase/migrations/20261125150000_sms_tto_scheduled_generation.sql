-- Stage 3: one batch record, one claim function, and scheduled-generation
-- protections on the existing finish function.
-- Not executed by this change. Apply before the scheduled-generation cron.
--
-- Account deletion: this migration replaces the verified production purge
-- after sms_tto_generation_batches exists. The replacement is the production
-- function body, plus removal of this member from batch JSON. It does not
-- restore an older repository copy of the purge.
--
-- The previous live finish signature is the 9-argument function from
-- 20261003120000_tto_finish_replace_stale_tyler_nonempty.sql.
-- New arguments are appended with defaults. Existing named calls keep
-- today's behavior. This file drops that overload in the same transaction
-- so Postgres does not keep two finish functions.

BEGIN;

-- ---------------------------------------------------------------------------
-- Batch record. One row per administrative batch date and TTO owner.
-- Occurrence JSON is the work list and the Stage 4 statistics source.
-- Message bodies stay on sms_daily_drafts / sms_daily_draft_generations.
-- ---------------------------------------------------------------------------

CREATE TABLE public.sms_tto_generation_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_date text NOT NULL,
  send_slot text NOT NULL,
  opened_trigger text NOT NULL,
  window_ends_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  initial_completed_at timestamptz NULL,
  initial_completed_trigger text NULL,
  relevant_member_count integer NOT NULL,
  scheduled_member_count integer NOT NULL,
  scheduled_occurrence_count integer NOT NULL,
  occurrences jsonb NOT NULL DEFAULT '[]'::jsonb,
  non_scheduled jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sms_tto_generation_batches_slot_check
    CHECK (send_slot IN ('morning', 'evening_checkin')),
  CONSTRAINT sms_tto_generation_batches_opened_trigger_check
    CHECK (opened_trigger IN ('automatic_schedule', 'manual_schedule')),
  CONSTRAINT sms_tto_generation_batches_completed_trigger_check
    CHECK (
      initial_completed_trigger IS NULL
      OR initial_completed_trigger IN ('automatic_schedule', 'manual_schedule')
    ),
  CONSTRAINT sms_tto_generation_batches_batch_slot_unique
    UNIQUE (batch_date, send_slot)
);

COMMENT ON TABLE public.sms_tto_generation_batches IS
  'One automatic or manual scheduled-generation batch. '
  'occurrences is the work list. It does not store SMS bodies or model transcripts.';

ALTER TABLE public.sms_tto_generation_batches ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.sms_tto_generation_batches FROM anon;
REVOKE ALL ON TABLE public.sms_tto_generation_batches FROM authenticated;
REVOKE ALL ON TABLE public.sms_tto_generation_batches FROM PUBLIC;
GRANT ALL ON TABLE public.sms_tto_generation_batches TO service_role;

-- ---------------------------------------------------------------------------
-- One member key shared by scheduled writes and the account-deletion purge.
-- Writers take it shared. Purge takes it exclusive.
-- Acquire it before any row lock. It releases when the transaction commits.
-- Do not hold it across OpenAI, Twilio, or any other external call.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.sms_scheduled_member_deletion_lock_shared(p_clerk_user_ids text[])
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id text;
BEGIN
  FOR v_id IN
    SELECT DISTINCT btrim(id)
    FROM unnest(coalesce(p_clerk_user_ids, ARRAY[]::text[])) AS id
    WHERE btrim(coalesce(id, '')) <> ''
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock_shared(
      hashtext('sms_account_deletion_member'),
      hashtext(v_id)
    );
  END LOOP;
END;
$$;

CREATE FUNCTION public.sms_account_deletion_member_blocked(p_clerk_user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.account_deletion_requests
    WHERE clerk_user_id = p_clerk_user_id
  );
$$;

CREATE FUNCTION public.sms_tto_json_without_deleted_members(p_items jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(element.value ORDER BY element.ordinality), '[]'::jsonb)
  FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
    WITH ORDINALITY AS element(value, ordinality)
  WHERE NOT public.sms_account_deletion_member_blocked(element.value->>'clerk_user_id');
$$;

REVOKE ALL ON FUNCTION public.sms_scheduled_member_deletion_lock_shared(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sms_account_deletion_member_blocked(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sms_tto_json_without_deleted_members(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_scheduled_member_deletion_lock_shared(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.sms_account_deletion_member_blocked(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sms_tto_json_without_deleted_members(jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Open a batch once. A losing insert leaves the winner's counts and clock.
-- A deleted member in a stale snapshot is omitted before the insert.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.tto_generation_batch_open(
  p_batch_date text,
  p_send_slot text,
  p_opened_trigger text,
  p_window_ends_at timestamptz,
  p_relevant_member_count integer,
  p_scheduled_member_count integer,
  p_scheduled_occurrence_count integer,
  p_occurrences jsonb,
  p_non_scheduled jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row public.sms_tto_generation_batches%ROWTYPE;
  v_ids text[];
  v_occurrences jsonb;
  v_non_scheduled jsonb;
  v_relevant integer;
  v_scheduled_members integer;
  v_scheduled_occurrences integer;
BEGIN
  IF p_send_slot IS DISTINCT FROM 'morning'
     AND p_send_slot IS DISTINCT FROM 'evening_checkin' THEN
    RAISE EXCEPTION 'bad_slot';
  END IF;
  IF p_opened_trigger IS DISTINCT FROM 'automatic_schedule'
     AND p_opened_trigger IS DISTINCT FROM 'manual_schedule' THEN
    RAISE EXCEPTION 'bad_trigger';
  END IF;
  IF p_window_ends_at IS NULL THEN
    RAISE EXCEPTION 'missing_window_end';
  END IF;

  SELECT coalesce(array_agg(DISTINCT member_id), ARRAY[]::text[])
    INTO v_ids
  FROM (
    SELECT btrim(value->>'clerk_user_id') AS member_id
    FROM jsonb_array_elements(coalesce(p_occurrences, '[]'::jsonb))
    UNION
    SELECT btrim(value->>'clerk_user_id')
    FROM jsonb_array_elements(coalesce(p_non_scheduled, '[]'::jsonb))
  ) members
  WHERE btrim(coalesce(member_id, '')) <> '';

  -- Member locks before the batch row. Sorted inside the helper.
  PERFORM public.sms_scheduled_member_deletion_lock_shared(v_ids);
  v_occurrences := public.sms_tto_json_without_deleted_members(p_occurrences);
  v_non_scheduled := public.sms_tto_json_without_deleted_members(p_non_scheduled);
  IF v_occurrences IS DISTINCT FROM coalesce(p_occurrences, '[]'::jsonb)
     OR v_non_scheduled IS DISTINCT FROM coalesce(p_non_scheduled, '[]'::jsonb) THEN
    SELECT count(*)::integer,
           count(DISTINCT value->>'clerk_user_id')::integer
      INTO v_scheduled_occurrences, v_scheduled_members
    FROM jsonb_array_elements(v_occurrences);
    SELECT count(DISTINCT member_id)::integer
      INTO v_relevant
    FROM (
      SELECT value->>'clerk_user_id' AS member_id FROM jsonb_array_elements(v_occurrences)
      UNION
      SELECT value->>'clerk_user_id' FROM jsonb_array_elements(v_non_scheduled)
    ) remaining
    WHERE btrim(coalesce(member_id, '')) <> '';
  ELSE
    v_relevant := p_relevant_member_count;
    v_scheduled_members := p_scheduled_member_count;
    v_scheduled_occurrences := p_scheduled_occurrence_count;
  END IF;

  INSERT INTO public.sms_tto_generation_batches (
    batch_date,
    send_slot,
    opened_trigger,
    window_ends_at,
    started_at,
    relevant_member_count,
    scheduled_member_count,
    scheduled_occurrence_count,
    occurrences,
    non_scheduled
  ) VALUES (
    p_batch_date,
    p_send_slot,
    p_opened_trigger,
    p_window_ends_at,
    clock_timestamp(),
    v_relevant,
    v_scheduled_members,
    v_scheduled_occurrences,
    v_occurrences,
    v_non_scheduled
  )
  ON CONFLICT (batch_date, send_slot) DO NOTHING;

  SELECT * INTO v_row
  FROM public.sms_tto_generation_batches
  WHERE batch_date = p_batch_date
    AND send_slot = p_send_slot
  FOR UPDATE;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'batch_date', v_row.batch_date,
    'send_slot', v_row.send_slot,
    'opened_trigger', v_row.opened_trigger,
    'window_ends_at', v_row.window_ends_at,
    'started_at', v_row.started_at,
    'initial_completed_at', v_row.initial_completed_at,
    'initial_completed_trigger', v_row.initial_completed_trigger,
    'relevant_member_count', v_row.relevant_member_count,
    'scheduled_member_count', v_row.scheduled_member_count,
    'scheduled_occurrence_count', v_row.scheduled_occurrence_count,
    'occurrences', v_row.occurrences,
    'non_scheduled', v_row.non_scheduled
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Patch occurrence states under the batch row lock.
-- patch_kind decides which transition is legal.
-- A stale owner cannot replace a newer result.
-- One terminal state cannot replace another, except an explicit retry of
-- failed and an evidence reconciliation that corrects failed.
-- initial_completed_at is the database clock, set once.
-- Later late work and retries do not clear it.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.tto_generation_batch_patch(
  p_batch_date text,
  p_send_slot text,
  p_actor_trigger text,
  p_patches jsonb,
  p_append jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row public.sms_tto_generation_batches%ROWTYPE;
  v_occs jsonb;
  v_patch jsonb;
  v_append jsonb;
  v_cur jsonb;
  v_merged jsonb;
  v_found integer;
  v_i integer;
  v_next text;
  v_kind text;
  v_owner text;
  v_patch_owner text;
  v_initial jsonb;
  v_lease_held boolean;
  v_allow boolean;
  v_open boolean := false;
  v_completed timestamptz;
  v_completed_trigger text;
  v_now timestamptz;
  v_draft_generation uuid;
  v_draft_edited_at timestamptz;
  v_ids text[];
BEGIN
  IF p_send_slot IS DISTINCT FROM 'morning'
     AND p_send_slot IS DISTINCT FROM 'evening_checkin' THEN
    RAISE EXCEPTION 'bad_slot';
  END IF;
  IF p_actor_trigger IS DISTINCT FROM 'automatic_schedule'
     AND p_actor_trigger IS DISTINCT FROM 'manual_schedule' THEN
    RAISE EXCEPTION 'bad_trigger';
  END IF;

  SELECT coalesce(array_agg(DISTINCT member_id), ARRAY[]::text[])
    INTO v_ids
  FROM (
    SELECT btrim(value->>'clerk_user_id') AS member_id
    FROM jsonb_array_elements(coalesce(p_patches, '[]'::jsonb))
    UNION
    SELECT btrim(value->>'clerk_user_id')
    FROM jsonb_array_elements(coalesce(p_append, '[]'::jsonb))
  ) members
  WHERE btrim(coalesce(member_id, '')) <> '';

  -- Member locks before the batch row, so purge cannot deadlock on the reverse order.
  PERFORM public.sms_scheduled_member_deletion_lock_shared(v_ids);

  SELECT * INTO v_row
  FROM public.sms_tto_generation_batches
  WHERE batch_date = p_batch_date
    AND send_slot = p_send_slot
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'batch_not_open';
  END IF;

  v_now := clock_timestamp();
  v_occs := coalesce(v_row.occurrences, '[]'::jsonb);

  FOR v_patch IN
    SELECT value FROM jsonb_array_elements(coalesce(p_patches, '[]'::jsonb))
  LOOP
    v_found := -1;
    FOR v_i IN 0 .. coalesce(jsonb_array_length(v_occs), 0) - 1 LOOP
      IF v_occs->v_i->>'clerk_user_id' = v_patch->>'clerk_user_id'
         AND v_occs->v_i->>'member_local_date' = v_patch->>'member_local_date' THEN
        v_found := v_i;
      END IF;
    END LOOP;
    IF v_found < 0 THEN
      CONTINUE;
    END IF;

    IF public.sms_account_deletion_member_blocked(v_patch->>'clerk_user_id') THEN
      CONTINUE;
    END IF;

    v_cur := v_occs->v_found;
    v_kind := coalesce(v_patch->>'patch_kind', '');
    v_next := coalesce(v_patch->>'state', v_cur->>'state');
    v_owner := v_cur->>'claim_owner_id';
    v_patch_owner := v_patch->>'claim_owner_id';
    v_lease_held := false;
    IF v_cur->>'claim_expires_at' IS NOT NULL THEN
      BEGIN
        v_lease_held := (v_cur->>'claim_expires_at')::timestamptz > v_now;
      EXCEPTION WHEN others THEN
        v_lease_held := false;
      END;
    END IF;

    v_allow := false;
    IF v_kind = 'retry_claim' THEN
      v_allow := v_cur->>'state' = 'failed'
        AND v_next = 'claimed'
        AND v_patch_owner IS NOT NULL;
    ELSIF v_kind = 'claim' THEN
      v_allow := v_next = 'claimed'
        AND v_patch_owner IS NOT NULL
        AND (
          v_cur->>'state' = 'pending'
          OR (
            v_cur->>'state' = 'claimed'
            AND (
              v_owner IS NULL
              OR v_owner = v_patch_owner
              OR NOT v_lease_held
            )
          )
        );
    ELSIF v_kind = 'result' THEN
      v_allow := v_patch_owner IS NOT NULL
        AND v_next <> 'pending'
        AND v_next <> 'claimed'
        AND v_cur->>'state' = 'claimed'
        AND v_owner IS NOT DISTINCT FROM v_patch_owner;
    ELSIF v_kind = 'reconcile' THEN
      v_allow := v_next <> 'pending'
        AND v_next <> 'claimed'
        AND (
          v_cur->>'state' = 'pending'
          OR v_cur->>'state' = 'claimed'
          OR v_cur->>'state' = v_next
          OR (
            v_cur->>'state' = 'failed'
            AND v_next = ANY (ARRAY[
              'generated', 'intentional_space', 'protected', 'sent', 'legacy_conflict'
            ])
          )
          OR (
            v_cur->>'state' = ANY (ARRAY['generated', 'intentional_space', 'protected'])
            AND v_next = ANY (ARRAY['generated', 'intentional_space', 'protected'])
          )
        );
    ELSIF v_kind = 'delivery' THEN
      v_allow := v_cur->>'state' = ANY (ARRAY['generated', 'intentional_space', 'protected'])
        AND v_next = 'sent';
    ELSIF v_kind = 'eligibility' THEN
      v_allow := (
        v_next = ANY (ARRAY['pending', 'expired', 'ineligible'])
        AND (
          v_cur->>'state' = 'pending'
          OR (v_cur->>'state' = 'claimed' AND NOT v_lease_held)
        )
      ) OR (
        v_cur->>'state' = 'failed'
        AND v_next = ANY (ARRAY['expired', 'ineligible'])
      ) OR (
        v_cur->>'state' = ANY (ARRAY['generated', 'intentional_space', 'protected'])
        AND v_next = ANY (ARRAY['expired', 'ineligible'])
      ) OR (
        v_cur->>'state' = 'ineligible'
        AND v_next = 'pending'
      );
    END IF;
    IF v_allow
       AND v_patch ? 'expected_state'
       AND v_cur->>'state' IS DISTINCT FROM v_patch->>'expected_state' THEN
      v_allow := false;
    END IF;
    IF v_allow AND v_patch ? 'expected_generation_id' THEN
      SELECT d.current_generation_id, d.edited_at
        INTO v_draft_generation, v_draft_edited_at
      FROM public.sms_daily_drafts d
      WHERE d.clerk_user_id = v_cur->>'clerk_user_id'
        AND d.draft_for_day_key = v_cur->>'member_local_date'
        AND d.send_slot = p_send_slot
        AND d.status = 'current'
      FOR UPDATE;
      IF v_draft_generation IS NULL
         OR v_draft_generation::text IS DISTINCT FROM v_patch->>'expected_generation_id' THEN
        v_allow := false;
      END IF;
      IF v_allow AND v_patch ? 'expected_edited_at' THEN
        IF v_draft_edited_at IS DISTINCT FROM NULLIF(v_patch->>'expected_edited_at', '')::timestamptz THEN
          v_allow := false;
        END IF;
      END IF;
    END IF;
    IF NOT v_allow THEN
      CONTINUE;
    END IF;

    v_initial := v_cur->'initial_outcome';
    IF v_kind = 'retry_claim' AND (v_initial IS NULL OR v_initial = 'null'::jsonb) THEN
      v_initial := to_jsonb('failed'::text);
    ELSIF (v_initial IS NULL OR v_initial = 'null'::jsonb)
          AND v_cur->>'state' = ANY (ARRAY['generated', 'intentional_space', 'protected']) THEN
      v_initial := to_jsonb(v_cur->>'state');
    ELSIF (v_initial IS NULL OR v_initial = 'null'::jsonb)
          AND v_next = ANY (ARRAY[
            'generated', 'intentional_space', 'protected', 'failed',
            'sent', 'legacy_conflict', 'expired', 'ineligible'
          ]) THEN
      v_initial := to_jsonb(v_next);
    END IF;

    v_merged := v_cur || v_patch;
    v_merged := v_merged - 'patch_kind' - 'expected_state' - 'expected_generation_id' - 'expected_edited_at' - 'refresh_delivery';
    v_merged := v_merged || jsonb_build_object(
      'clerk_user_id', v_cur->>'clerk_user_id',
      'member_local_date', v_cur->>'member_local_date',
      'initial_set', v_cur->'initial_set',
      'initial_outcome', v_initial,
      'state', v_next
    );
    IF (
         v_kind = 'result'
         OR v_kind = 'reconcile'
         OR (v_kind = 'eligibility' AND v_next IS DISTINCT FROM 'pending')
       )
       AND coalesce(v_patch->>'refresh_delivery', '') IS DISTINCT FROM 'true' THEN
      v_merged := v_merged || jsonb_build_object(
        'utc_instant', coalesce(v_cur->>'utc_instant', v_merged->>'utc_instant'),
        'selected_local_minute', coalesce(v_cur->'selected_local_minute', v_merged->'selected_local_minute'),
        'effective_local_minute', coalesce(v_cur->'effective_local_minute', v_merged->'effective_local_minute'),
        'time_zone', coalesce(v_cur->>'time_zone', v_merged->>'time_zone')
      );
    END IF;
    v_occs := jsonb_set(v_occs, ARRAY[v_found::text], v_merged, false);
  END LOOP;

  FOR v_append IN
    SELECT value FROM jsonb_array_elements(coalesce(p_append, '[]'::jsonb))
  LOOP
    v_found := -1;
    FOR v_i IN 0 .. coalesce(jsonb_array_length(v_occs), 0) - 1 LOOP
      IF v_occs->v_i->>'clerk_user_id' = v_append->>'clerk_user_id'
         AND v_occs->v_i->>'member_local_date' = v_append->>'member_local_date' THEN
        v_found := v_i;
      END IF;
    END LOOP;
    IF v_found >= 0 THEN
      CONTINUE;
    END IF;
    IF public.sms_account_deletion_member_blocked(v_append->>'clerk_user_id') THEN
      CONTINUE;
    END IF;
    v_merged := v_append || jsonb_build_object('initial_set', false);
    v_occs := v_occs || jsonb_build_array(v_merged);
  END LOOP;

  FOR v_i IN 0 .. coalesce(jsonb_array_length(v_occs), 0) - 1 LOOP
    v_cur := v_occs->v_i;
    IF coalesce(v_cur->>'initial_set', 'true') = 'false' THEN
      CONTINUE;
    END IF;
    IF v_cur->>'state' = ANY (ARRAY['pending', 'claimed']) THEN
      v_open := true;
    END IF;
  END LOOP;

  v_completed := v_row.initial_completed_at;
  v_completed_trigger := v_row.initial_completed_trigger;
  IF NOT v_open AND v_completed IS NULL THEN
    v_completed := v_now;
    v_completed_trigger := p_actor_trigger;
  END IF;

  UPDATE public.sms_tto_generation_batches
  SET
    occurrences = v_occs,
    initial_completed_at = v_completed,
    initial_completed_trigger = v_completed_trigger,
    updated_at = v_now
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'batch_date', v_row.batch_date,
    'send_slot', v_row.send_slot,
    'opened_trigger', v_row.opened_trigger,
    'window_ends_at', v_row.window_ends_at,
    'started_at', v_row.started_at,
    'initial_completed_at', v_row.initial_completed_at,
    'initial_completed_trigger', v_row.initial_completed_trigger,
    'relevant_member_count', v_row.relevant_member_count,
    'scheduled_member_count', v_row.scheduled_member_count,
    'scheduled_occurrence_count', v_row.scheduled_occurrence_count,
    'occurrences', v_row.occurrences,
    'non_scheduled', v_row.non_scheduled
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Claim one member-local draft before any interpreter or writer call.
-- pg_advisory_xact_lock serializes the first insert. It releases at commit,
-- before any model call. A losing insert deletes its placeholder.
-- The claim generation is not sendable.
-- An existing current-generation pointer is not replaced except when an
-- explicit manual retry claims a confirmed failure.
-- The six-minute lease starts at clock_timestamp(), when the claim is acquired.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.tto_claim_scheduled_generation(
  p_clerk_user_id text,
  p_draft_for_day_key text,
  p_send_slot text,
  p_claim_owner_id uuid,
  p_now timestamptz,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_allow_failed_retry boolean DEFAULT false,
  p_mode text DEFAULT 'initial'
)
RETURNS TABLE (
  outcome text,
  generation_id uuid,
  reason text,
  claim_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_draft public.sms_daily_drafts%ROWTYPE;
  v_gen public.sms_daily_draft_generations%ROWTYPE;
  v_meta jsonb;
  v_expires timestamptz;
  v_owner text;
  v_number integer;
  v_id uuid;
  v_lease timestamptz;
  v_inserted boolean := false;
  v_reconsider_owner text;
  v_reconsider_expires timestamptz;
BEGIN
  IF p_send_slot IS DISTINCT FROM 'morning'
     AND p_send_slot IS DISTINCT FROM 'evening_checkin' THEN
    RETURN QUERY SELECT 'noncurrent'::text, NULL::uuid, 'bad_slot'::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF p_claim_owner_id IS NULL THEN
    RETURN QUERY SELECT 'noncurrent'::text, NULL::uuid, 'missing_claim_owner'::text, NULL::timestamptz;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtext('sms_account_deletion_member'),
    hashtext(p_clerk_user_id)
  );
  IF public.sms_account_deletion_member_blocked(p_clerk_user_id) THEN
    RETURN QUERY SELECT 'ineligible'::text, NULL::uuid, 'account_deletion'::text, NULL::timestamptz;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_clerk_user_id),
    hashtext(p_draft_for_day_key || '|' || p_send_slot)
  );

  v_lease := clock_timestamp() + interval '6 minutes';

  SELECT d.* INTO v_draft
  FROM public.sms_daily_drafts d
  WHERE d.clerk_user_id = p_clerk_user_id
    AND d.draft_for_day_key = p_draft_for_day_key
    AND d.send_slot = p_send_slot
  FOR UPDATE;

  IF v_draft.id IS NOT NULL THEN
    IF v_draft.status = 'sent' THEN
      RETURN QUERY SELECT 'sent'::text, v_draft.current_generation_id, 'sent'::text, NULL::timestamptz;
      RETURN;
    END IF;
    IF v_draft.status IS DISTINCT FROM 'current' THEN
      RETURN QUERY SELECT 'noncurrent'::text, v_draft.current_generation_id, v_draft.status, NULL::timestamptz;
      RETURN;
    END IF;

    SELECT g.* INTO v_gen
    FROM public.sms_daily_draft_generations g
    WHERE g.id = v_draft.current_generation_id;

    IF v_gen.id IS NULL THEN
      RETURN QUERY SELECT 'legacy_conflict'::text, NULL::uuid, 'missing_generation'::text, NULL::timestamptz;
      RETURN;
    END IF;

    v_meta := coalesce(v_gen.generation_metadata, '{}'::jsonb);

    IF v_meta->>'record_kind' = 'generation_claim' THEN
      v_owner := v_meta->>'claim_owner_id';
      BEGIN
        v_expires := (v_meta->>'claim_expires_at')::timestamptz;
      EXCEPTION WHEN others THEN
        v_expires := NULL;
      END;
      IF coalesce(p_mode, 'initial') = 'reconsider' THEN
        RETURN QUERY SELECT 'busy'::text, v_gen.id, 'initial_claim'::text, v_expires;
        RETURN;
      END IF;

      IF v_expires IS NOT NULL
         AND v_expires > clock_timestamp()
         AND v_owner IS DISTINCT FROM p_claim_owner_id::text THEN
        RETURN QUERY SELECT 'busy'::text, v_gen.id, 'claim_held'::text, v_expires;
        RETURN;
      END IF;

      UPDATE public.sms_daily_draft_generations
      SET generation_metadata = v_meta || jsonb_build_object(
        'claim_owner_id', p_claim_owner_id::text,
        'claim_expires_at', v_lease,
        'record_kind', 'generation_claim',
        'scheduled_generation_convention', 'member_local_delivery_v1',
        'member_local_date', p_draft_for_day_key
      )
      WHERE id = v_gen.id;
      RETURN QUERY SELECT 'claimed'::text, v_gen.id, 'reclaimed'::text, v_lease;
      RETURN;
    END IF;

    IF v_meta->>'scheduled_generation_convention' IS DISTINCT FROM 'member_local_delivery_v1'
       OR v_meta->>'member_local_date' IS DISTINCT FROM p_draft_for_day_key THEN
      RETURN QUERY SELECT 'legacy_conflict'::text, v_gen.id, 'legacy_key_occupied'::text, NULL::timestamptz;
      RETURN;
    END IF;

    IF coalesce(p_mode, 'initial') = 'reconsider' THEN
      v_reconsider_owner := v_meta->>'reconsideration_claim_owner_id';
      BEGIN
        v_reconsider_expires := (v_meta->>'reconsideration_claim_expires_at')::timestamptz;
      EXCEPTION WHEN others THEN
        v_reconsider_expires := NULL;
      END;
      IF v_reconsider_owner IS NOT NULL
         AND v_reconsider_expires IS NOT NULL
         AND v_reconsider_expires > clock_timestamp()
         AND v_reconsider_owner IS DISTINCT FROM p_claim_owner_id::text THEN
        RETURN QUERY SELECT 'busy'::text, v_gen.id, 'reconsideration_held'::text, v_reconsider_expires;
        RETURN;
      END IF;

      IF NOT (
        v_draft.edited_by_tyler IS TRUE
        OR v_draft.current_body_source = 'tyler_edit'
        OR (
          v_draft.current_body_to_send IS NOT NULL
          AND length(btrim(v_draft.current_body_to_send)) > 0
        )
        OR v_gen.machine_no_send_reason = 'intentional_space'
      ) THEN
        RETURN QUERY SELECT 'not_ready'::text, v_gen.id, 'nothing_to_reconsider'::text, NULL::timestamptz;
        RETURN;
      END IF;

      UPDATE public.sms_daily_draft_generations
      SET generation_metadata = v_meta || jsonb_build_object(
        'reconsideration_claim_owner_id', p_claim_owner_id::text,
        'reconsideration_claim_expires_at', v_lease,
        'reconsideration_expected_generation_id', v_gen.id::text,
        'reconsideration_expected_edited_at', v_draft.edited_at,
        'reconsideration_expected_body_hash', v_draft.current_body_hash,
        'reconsideration_expected_body_source', v_draft.current_body_source,
        'reconsideration_expected_edited_by_tyler', coalesce(v_draft.edited_by_tyler, false)
      )
      WHERE id = v_gen.id;
      RETURN QUERY SELECT 'claimed'::text, v_gen.id, 'reconsideration'::text, v_lease;
      RETURN;
    END IF;

    IF v_draft.edited_by_tyler IS TRUE
       OR v_draft.current_body_source = 'tyler_edit' THEN
      RETURN QUERY SELECT 'protected'::text, v_gen.id, 'tyler_edit'::text, NULL::timestamptz;
      RETURN;
    END IF;

    IF v_draft.current_body_to_send IS NOT NULL
       AND length(btrim(v_draft.current_body_to_send)) > 0 THEN
      RETURN QUERY SELECT 'generated'::text, v_gen.id, 'existing_body'::text, NULL::timestamptz;
      RETURN;
    END IF;

    IF v_gen.machine_no_send_reason = 'intentional_space' THEN
      RETURN QUERY SELECT 'intentional_space'::text, v_gen.id, 'intentional_space'::text, NULL::timestamptz;
      RETURN;
    END IF;

    IF v_gen.machine_no_send_reason IS NOT NULL
       AND v_gen.machine_no_send_reason IS DISTINCT FROM 'scheduled_generation_claim' THEN
      IF NOT coalesce(p_allow_failed_retry, false) THEN
        RETURN QUERY SELECT 'failed'::text, v_gen.id, 'confirmed_failure'::text, NULL::timestamptz;
        RETURN;
      END IF;

      SELECT coalesce(max(g.generation_number), 0) + 1
        INTO v_number
      FROM public.sms_daily_draft_generations g
      WHERE g.clerk_user_id = p_clerk_user_id
        AND g.draft_for_day_key = p_draft_for_day_key
        AND g.send_slot = p_send_slot;

      INSERT INTO public.sms_daily_draft_generations (
        clerk_user_id,
        draft_for_day_key,
        send_slot,
        generation_number,
        generation_reason,
        machine_draft_body,
        machine_should_send,
        machine_no_send_reason,
        writer_openai_messages,
        notebook_verdict,
        notebook_verdict_reason,
        generation_metadata,
        timezone_snapshot
      ) VALUES (
        p_clerk_user_id,
        p_draft_for_day_key,
        p_send_slot,
        v_number,
        'manual_regenerate',
        NULL,
        false,
        'scheduled_generation_claim',
        '[]'::jsonb,
        'not_applicable',
        'writer_not_invoked',
        jsonb_build_object(
          'record_kind', 'generation_claim',
          'scheduled_generation_convention', 'member_local_delivery_v1',
          'member_local_date', p_draft_for_day_key,
          'claim_owner_id', p_claim_owner_id::text,
          'claim_expires_at', v_lease,
          'generation_trigger', 'manual_retry'
        ) || coalesce(p_metadata, '{}'::jsonb),
        NULLIF(coalesce(p_metadata->>'time_zone', ''), '')
      )
      RETURNING id INTO v_id;

      UPDATE public.sms_daily_drafts
      SET
        current_generation_id = v_id,
        current_body_to_send = NULL,
        current_body_source = 'machine',
        edited_by_tyler = false,
        updated_at = clock_timestamp()
      WHERE id = v_draft.id
        AND coalesce(edited_by_tyler, false) = false
        AND current_body_source IS DISTINCT FROM 'tyler_edit'
        AND (
          current_body_to_send IS NULL
          OR length(btrim(current_body_to_send)) = 0
        );

      IF NOT FOUND THEN
        DELETE FROM public.sms_daily_draft_generations WHERE id = v_id;
        RETURN QUERY SELECT 'protected'::text, v_draft.current_generation_id, 'protected_during_retry'::text, NULL::timestamptz;
        RETURN;
      END IF;

      RETURN QUERY SELECT 'claimed'::text, v_id, 'retry_claim'::text, v_lease;
      RETURN;
    END IF;

    RETURN QUERY SELECT 'legacy_conflict'::text, v_gen.id, 'unidentified_current_draft'::text, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT coalesce(max(g.generation_number), 0) + 1
    INTO v_number
  FROM public.sms_daily_draft_generations g
  WHERE g.clerk_user_id = p_clerk_user_id
    AND g.draft_for_day_key = p_draft_for_day_key
    AND g.send_slot = p_send_slot;

  INSERT INTO public.sms_daily_draft_generations (
    clerk_user_id,
    draft_for_day_key,
    send_slot,
    generation_number,
    generation_reason,
    machine_draft_body,
    machine_should_send,
    machine_no_send_reason,
    writer_openai_messages,
    notebook_verdict,
    notebook_verdict_reason,
    generation_metadata,
    timezone_snapshot
  ) VALUES (
    p_clerk_user_id,
    p_draft_for_day_key,
    p_send_slot,
    v_number,
    CASE WHEN p_send_slot = 'evening_checkin' THEN 'evening_sweep' ELSE 'noon_batch' END,
    NULL,
    false,
    'scheduled_generation_claim',
    '[]'::jsonb,
    'not_applicable',
    'writer_not_invoked',
    jsonb_build_object(
      'record_kind', 'generation_claim',
      'scheduled_generation_convention', 'member_local_delivery_v1',
      'member_local_date', p_draft_for_day_key,
      'claim_owner_id', p_claim_owner_id::text,
      'claim_expires_at', v_lease,
      'generation_trigger', 'scheduled_generation_claim'
    ) || coalesce(p_metadata, '{}'::jsonb),
    NULLIF(coalesce(p_metadata->>'time_zone', ''), '')
  )
  RETURNING id INTO v_id;

  BEGIN
    INSERT INTO public.sms_daily_drafts (
      clerk_user_id,
      draft_for_day_key,
      send_slot,
      current_generation_id,
      current_body_to_send,
      current_body_source,
      edited_by_tyler,
      status,
      updated_at
    ) VALUES (
      p_clerk_user_id,
      p_draft_for_day_key,
      p_send_slot,
      v_id,
      NULL,
      'machine',
      false,
      'current',
      clock_timestamp()
    );
    v_inserted := true;
  EXCEPTION
    WHEN unique_violation THEN
      v_inserted := false;
  END;

  IF v_inserted THEN
    RETURN QUERY SELECT 'claimed'::text, v_id, 'new_claim'::text, v_lease;
    RETURN;
  END IF;

  -- The other transaction owns the draft. Drop this unreferenced placeholder.
  DELETE FROM public.sms_daily_draft_generations WHERE id = v_id;

  SELECT d.* INTO v_draft
  FROM public.sms_daily_drafts d
  WHERE d.clerk_user_id = p_clerk_user_id
    AND d.draft_for_day_key = p_draft_for_day_key
    AND d.send_slot = p_send_slot
  FOR UPDATE;

  IF v_draft.id IS NULL THEN
    RETURN QUERY SELECT 'busy'::text, NULL::uuid, 'draft_race'::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_draft.status = 'sent' THEN
    RETURN QUERY SELECT 'sent'::text, v_draft.current_generation_id, 'sent'::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_draft.status IS DISTINCT FROM 'current' THEN
    RETURN QUERY SELECT 'noncurrent'::text, v_draft.current_generation_id, v_draft.status, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT g.* INTO v_gen
  FROM public.sms_daily_draft_generations g
  WHERE g.id = v_draft.current_generation_id;
  IF v_gen.id IS NULL THEN
    RETURN QUERY SELECT 'busy'::text, NULL::uuid, 'draft_race'::text, NULL::timestamptz;
    RETURN;
  END IF;
  v_meta := coalesce(v_gen.generation_metadata, '{}'::jsonb);
  IF v_meta->>'record_kind' = 'generation_claim' THEN
    RETURN QUERY SELECT 'busy'::text, v_gen.id, 'claim_held'::text, NULL::timestamptz;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'busy'::text, v_gen.id, 'draft_race'::text, NULL::timestamptz;
END;
$$;

-- ---------------------------------------------------------------------------
-- Finish. Default path is the previously deployed 9-argument behavior.
-- Scheduled generation passes p_require_claim_owner and must still own the
-- claim. It cannot revive a missing current row.
-- A convention-marked intentional space or non-current draft is not replaced
-- by an unclaimed caller.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.tto_finish_generation_persistence(
  text,
  text,
  text,
  uuid,
  text,
  text,
  timestamptz,
  boolean,
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
  p_allow_replace_stale_tyler_nonempty boolean DEFAULT false,
  p_claim_owner_id uuid DEFAULT NULL,
  p_require_claim_owner boolean DEFAULT false,
  p_reconsideration boolean DEFAULT false,
  p_reconsideration_result text DEFAULT NULL,
  p_expected_generation_id uuid DEFAULT NULL,
  p_expected_edited_at timestamptz DEFAULT NULL,
  p_expected_body_hash text DEFAULT NULL,
  p_expected_body_source text DEFAULT NULL,
  p_expected_edited_by_tyler boolean DEFAULT NULL,
  p_reconsideration_evidence jsonb DEFAULT NULL
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
  v_current_meta jsonb;
  v_current_no_send text;
  v_persist_at timestamptz;
  v_failures integer;
  v_retry timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(
    hashtext('sms_account_deletion_member'),
    hashtext(p_clerk_user_id)
  );
  IF public.sms_account_deletion_member_blocked(p_clerk_user_id) THEN
    RETURN QUERY SELECT false, false, 'account_deletion'::text;
    RETURN;
  END IF;

  -- Scheduled claims persist at the database clock. Other callers keep the
  -- timestamp they already pass, so legacy persistence is unchanged.
  v_persist_at := CASE
    WHEN coalesce(p_require_claim_owner, false) THEN clock_timestamp()
    ELSE p_now
  END;
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

  IF coalesce(p_reconsideration, false) THEN
    IF v_draft.id IS NULL OR v_draft.status IS DISTINCT FROM 'current' THEN
      RETURN QUERY SELECT false, false, 'stale_version'::text;
      RETURN;
    END IF;
    IF v_draft.current_generation_id IS DISTINCT FROM p_expected_generation_id THEN
      RETURN QUERY SELECT false, false, 'stale_version'::text;
      RETURN;
    END IF;
    IF v_draft.edited_at IS DISTINCT FROM p_expected_edited_at THEN
      RETURN QUERY SELECT false, false, 'stale_version'::text;
      RETURN;
    END IF;
    IF coalesce(v_draft.current_body_hash, '') IS DISTINCT FROM coalesce(p_expected_body_hash, '') THEN
      RETURN QUERY SELECT false, false, 'stale_version'::text;
      RETURN;
    END IF;
    IF coalesce(v_draft.current_body_source, '') IS DISTINCT FROM coalesce(p_expected_body_source, '') THEN
      RETURN QUERY SELECT false, false, 'stale_version'::text;
      RETURN;
    END IF;
    IF coalesce(v_draft.edited_by_tyler, false) IS DISTINCT FROM coalesce(p_expected_edited_by_tyler, false) THEN
      RETURN QUERY SELECT false, false, 'stale_version'::text;
      RETURN;
    END IF;

    SELECT g.generation_metadata
      INTO v_current_meta
    FROM public.sms_daily_draft_generations g
    WHERE g.id = v_draft.current_generation_id
    FOR UPDATE;
    v_current_meta := coalesce(v_current_meta, '{}'::jsonb);

    IF v_current_meta->>'reconsideration_claim_owner_id' IS DISTINCT FROM p_claim_owner_id::text THEN
      RETURN QUERY SELECT false, false, 'stale_claim_owner'::text;
      RETURN;
    END IF;
    BEGIN
      v_retry := (v_current_meta->>'reconsideration_claim_expires_at')::timestamptz;
    EXCEPTION WHEN others THEN
      v_retry := NULL;
    END;
    IF v_retry IS NULL OR v_retry <= clock_timestamp() THEN
      RETURN QUERY SELECT false, false, 'stale_claim_owner'::text;
      RETURN;
    END IF;

    IF p_reconsideration_result = 'keep' THEN
      UPDATE public.sms_daily_draft_generations
      SET generation_metadata = (
        v_current_meta
        - 'reconsideration_claim_owner_id'
        - 'reconsideration_claim_expires_at'
        - 'reconsideration_failure_count'
        - 'reconsideration_retry_after'
        - 'reconsideration_failure_evidence'
      ) || jsonb_build_object(
        'reconsideration_evidence', coalesce(p_reconsideration_evidence, '{}'::jsonb)
      )
      WHERE id = v_draft.current_generation_id;
      RETURN QUERY SELECT true, true, 'kept'::text;
      RETURN;
    END IF;

    IF p_reconsideration_result = 'release' THEN
      BEGIN
        v_failures := coalesce((v_current_meta->>'reconsideration_failure_count')::integer, 0) + 1;
      EXCEPTION WHEN others THEN
        v_failures := 1;
      END;
      v_retry := clock_timestamp() + CASE
        WHEN v_failures >= 3 THEN interval '60 minutes'
        ELSE interval '15 minutes'
      END;
      UPDATE public.sms_daily_draft_generations
      SET generation_metadata = (
        v_current_meta
        - 'reconsideration_claim_owner_id'
        - 'reconsideration_claim_expires_at'
      ) || jsonb_build_object(
        'reconsideration_failure_count', v_failures,
        'reconsideration_retry_after', v_retry,
        'reconsideration_failure_evidence', coalesce(p_reconsideration_evidence, '{}'::jsonb)
      )
      WHERE id = v_draft.current_generation_id;
      RETURN QUERY SELECT true, false, 'released'::text;
      RETURN;
    END IF;

    IF p_reconsideration_result IS DISTINCT FROM 'replace' THEN
      RETURN QUERY SELECT false, false, 'reconsideration_invalid'::text;
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
      updated_at = clock_timestamp()
    WHERE id = v_draft.id
      AND status = 'current'
      AND current_generation_id = p_expected_generation_id
      AND edited_at IS NOT DISTINCT FROM p_expected_edited_at
      AND coalesce(current_body_hash, '') IS NOT DISTINCT FROM coalesce(p_expected_body_hash, '')
      AND coalesce(current_body_source, '') IS NOT DISTINCT FROM coalesce(p_expected_body_source, '')
      AND coalesce(edited_by_tyler, false) IS NOT DISTINCT FROM coalesce(p_expected_edited_by_tyler, false);

    IF NOT FOUND THEN
      RETURN QUERY SELECT false, false, 'stale_version'::text;
      RETURN;
    END IF;

    UPDATE public.sms_daily_draft_generations
    SET generation_metadata = (
      coalesce(generation_metadata, '{}'::jsonb)
      - 'reconsideration_failure_count'
      - 'reconsideration_retry_after'
      - 'reconsideration_failure_evidence'
    ) || jsonb_build_object(
      'reconsideration_evidence', coalesce(p_reconsideration_evidence, '{}'::jsonb)
    )
    WHERE id = p_new_generation_id;

    UPDATE public.sms_daily_draft_generations
    SET
      superseded_by_generation_id = p_new_generation_id,
      superseded_at = clock_timestamp()
    WHERE clerk_user_id = p_clerk_user_id
      AND draft_for_day_key = p_draft_for_day_key
      AND send_slot = p_send_slot
      AND id <> p_new_generation_id
      AND superseded_at IS NULL;

    RETURN QUERY SELECT true, false, 'replaced'::text;
    RETURN;
  END IF;

  IF coalesce(p_require_claim_owner, false) AND v_draft.id IS NULL THEN
    RETURN QUERY SELECT false, false, 'scheduled_finish_refused'::text;
    RETURN;
  END IF;

  IF v_draft.id IS NOT NULL AND v_draft.current_generation_id IS NOT NULL THEN
    SELECT g.generation_metadata, g.machine_no_send_reason
      INTO v_current_meta, v_current_no_send
    FROM public.sms_daily_draft_generations g
    WHERE g.id = v_draft.current_generation_id;

    v_current_meta := coalesce(v_current_meta, '{}'::jsonb);

    IF v_current_meta->>'record_kind' = 'generation_claim' THEN
      IF p_claim_owner_id IS NULL
         OR v_current_meta->>'claim_owner_id' IS DISTINCT FROM p_claim_owner_id::text THEN
        RETURN QUERY SELECT false, false, 'stale_claim_owner'::text;
        RETURN;
      END IF;
    ELSIF coalesce(p_require_claim_owner, false) THEN
      IF v_current_no_send = 'intentional_space'
         OR v_draft.edited_by_tyler IS TRUE
         OR v_draft.current_body_source = 'tyler_edit'
         OR (
           v_draft.current_body_to_send IS NOT NULL
           AND length(btrim(v_draft.current_body_to_send)) > 0
         ) THEN
        UPDATE public.sms_daily_draft_generations
        SET
          superseded_by_generation_id = v_draft.current_generation_id,
          superseded_at = v_persist_at
        WHERE id = p_new_generation_id;
        RETURN QUERY SELECT true, true, 'protected'::text;
        RETURN;
      END IF;
      RETURN QUERY SELECT false, false, 'stale_claim_owner'::text;
      RETURN;
    ELSIF v_current_meta->>'scheduled_generation_convention' = 'member_local_delivery_v1'
          AND v_current_no_send = 'intentional_space' THEN
      UPDATE public.sms_daily_draft_generations
      SET
        superseded_by_generation_id = v_draft.current_generation_id,
        superseded_at = v_persist_at
      WHERE id = p_new_generation_id;
      RETURN QUERY SELECT true, true, 'protected'::text;
      RETURN;
    END IF;
  END IF;

  v_nonempty := v_draft.id IS NOT NULL
    AND v_draft.current_body_to_send IS NOT NULL
    AND length(btrim(v_draft.current_body_to_send)) > 0;
  v_tyler := v_draft.id IS NOT NULL
    AND (
      v_draft.edited_by_tyler IS TRUE
      OR v_draft.current_body_source = 'tyler_edit'
    );
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
        superseded_at = v_persist_at
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
        v_persist_at
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

        IF v_draft.id IS NOT NULL
           AND v_draft.status IS DISTINCT FROM 'current'
           AND EXISTS (
             SELECT 1
             FROM public.sms_daily_draft_generations g
             WHERE g.id = v_draft.current_generation_id
               AND g.generation_metadata->>'scheduled_generation_convention'
                   = 'member_local_delivery_v1'
           ) THEN
          RETURN QUERY SELECT true, true, 'protected'::text;
          RETURN;
        END IF;

        IF v_draft.id IS NOT NULL
           AND v_draft.status = 'current'
           AND v_draft.current_generation_id IS NOT NULL THEN
          SELECT g.generation_metadata, g.machine_no_send_reason
            INTO v_current_meta, v_current_no_send
          FROM public.sms_daily_draft_generations g
          WHERE g.id = v_draft.current_generation_id;

          v_current_meta := coalesce(v_current_meta, '{}'::jsonb);

          IF v_current_meta->>'record_kind' = 'generation_claim' THEN
            IF p_claim_owner_id IS NULL
               OR v_current_meta->>'claim_owner_id' IS DISTINCT FROM p_claim_owner_id::text THEN
              RETURN QUERY SELECT false, false, 'stale_claim_owner'::text;
              RETURN;
            END IF;
          ELSIF coalesce(p_require_claim_owner, false) THEN
            IF v_current_no_send = 'intentional_space'
               OR v_draft.edited_by_tyler IS TRUE
               OR v_draft.current_body_source = 'tyler_edit'
               OR (
                 v_draft.current_body_to_send IS NOT NULL
                 AND length(btrim(v_draft.current_body_to_send)) > 0
               ) THEN
              UPDATE public.sms_daily_draft_generations
              SET
                superseded_by_generation_id = v_draft.current_generation_id,
                superseded_at = v_persist_at
              WHERE id = p_new_generation_id;
              RETURN QUERY SELECT true, true, 'protected'::text;
              RETURN;
            END IF;
            RETURN QUERY SELECT false, false, 'stale_claim_owner'::text;
            RETURN;
          ELSIF v_current_meta->>'scheduled_generation_convention' = 'member_local_delivery_v1'
                AND (
                  v_current_no_send = 'intentional_space'
                  OR v_draft.edited_by_tyler IS TRUE
                  OR v_draft.current_body_source = 'tyler_edit'
                  OR (
                    v_draft.current_body_to_send IS NOT NULL
                    AND length(btrim(v_draft.current_body_to_send)) > 0
                  )
                ) THEN
            UPDATE public.sms_daily_draft_generations
            SET
              superseded_by_generation_id = v_draft.current_generation_id,
              superseded_at = v_persist_at
            WHERE id = p_new_generation_id;
            RETURN QUERY SELECT true, true, 'protected'::text;
            RETURN;
          END IF;
        END IF;

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
              superseded_at = v_persist_at
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
    superseded_at = v_persist_at
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
    updated_at = v_persist_at
  WHERE id = v_draft.id
    AND send_slot = p_send_slot
    AND draft_for_day_key = p_draft_for_day_key
    AND clerk_user_id = p_clerk_user_id;

  RETURN QUERY SELECT true, false, 'applied'::text;
END;
$$;

-- ---------------------------------------------------------------------------
-- One read for reconsideration discovery.
-- Newest bounded rows per supplied member. One jsonb row, so a PostgREST
-- row cap cannot drop one member's turns.
-- p_mode discovery stays at 30. p_mode packet uses the Hallway's existing
-- pre-selection bounds: 120 inbound and coach rows, 300 send rows.
-- Both modes rank by the effective event timestamp before the limit.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.tto_reconsideration_conversation_discovery(
  p_clerk_user_ids text[],
  p_now timestamptz,
  p_limit integer DEFAULT 30,
  p_mode text DEFAULT 'discovery'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_mode text := CASE
    WHEN lower(btrim(coalesce(p_mode, 'discovery'))) = 'packet' THEN 'packet'
    ELSE 'discovery'
  END;
  v_limit integer := LEAST(GREATEST(coalesce(p_limit, 30), 1), 30);
  v_message_limit integer := CASE WHEN v_mode = 'packet' THEN 120 ELSE v_limit END;
  v_send_limit integer := CASE WHEN v_mode = 'packet' THEN 300 ELSE v_limit END;
  v_floor timestamptz := p_now - interval '21 days';
BEGIN
  IF p_now IS NULL OR p_clerk_user_ids IS NULL OR cardinality(p_clerk_user_ids) = 0 THEN
    RETURN jsonb_build_object(
      'inbound', '[]'::jsonb,
      'coach', '[]'::jsonb,
      'proactive', '[]'::jsonb,
      'weekly', '[]'::jsonb
    );
  END IF;

  RETURN jsonb_build_object(
    'inbound', COALESCE((
      WITH inbound_ranked AS (
        SELECT
          m.clerk_user_id,
          m.message_sid,
          m.raw_body,
          NULLIF(to_jsonb(m)->>'received_at', '') AS received_at,
          NULLIF(to_jsonb(m)->>'created_at', '') AS created_at,
          NULLIF(to_jsonb(m)->>'updated_at', '') AS updated_at,
          NULLIF(to_jsonb(m)->>'inserted_at', '') AS inserted_at,
          COALESCE(to_jsonb(m)->'metadata', '{}'::jsonb) AS metadata,
          row_number() OVER (
            PARTITION BY m.clerk_user_id
            ORDER BY
              COALESCE(
                NULLIF(to_jsonb(m)->>'received_at', ''),
                NULLIF(to_jsonb(m)->>'created_at', ''),
                NULLIF(to_jsonb(m)->>'updated_at', ''),
                NULLIF(to_jsonb(m)->>'inserted_at', '')
              ) DESC NULLS LAST,
              m.message_sid DESC
          ) AS rn
        FROM public.sms_inbound_messages m
        WHERE m.clerk_user_id = ANY (p_clerk_user_ids)
          AND coalesce(btrim(m.raw_body), '') <> ''
          AND NOT (
            length(btrim(m.raw_body)) <= 12
            AND lower(btrim(m.raw_body)) ~ '^(stop|start|help|unstop|cancel|info|end)$'
          )
          AND (
            COALESCE(
              NULLIF(to_jsonb(m)->>'received_at', ''),
              NULLIF(to_jsonb(m)->>'created_at', ''),
              NULLIF(to_jsonb(m)->>'updated_at', ''),
              NULLIF(to_jsonb(m)->>'inserted_at', '')
            ) IS NULL
            OR (
              COALESCE(
                NULLIF(to_jsonb(m)->>'received_at', ''),
                NULLIF(to_jsonb(m)->>'created_at', ''),
                NULLIF(to_jsonb(m)->>'updated_at', ''),
                NULLIF(to_jsonb(m)->>'inserted_at', '')
              )::timestamptz >= v_floor
              AND COALESCE(
                NULLIF(to_jsonb(m)->>'received_at', ''),
                NULLIF(to_jsonb(m)->>'created_at', ''),
                NULLIF(to_jsonb(m)->>'updated_at', ''),
                NULLIF(to_jsonb(m)->>'inserted_at', '')
              )::timestamptz <= p_now
            )
          )
      )
      SELECT jsonb_agg(
        jsonb_build_object(
          'clerk_user_id', clerk_user_id,
          'message_sid', message_sid,
          'raw_body', raw_body,
          'received_at', received_at,
          'created_at', created_at,
          'updated_at', updated_at,
          'inserted_at', inserted_at,
          'metadata', metadata
        )
        ORDER BY clerk_user_id, rn
      )
      FROM inbound_ranked
      WHERE rn <= v_message_limit
    ), '[]'::jsonb),
    'coach', COALESCE((
      WITH coach_ranked AS (
        SELECT
          j.clerk_user_id,
          j.message_sid,
          j.outbound_message_sid,
          j.raw_body,
          j.reply_body,
          j.status,
          NULLIF(to_jsonb(j)->>'sent_at', '') AS sent_at,
          NULLIF(to_jsonb(j)->>'processed_at', '') AS processed_at,
          NULLIF(to_jsonb(j)->>'created_at', '') AS created_at,
          NULLIF(to_jsonb(j)->>'updated_at', '') AS updated_at,
          COALESCE(to_jsonb(j)->'metadata', '{}'::jsonb) AS metadata,
          row_number() OVER (
            PARTITION BY j.clerk_user_id
            ORDER BY
              COALESCE(
                NULLIF(to_jsonb(j)->>'processed_at', ''),
                NULLIF(to_jsonb(j)->>'sent_at', ''),
                NULLIF(to_jsonb(j)->>'created_at', ''),
                NULLIF(to_jsonb(j)->>'updated_at', '')
              ) DESC NULLS LAST,
              COALESCE(NULLIF(btrim(j.outbound_message_sid), ''), j.message_sid) DESC
          ) AS rn
        FROM public.sms_inbound_coach_jobs j
        WHERE j.clerk_user_id = ANY (p_clerk_user_ids)
          AND (
            CASE
              WHEN v_mode = 'packet' THEN
                coalesce(btrim(j.reply_body), '') <> ''
                OR coalesce(btrim(j.raw_body), '') <> ''
              ELSE coalesce(btrim(j.reply_body), '') <> ''
            END
          )
          AND (
            COALESCE(
              NULLIF(to_jsonb(j)->>'processed_at', ''),
              NULLIF(to_jsonb(j)->>'sent_at', ''),
              NULLIF(to_jsonb(j)->>'created_at', ''),
              NULLIF(to_jsonb(j)->>'updated_at', '')
            ) IS NULL
            OR (
              COALESCE(
                NULLIF(to_jsonb(j)->>'processed_at', ''),
                NULLIF(to_jsonb(j)->>'sent_at', ''),
                NULLIF(to_jsonb(j)->>'created_at', ''),
                NULLIF(to_jsonb(j)->>'updated_at', '')
              )::timestamptz >= v_floor
              AND COALESCE(
                NULLIF(to_jsonb(j)->>'processed_at', ''),
                NULLIF(to_jsonb(j)->>'sent_at', ''),
                NULLIF(to_jsonb(j)->>'created_at', ''),
                NULLIF(to_jsonb(j)->>'updated_at', '')
              )::timestamptz <= p_now
            )
          )
      )
      SELECT jsonb_agg(
        jsonb_build_object(
          'clerk_user_id', clerk_user_id,
          'message_sid', message_sid,
          'outbound_message_sid', outbound_message_sid,
          'raw_body', raw_body,
          'reply_body', reply_body,
          'status', status,
          'sent_at', sent_at,
          'processed_at', processed_at,
          'created_at', created_at,
          'updated_at', updated_at,
          'metadata', metadata
        )
        ORDER BY clerk_user_id, rn
      )
      FROM coach_ranked
      WHERE rn <= v_message_limit
    ), '[]'::jsonb),
    'proactive', COALESCE((
      WITH send_ranked AS (
        SELECT
          e.clerk_user_id,
          to_jsonb(e)->>'status' AS status,
          NULLIF(to_jsonb(e)->>'message_sid', '') AS message_sid,
          NULLIF(to_jsonb(e)->>'outbound_message_sid', '') AS outbound_message_sid,
          NULLIF(to_jsonb(e)->>'sent_at', '') AS sent_at,
          NULLIF(to_jsonb(e)->>'processed_at', '') AS processed_at,
          NULLIF(to_jsonb(e)->>'created_at', '') AS created_at,
          NULLIF(to_jsonb(e)->>'updated_at', '') AS updated_at,
          NULLIF(to_jsonb(e)->>'sms_body', '') AS sms_body,
          NULLIF(to_jsonb(e)->>'body', '') AS body,
          NULLIF(to_jsonb(e)->>'message_body', '') AS message_body,
          NULLIF(to_jsonb(e)->>'final_body', '') AS final_body,
          NULLIF(to_jsonb(e)->>'body_preview', '') AS body_preview,
          COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb) AS metadata,
          row_number() OVER (
            PARTITION BY e.clerk_user_id
            ORDER BY
              COALESCE(
                NULLIF(to_jsonb(e)->>'sent_at', ''),
                NULLIF(to_jsonb(e)->>'processed_at', ''),
                NULLIF(COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'sent_at', ''),
                NULLIF(COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'processed_at', ''),
                NULLIF(to_jsonb(e)->>'updated_at', ''),
                NULLIF(to_jsonb(e)->>'created_at', '')
              ) DESC NULLS LAST,
              COALESCE(
                NULLIF(btrim(to_jsonb(e)->>'message_sid'), ''),
                NULLIF(btrim(to_jsonb(e)->>'outbound_message_sid'), ''),
                ''
              ) DESC
          ) AS rn
        FROM public.sms_send_events e
        WHERE e.clerk_user_id = ANY (p_clerk_user_ids)
          AND lower(coalesce(to_jsonb(e)->>'status', '')) NOT IN ('dry_run', 'preview', 'canceled', 'cancelled')
          AND lower(coalesce(to_jsonb(e)->>'status', '')) NOT LIKE 'skipped%'
          AND coalesce(btrim(COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'no_send_reason'), '') = ''
          AND coalesce(COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'note', '') <> 'daily_v3_lane_no_send'
          AND (
            COALESCE(
              NULLIF(btrim(to_jsonb(e)->>'message_sid'), ''),
              NULLIF(btrim(to_jsonb(e)->>'outbound_message_sid'), ''),
              NULLIF(btrim(COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'message_sid'), '')
            ) IS NOT NULL
            OR lower(coalesce(to_jsonb(e)->>'status', '')) IN ('sent', 'delivered', 'success')
          )
          AND NULLIF(btrim(concat_ws('',
            to_jsonb(e)->>'sms_body',
            to_jsonb(e)->>'body',
            to_jsonb(e)->>'message_body',
            to_jsonb(e)->>'final_body',
            to_jsonb(e)->>'body_preview',
            COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'final_body_sent',
            COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'final_sms_body',
            COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'sms_body',
            COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'body',
            COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'final_body',
            COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'body_preview',
            COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->'north_star_gate'->>'final_body',
            COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->'daily_v3_lane'->>'final_body',
            COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->'final_voice_gate'->>'final_body'
          )), '') IS NOT NULL
          AND (
            COALESCE(
              NULLIF(to_jsonb(e)->>'sent_at', ''),
              NULLIF(to_jsonb(e)->>'processed_at', ''),
              NULLIF(COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'sent_at', ''),
              NULLIF(COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'processed_at', ''),
              NULLIF(to_jsonb(e)->>'updated_at', ''),
              NULLIF(to_jsonb(e)->>'created_at', '')
            ) IS NULL
            OR (
              COALESCE(
                NULLIF(to_jsonb(e)->>'sent_at', ''),
                NULLIF(to_jsonb(e)->>'processed_at', ''),
                NULLIF(COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'sent_at', ''),
                NULLIF(COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'processed_at', ''),
                NULLIF(to_jsonb(e)->>'updated_at', ''),
                NULLIF(to_jsonb(e)->>'created_at', '')
              )::timestamptz >= v_floor
              AND COALESCE(
                NULLIF(to_jsonb(e)->>'sent_at', ''),
                NULLIF(to_jsonb(e)->>'processed_at', ''),
                NULLIF(COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'sent_at', ''),
                NULLIF(COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'processed_at', ''),
                NULLIF(to_jsonb(e)->>'updated_at', ''),
                NULLIF(to_jsonb(e)->>'created_at', '')
              )::timestamptz <= p_now
            )
          )
      )
      SELECT jsonb_agg(
        jsonb_build_object(
          'clerk_user_id', clerk_user_id,
          'status', status,
          'message_sid', message_sid,
          'outbound_message_sid', outbound_message_sid,
          'sent_at', sent_at,
          'processed_at', processed_at,
          'created_at', created_at,
          'updated_at', updated_at,
          'sms_body', sms_body,
          'body', body,
          'message_body', message_body,
          'final_body', final_body,
          'body_preview', body_preview,
          'metadata', metadata
        )
        ORDER BY clerk_user_id, rn
      )
      FROM send_ranked
      WHERE rn <= v_send_limit
    ), '[]'::jsonb),
    'weekly', COALESCE((
      WITH weekly_ranked AS (
        SELECT
          e.clerk_user_id,
          to_jsonb(e)->>'status' AS status,
          NULLIF(to_jsonb(e)->>'message_sid', '') AS message_sid,
          NULLIF(to_jsonb(e)->>'outbound_message_sid', '') AS outbound_message_sid,
          NULLIF(to_jsonb(e)->>'sent_at', '') AS sent_at,
          NULLIF(to_jsonb(e)->>'processed_at', '') AS processed_at,
          NULLIF(to_jsonb(e)->>'created_at', '') AS created_at,
          NULLIF(to_jsonb(e)->>'updated_at', '') AS updated_at,
          NULLIF(to_jsonb(e)->>'sms_body', '') AS sms_body,
          NULLIF(to_jsonb(e)->>'body', '') AS body,
          NULLIF(to_jsonb(e)->>'message_body', '') AS message_body,
          NULLIF(to_jsonb(e)->>'final_body', '') AS final_body,
          NULLIF(to_jsonb(e)->>'body_preview', '') AS body_preview,
          COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb) AS metadata,
          row_number() OVER (
            PARTITION BY e.clerk_user_id
            ORDER BY
              COALESCE(
                NULLIF(to_jsonb(e)->>'sent_at', ''),
                NULLIF(to_jsonb(e)->>'processed_at', ''),
                NULLIF(COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'sent_at', ''),
                NULLIF(COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'processed_at', ''),
                NULLIF(to_jsonb(e)->>'updated_at', ''),
                NULLIF(to_jsonb(e)->>'created_at', '')
              ) DESC NULLS LAST,
              COALESCE(
                NULLIF(btrim(to_jsonb(e)->>'message_sid'), ''),
                NULLIF(btrim(to_jsonb(e)->>'outbound_message_sid'), ''),
                ''
              ) DESC
          ) AS rn
        FROM public.sms_weekly_send_events e
        WHERE e.clerk_user_id = ANY (p_clerk_user_ids)
          AND lower(coalesce(to_jsonb(e)->>'status', '')) NOT IN ('dry_run', 'preview', 'canceled', 'cancelled')
          AND lower(coalesce(to_jsonb(e)->>'status', '')) NOT LIKE 'skipped%'
          AND coalesce(btrim(COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'no_send_reason'), '') = ''
          AND coalesce(COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'note', '') <> 'daily_v3_lane_no_send'
          AND (
            COALESCE(
              NULLIF(btrim(to_jsonb(e)->>'message_sid'), ''),
              NULLIF(btrim(to_jsonb(e)->>'outbound_message_sid'), ''),
              NULLIF(btrim(COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'message_sid'), '')
            ) IS NOT NULL
            OR lower(coalesce(to_jsonb(e)->>'status', '')) IN ('sent', 'delivered', 'success')
          )
          AND NULLIF(btrim(concat_ws('',
            to_jsonb(e)->>'sms_body',
            to_jsonb(e)->>'body',
            to_jsonb(e)->>'final_body',
            to_jsonb(e)->>'body_preview',
            COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'body',
            COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'sms_body',
            COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'final_body',
            COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'body_preview'
          )), '') IS NOT NULL
          AND (
            COALESCE(
              NULLIF(to_jsonb(e)->>'sent_at', ''),
              NULLIF(to_jsonb(e)->>'processed_at', ''),
              NULLIF(COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'sent_at', ''),
              NULLIF(COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'processed_at', ''),
              NULLIF(to_jsonb(e)->>'updated_at', ''),
              NULLIF(to_jsonb(e)->>'created_at', '')
            ) IS NULL
            OR (
              COALESCE(
                NULLIF(to_jsonb(e)->>'sent_at', ''),
                NULLIF(to_jsonb(e)->>'processed_at', ''),
                NULLIF(COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'sent_at', ''),
                NULLIF(COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'processed_at', ''),
                NULLIF(to_jsonb(e)->>'updated_at', ''),
                NULLIF(to_jsonb(e)->>'created_at', '')
              )::timestamptz >= v_floor
              AND COALESCE(
                NULLIF(to_jsonb(e)->>'sent_at', ''),
                NULLIF(to_jsonb(e)->>'processed_at', ''),
                NULLIF(COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'sent_at', ''),
                NULLIF(COALESCE(to_jsonb(e)->'metadata', '{}'::jsonb)->>'processed_at', ''),
                NULLIF(to_jsonb(e)->>'updated_at', ''),
                NULLIF(to_jsonb(e)->>'created_at', '')
              )::timestamptz <= p_now
            )
          )
      )
      SELECT jsonb_agg(
        jsonb_build_object(
          'clerk_user_id', clerk_user_id,
          'status', status,
          'message_sid', message_sid,
          'outbound_message_sid', outbound_message_sid,
          'sent_at', sent_at,
          'processed_at', processed_at,
          'created_at', created_at,
          'updated_at', updated_at,
          'sms_body', sms_body,
          'body', body,
          'message_body', message_body,
          'final_body', final_body,
          'body_preview', body_preview,
          'metadata', metadata
        )
        ORDER BY clerk_user_id, rn
      )
      FROM weekly_ranked
      WHERE rn <= v_send_limit
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.tto_reconsideration_conversation_discovery(
  text[], timestamptz, integer, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tto_reconsideration_conversation_discovery(
  text[], timestamptz, integer, text
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tto_reconsideration_conversation_discovery(
  text[], timestamptz, integer, text
) TO service_role;

-- Binds one Tyler save to the delivery context the server confirmed for that body.
-- The context is replaced only by a later committed save of the same generation.
CREATE FUNCTION public.tto_save_tyler_draft_body(
  p_draft_id uuid,
  p_expected_generation_id uuid,
  p_expected_day text,
  p_expected_slot text,
  p_body text,
  p_body_source text,
  p_edited_by_tyler boolean,
  p_edited_at timestamptz,
  p_edit_distance integer,
  p_body_hash text,
  p_now timestamptz,
  p_delivery_context jsonb,
  p_expected_edited_at timestamptz DEFAULT NULL,
  p_transfer_fence jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_draft public.sms_daily_drafts%ROWTYPE;
  v_context jsonb;
  v_meta jsonb;
  v_prior jsonb;
  v_previous_version jsonb;
  v_saved_version jsonb;
  v_source public.sms_daily_drafts%ROWTYPE;
  v_source_id uuid;
  v_fence_edited timestamptz;
  v_source_edited timestamptz;
  v_target_clerk text;
  v_source_clerk text;
  v_lock_id text;
BEGIN
  SELECT clerk_user_id INTO v_target_clerk
  FROM public.sms_daily_drafts
  WHERE id = p_draft_id;
  v_source_clerk := NULL;
  IF p_transfer_fence IS NOT NULL AND nullif(p_transfer_fence->>'source_draft_id', '') IS NOT NULL THEN
    BEGIN
      SELECT clerk_user_id INTO v_source_clerk
      FROM public.sms_daily_drafts
      WHERE id = (p_transfer_fence->>'source_draft_id')::uuid;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_applied');
    END;
  END IF;
  FOR v_lock_id IN
    SELECT DISTINCT member_id
    FROM unnest(ARRAY[v_target_clerk, v_source_clerk]) AS member_id
    WHERE btrim(coalesce(member_id, '')) <> ''
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock_shared(
      hashtext('sms_account_deletion_member'),
      hashtext(v_lock_id)
    );
    IF public.sms_account_deletion_member_blocked(v_lock_id) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'account_deletion');
    END IF;
  END LOOP;

  v_source_id := NULL;
  IF p_transfer_fence IS NOT NULL AND nullif(p_transfer_fence->>'source_draft_id', '') IS NOT NULL THEN
    BEGIN
      v_source_id := (p_transfer_fence->>'source_draft_id')::uuid;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_applied');
    END;
    IF v_source_id = p_draft_id THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_applied');
    END IF;
    -- Draft rows lock in uuid order so two transfers cannot invert.
    IF v_source_id < p_draft_id THEN
      SELECT * INTO v_source FROM public.sms_daily_drafts WHERE id = v_source_id FOR UPDATE;
      SELECT * INTO v_draft FROM public.sms_daily_drafts WHERE id = p_draft_id FOR UPDATE;
    ELSE
      SELECT * INTO v_draft FROM public.sms_daily_drafts WHERE id = p_draft_id FOR UPDATE;
      SELECT * INTO v_source FROM public.sms_daily_drafts WHERE id = v_source_id FOR UPDATE;
    END IF;
  ELSE
    SELECT * INTO v_draft
    FROM public.sms_daily_drafts
    WHERE id = p_draft_id
    FOR UPDATE;
  END IF;

  IF v_draft.id IS NULL
     OR v_draft.status IS DISTINCT FROM 'current'
     OR v_draft.current_generation_id IS DISTINCT FROM p_expected_generation_id
     OR v_draft.draft_for_day_key IS DISTINCT FROM p_expected_day
     OR v_draft.send_slot IS DISTINCT FROM p_expected_slot
     OR (p_transfer_fence IS NULL AND p_expected_edited_at IS NOT NULL AND v_draft.edited_at IS DISTINCT FROM p_expected_edited_at) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_applied');
  END IF;

  IF p_transfer_fence IS NOT NULL THEN
    IF v_source_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_applied');
    END IF;
    BEGIN
      IF p_transfer_fence->'expected_edited_at' IS NULL
         OR jsonb_typeof(p_transfer_fence->'expected_edited_at') = 'null' THEN
        v_fence_edited := NULL;
      ELSE
        v_fence_edited := (p_transfer_fence->>'expected_edited_at')::timestamptz;
      END IF;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_applied');
    END;
    IF v_draft.edited_at IS DISTINCT FROM v_fence_edited
       OR coalesce(v_draft.current_body_hash, '') IS DISTINCT FROM coalesce(p_transfer_fence->>'expected_body_hash', '')
       OR coalesce(v_draft.current_body_source, '') IS DISTINCT FROM coalesce(p_transfer_fence->>'expected_body_source', '')
       OR coalesce(v_draft.edited_by_tyler, false) IS DISTINCT FROM coalesce((p_transfer_fence->>'expected_edited_by_tyler')::boolean, false) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_applied');
    END IF;
    IF v_source.id IS NULL
       OR v_source.status IS DISTINCT FROM 'current'
       OR v_source.current_generation_id::text IS DISTINCT FROM coalesce(p_transfer_fence->>'source_generation_id', '')
       OR coalesce(v_source.edited_by_tyler, false) IS DISTINCT FROM true
       OR coalesce(v_source.current_body_source, '') IS DISTINCT FROM 'tyler_edit'
       OR btrim(coalesce(v_source.current_body_to_send, '')) IS DISTINCT FROM btrim(coalesce(p_body, ''))
       OR coalesce(v_source.current_body_hash, '') IS DISTINCT FROM coalesce(p_transfer_fence->>'source_body_hash', '') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_applied');
    END IF;
    BEGIN
      IF p_transfer_fence->'source_edited_at' IS NULL
         OR jsonb_typeof(p_transfer_fence->'source_edited_at') = 'null' THEN
        v_source_edited := NULL;
      ELSE
        v_source_edited := (p_transfer_fence->>'source_edited_at')::timestamptz;
      END IF;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_applied');
    END;
    IF v_source.edited_at IS DISTINCT FROM v_source_edited THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_applied');
    END IF;
  END IF;

  -- Target-bound context keeps the target generation id for existing version checks.
  -- The original source context is stored separately when this is a transfer.
  v_context := coalesce(p_delivery_context, '{}'::jsonb) || jsonb_build_object(
    'body_hash', p_body_hash,
    'generation_id', p_expected_generation_id::text,
    'edited_at', p_edited_at
  );

  UPDATE public.sms_daily_drafts
  SET
    current_body_to_send = p_body,
    current_body_source = p_body_source,
    edited_by_tyler = p_edited_by_tyler,
    edited_at = p_edited_at,
    edit_distance_chars = p_edit_distance,
    current_body_hash = p_body_hash,
    updated_at = p_now
  WHERE id = p_draft_id
    AND status = 'current'
    AND current_generation_id = p_expected_generation_id;

  v_previous_version := jsonb_build_object(
    'generation_id', v_draft.current_generation_id,
    'body_hash', v_draft.current_body_hash,
    'edited_at', v_draft.edited_at,
    'body_source', v_draft.current_body_source,
    'edited_by_tyler', COALESCE(v_draft.edited_by_tyler, false)
  );
  v_saved_version := jsonb_build_object(
    'generation_id', p_expected_generation_id,
    'body_hash', p_body_hash,
    'edited_at', p_edited_at,
    'body_source', p_body_source,
    'edited_by_tyler', COALESCE(p_edited_by_tyler, false)
  );
  SELECT coalesce(generation_metadata, '{}'::jsonb)
    INTO v_meta
  FROM public.sms_daily_draft_generations
  WHERE id = p_expected_generation_id
  FOR UPDATE;
  v_meta := coalesce(v_meta, '{}'::jsonb)
    - 'reconsideration_failure_evidence'
    - 'reconsideration_failure_count'
    - 'reconsideration_retry_after';
  IF v_meta ? 'reconsideration_evidence' THEN
    v_prior := v_meta->'reconsideration_evidence';
    v_meta := v_meta || jsonb_build_object(
      'reconsideration_evidence',
      (v_prior
        - 'model_existing_text_decision'
        - 'body_retention'
        - 'delivery_mismatch_unresolved')
      || jsonb_build_object(
        'current_body_approval', false,
        'applies_to_body_version', coalesce(v_prior->'applies_to_body_version', v_previous_version)
      )
    );
  END IF;
  v_meta := v_meta || jsonb_build_object(
    'tyler_edit_delivery_context', v_context,
    'current_body_version', v_saved_version
  );
  IF p_transfer_fence IS NOT NULL THEN
    v_meta := v_meta || jsonb_build_object(
      'cross_owner_source_edit', p_transfer_fence,
      'cross_owner_source_context', coalesce(p_delivery_context, '{}'::jsonb)
    );
  END IF;

  UPDATE public.sms_daily_draft_generations
  SET generation_metadata = v_meta
  WHERE id = p_expected_generation_id;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_draft.id,
    'clerk_user_id', v_draft.clerk_user_id,
    'draft_for_day_key', v_draft.draft_for_day_key,
    'send_slot', v_draft.send_slot,
    'current_generation_id', v_draft.current_generation_id,
    'current_body_to_send', p_body,
    'current_body_source', p_body_source,
    'edited_by_tyler', p_edited_by_tyler,
    'edited_at', p_edited_at,
    'status', v_draft.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.tto_save_tyler_draft_body(
  uuid, uuid, text, text, text, text, boolean, timestamptz, integer, text, timestamptz, jsonb, timestamptz, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tto_save_tyler_draft_body(
  uuid, uuid, text, text, text, text, boolean, timestamptz, integer, text, timestamptz, jsonb, timestamptz, jsonb
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tto_save_tyler_draft_body(
  uuid, uuid, text, text, text, text, boolean, timestamptz, integer, text, timestamptz, jsonb, timestamptz, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.tto_generation_batch_open(
  text, text, text, timestamptz, integer, integer, integer, jsonb, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tto_generation_batch_patch(
  text, text, text, jsonb, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tto_claim_scheduled_generation(
  text, text, text, uuid, timestamptz, jsonb, boolean, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tto_finish_generation_persistence(
  text, text, text, uuid, text, text, timestamptz, boolean, boolean, uuid, boolean, boolean, text, uuid, timestamptz, text, text, boolean, jsonb
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.tto_generation_batch_open(
  text, text, text, timestamptz, integer, integer, integer, jsonb, jsonb
) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.tto_generation_batch_patch(
  text, text, text, jsonb, jsonb
) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.tto_claim_scheduled_generation(
  text, text, text, uuid, timestamptz, jsonb, boolean, text
) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.tto_finish_generation_persistence(
  text, text, text, uuid, text, text, timestamptz, boolean, boolean, uuid, boolean, boolean, text, uuid, timestamptz, text, text, boolean, jsonb
) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.tto_generation_batch_open(
  text, text, text, timestamptz, integer, integer, integer, jsonb, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.tto_generation_batch_patch(
  text, text, text, jsonb, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.tto_claim_scheduled_generation(
  text, text, text, uuid, timestamptz, jsonb, boolean, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.tto_finish_generation_persistence(
  text, text, text, uuid, text, text, timestamptz, boolean, boolean, uuid, boolean, boolean, text, uuid, timestamptz, text, text, boolean, jsonb
) TO service_role;

-- ---------------------------------------------------------------------------
-- One scheduled daily delivery across Morning and Evening.
-- Advisory lock serializes both slots for one member-local date.
-- Historical rows are read, never rewritten to satisfy a new unique index.
-- The provider-attempt flag is committed before Twilio and is not cleared
-- when the response is missing.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.tto_reserve_scheduled_daily_delivery(
  p_clerk_user_id text,
  p_member_local_date text,
  p_send_slot text,
  p_time_zone text,
  p_reservation_owner_id uuid,
  p_generation_id uuid,
  p_body_hash text,
  p_edited_at timestamptz,
  p_phone text,
  p_metadata jsonb
)
RETURNS TABLE (outcome text, event_id uuid, reason text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row public.sms_send_events%ROWTYPE;
  v_block boolean := false;
  v_retry uuid := NULL;
  v_reclaim uuid := NULL;
  v_owned uuid := NULL;
  v_attempted boolean;
  v_sid text;
  v_retries integer;
  v_meta jsonb;
  v_applies boolean;
  v_provider timestamptz;
  v_lease timestamptz;
  v_lease_known boolean;
BEGIN
  IF p_send_slot IS DISTINCT FROM 'morning' AND p_send_slot IS DISTINCT FROM 'evening_checkin' THEN
    RETURN QUERY SELECT 'refused'::text, NULL::uuid, 'bad_slot'::text;
    RETURN;
  END IF;
  IF p_reservation_owner_id IS NULL OR p_member_local_date IS NULL OR p_phone IS NULL THEN
    RETURN QUERY SELECT 'refused'::text, NULL::uuid, 'missing_authority'::text;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock_shared(
    hashtext('sms_account_deletion_member'),
    hashtext(p_clerk_user_id)
  );
  IF public.sms_account_deletion_member_blocked(p_clerk_user_id) THEN
    RETURN QUERY SELECT 'refused'::text, NULL::uuid, 'account_deletion'::text;
    RETURN;
  END IF;
  BEGIN
    PERFORM (clock_timestamp() AT TIME ZONE p_time_zone);
  EXCEPTION WHEN others THEN
    RETURN QUERY SELECT 'unresolved'::text, NULL::uuid, 'timezone_invalid'::text;
    RETURN;
  END;

  PERFORM pg_advisory_xact_lock(hashtext(p_clerk_user_id), hashtext('scheduled-daily-member'));

  FOR v_row IN
    SELECT e.*
    FROM public.sms_send_events e
    WHERE e.clerk_user_id = p_clerk_user_id
      AND e.send_slot IN ('morning', 'evening_checkin')
    ORDER BY e.id
    FOR UPDATE
  LOOP
    v_attempted := coalesce(v_row.metadata->>'twilio_send_attempted', '') = 'true';
    v_sid := nullif(btrim(coalesce(v_row.message_sid, '')), '');
    v_applies := v_row.day_key = p_member_local_date
      OR coalesce(v_row.metadata->>'member_local_date', '') = p_member_local_date;
    v_provider := NULL;
    BEGIN
      v_provider := coalesce(
        nullif(v_row.metadata->>'provider_attempt_at', '')::timestamptz,
        nullif(v_row.metadata->>'sent_at', '')::timestamptz
      );
    EXCEPTION WHEN others THEN
      v_provider := NULL;
    END;
    IF v_provider IS NOT NULL
       AND to_char(v_provider AT TIME ZONE p_time_zone, 'YYYY-MM-DD') = p_member_local_date THEN
      v_applies := true;
    ELSIF v_provider IS NULL
       AND v_row.created_at IS NOT NULL
       AND to_char(v_row.created_at AT TIME ZONE p_time_zone, 'YYYY-MM-DD') = p_member_local_date THEN
      v_applies := true;
    END IF;

    -- A live pre-provider reservation blocks every proposed date.
    -- An expired one can be reclaimed only for its own applicable date.
    IF v_row.status = 'reserved'
       AND v_sid IS NULL
       AND NOT v_attempted
       AND coalesce(v_row.metadata->>'scheduled_delivery', '') = 'member_local_delivery_v1' THEN
      v_lease := NULL;
      v_lease_known := false;
      BEGIN
        IF nullif(v_row.metadata->>'reserved_at', '') IS NULL THEN
          v_lease_known := false;
        ELSE
          v_lease := (v_row.metadata->>'reserved_at')::timestamptz;
          v_lease_known := v_lease IS NOT NULL;
        END IF;
      EXCEPTION WHEN others THEN
        v_lease_known := false;
      END;
      IF NOT v_lease_known THEN
        v_block := true;
      ELSIF v_lease > clock_timestamp() - interval '2 minutes' THEN
        IF v_row.send_slot = p_send_slot
           AND v_row.metadata->>'reservation_owner_id' = p_reservation_owner_id::text THEN
          v_owned := v_row.id;
        ELSE
          v_block := true;
        END IF;
      ELSIF v_applies AND v_row.send_slot = p_send_slot
            AND coalesce(v_row.metadata->>'reservation_owner_id', '') IS DISTINCT FROM p_reservation_owner_id::text THEN
        v_reclaim := v_row.id;
      ELSIF v_applies THEN
        v_block := true;
      END IF;
      CONTINUE;
    END IF;

    IF NOT v_applies THEN
      CONTINUE;
    END IF;
    IF v_sid IS NOT NULL OR v_row.status = 'sent' OR v_attempted THEN
      v_block := true;
    ELSIF v_row.status = 'reserved' THEN
      IF v_row.send_slot = p_send_slot
         AND v_row.metadata->>'reservation_owner_id' = p_reservation_owner_id::text
         AND NOT v_attempted THEN
        v_owned := v_row.id;
      ELSE
        v_block := true;
      END IF;
    ELSIF v_row.status = 'send_failed' AND NOT v_attempted AND v_sid IS NULL AND v_row.send_slot = p_send_slot THEN
      v_retry := v_row.id;
    ELSIF v_row.status NOT IN (
      'send_failed',
      'dry_run',
      'skipped_missing_twilio',
      'skipped_already_completed',
      'skipped_tto_authoritative_fail_closed',
      'skipped_not_time',
      'skipped_active_inbound_thread'
    ) THEN
      v_block := true;
    END IF;
  END LOOP;

  IF v_block THEN
    RETURN QUERY SELECT 'blocked'::text, NULL::uuid, 'daily_delivery_closed'::text;
    RETURN;
  END IF;
  IF v_owned IS NOT NULL THEN
    RETURN QUERY SELECT 'reserved'::text, v_owned, 'already_owned'::text;
    RETURN;
  END IF;
  IF v_reclaim IS NOT NULL THEN
    UPDATE public.sms_send_events
    SET metadata = metadata || jsonb_build_object(
      'reservation_owner_id', p_reservation_owner_id::text,
      'reserved_at', to_jsonb(clock_timestamp()),
      'reclaimed_pre_provider', true,
      'twilio_send_attempted', false
    )
    WHERE id = v_reclaim
      AND status = 'reserved'
      AND coalesce(metadata->>'twilio_send_attempted', '') IS DISTINCT FROM 'true'
      AND message_sid IS NULL
      AND coalesce(metadata->>'scheduled_delivery', '') = 'member_local_delivery_v1';
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'blocked'::text, v_reclaim, 'reclaim_lost'::text;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'reserved'::text, v_reclaim, 'reclaimed'::text;
    RETURN;
  END IF;

  v_meta := coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'member_local_date', p_member_local_date,
    'reservation_owner_id', p_reservation_owner_id::text,
    'generation_id', p_generation_id::text,
    'body_hash', p_body_hash,
    'edited_at', CASE WHEN p_edited_at IS NULL THEN NULL ELSE to_jsonb(p_edited_at) END,
    'phone', p_phone,
    'send_slot', p_send_slot,
    'time_zone', p_time_zone,
    'twilio_send_attempted', false,
    'reserved_at', to_jsonb(clock_timestamp()),
    'scheduled_delivery', 'member_local_delivery_v1'
  );

  IF v_retry IS NOT NULL THEN
    SELECT coalesce((metadata->>'retry_count')::integer, 0) INTO v_retries
    FROM public.sms_send_events WHERE id = v_retry;
    IF v_retries >= 3 THEN
      RETURN QUERY SELECT 'blocked'::text, v_retry, 'retry_exhausted'::text;
      RETURN;
    END IF;
    UPDATE public.sms_send_events
    SET status = 'reserved',
        metadata = v_meta || jsonb_build_object('retry_count', v_retries + 1, 'note', 'scheduled_daily_safe_retry')
    WHERE id = v_retry
      AND status = 'send_failed'
      AND coalesce(metadata->>'twilio_send_attempted', '') IS DISTINCT FROM 'true'
      AND message_sid IS NULL;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'blocked'::text, v_retry, 'retry_lost'::text;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'reserved'::text, v_retry, 'retried'::text;
    RETURN;
  END IF;

  INSERT INTO public.sms_send_events (clerk_user_id, day_key, send_slot, status, metadata)
  VALUES (p_clerk_user_id, p_member_local_date, p_send_slot, 'reserved', v_meta)
  RETURNING id INTO v_owned;
  RETURN QUERY SELECT 'reserved'::text, v_owned, 'inserted'::text;
EXCEPTION WHEN unique_violation THEN
  RETURN QUERY SELECT 'blocked'::text, NULL::uuid, 'slot_already_reserved'::text;
END;
$$;

CREATE FUNCTION public.tto_begin_scheduled_daily_provider_attempt(
  p_event_id uuid,
  p_reservation_owner_id uuid,
  p_generation_id uuid,
  p_body_hash text,
  p_edited_at timestamptz,
  p_phone text,
  p_clerk_user_id text,
  p_member_local_date text,
  p_send_slot text,
  p_body text,
  p_utc_instant timestamptz,
  p_batch_date text,
  p_time_zone text,
  p_other_slot_fence jsonb DEFAULT NULL
)
RETURNS TABLE (outcome text, reason text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row public.sms_send_events%ROWTYPE;
  v_other public.sms_send_events%ROWTYPE;
  v_draft public.sms_daily_drafts%ROWTYPE;
  v_other_draft public.sms_daily_drafts%ROWTYPE;
  v_draft_row public.sms_daily_drafts%ROWTYPE;
  v_other_found boolean := false;
  v_draft_found boolean := false;
  v_batch public.sms_tto_generation_batches%ROWTYPE;
  v_occurrence jsonb;
  v_lease timestamptz;
  v_local_date text;
  v_applies boolean;
  v_provider timestamptz;
  v_attempted boolean;
  v_sid text;
  v_found boolean := false;
BEGIN
  IF p_clerk_user_id IS NULL OR p_utc_instant IS NULL OR p_time_zone IS NULL THEN
    RETURN QUERY SELECT 'refused'::text, 'missing_authority'::text;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock_shared(
    hashtext('sms_account_deletion_member'),
    hashtext(p_clerk_user_id)
  );
  IF public.sms_account_deletion_member_blocked(p_clerk_user_id) THEN
    RETURN QUERY SELECT 'refused'::text, 'account_deletion'::text;
    RETURN;
  END IF;
  -- Deletion fence, then member advisory, then batch, then draft, then send events by id.
  PERFORM pg_advisory_xact_lock(hashtext(p_clerk_user_id), hashtext('scheduled-daily-member'));
  SELECT * INTO v_batch
  FROM public.sms_tto_generation_batches
  WHERE batch_date = p_batch_date
    AND send_slot = p_send_slot
  FOR UPDATE;
  FOR v_draft_row IN
    SELECT *
    FROM public.sms_daily_drafts
    WHERE clerk_user_id = p_clerk_user_id
      AND draft_for_day_key = p_member_local_date
      AND send_slot IN ('morning', 'evening_checkin')
      AND status = 'current'
    ORDER BY id
    FOR UPDATE
  LOOP
    IF v_draft_row.send_slot = p_send_slot THEN
      v_draft := v_draft_row;
      v_draft_found := true;
    ELSE
      v_other_draft := v_draft_row;
      v_other_found := true;
    END IF;
  END LOOP;
  IF NOT v_draft_found THEN
    RETURN QUERY SELECT 'stale'::text, 'draft_changed'::text;
    RETURN;
  END IF;
  IF v_draft.current_generation_id IS DISTINCT FROM p_generation_id
     OR coalesce(v_draft.current_body_hash, '') IS DISTINCT FROM coalesce(p_body_hash, '')
     OR btrim(coalesce(v_draft.current_body_to_send, '')) IS DISTINCT FROM btrim(coalesce(p_body, ''))
     OR v_draft.edited_at IS DISTINCT FROM p_edited_at THEN
    RETURN QUERY SELECT 'stale'::text, 'draft_changed'::text;
    RETURN;
  END IF;
  IF p_other_slot_fence IS NOT NULL THEN
    BEGIN
      IF coalesce((p_other_slot_fence->>'present')::boolean, false) IS DISTINCT FROM v_other_found THEN
        RETURN QUERY SELECT 'stale'::text, 'cross_owner_changed'::text;
        RETURN;
      END IF;
      IF v_other_found THEN
        DECLARE
          v_fence_edited timestamptz;
        BEGIN
          IF p_other_slot_fence->'edited_at' IS NULL
             OR jsonb_typeof(p_other_slot_fence->'edited_at') = 'null' THEN
            v_fence_edited := NULL;
          ELSE
            v_fence_edited := (p_other_slot_fence->>'edited_at')::timestamptz;
          END IF;
          IF v_other_draft.id::text IS DISTINCT FROM coalesce(p_other_slot_fence->>'draft_id', '')
             OR v_other_draft.current_generation_id::text IS DISTINCT FROM coalesce(p_other_slot_fence->>'generation_id', '')
             OR coalesce(v_other_draft.current_body_hash, '') IS DISTINCT FROM coalesce(p_other_slot_fence->>'body_hash', '')
             OR coalesce(v_other_draft.current_body_source, '') IS DISTINCT FROM coalesce(p_other_slot_fence->>'body_source', '')
             OR coalesce(v_other_draft.edited_by_tyler, false) IS DISTINCT FROM coalesce((p_other_slot_fence->>'edited_by_tyler')::boolean, false)
             OR v_other_draft.edited_at IS DISTINCT FROM v_fence_edited THEN
            RETURN QUERY SELECT 'stale'::text, 'cross_owner_changed'::text;
            RETURN;
          END IF;
        END;
      END IF;
    EXCEPTION WHEN others THEN
      RETURN QUERY SELECT 'stale'::text, 'cross_owner_changed'::text;
      RETURN;
    END;
  END IF;
  IF v_batch.id IS NOT NULL THEN
    SELECT value INTO v_occurrence
    FROM jsonb_array_elements(coalesce(v_batch.occurrences, '[]'::jsonb))
    WHERE value->>'clerk_user_id' = p_clerk_user_id
      AND value->>'member_local_date' = p_member_local_date
    LIMIT 1;
    IF v_occurrence IS NOT NULL
       AND coalesce(v_occurrence->>'state', '') NOT IN ('generated', 'intentional_space', 'protected') THEN
      RETURN QUERY SELECT 'stale'::text, 'occurrence_not_sendable'::text;
      RETURN;
    END IF;
  END IF;
  FOR v_other IN
    SELECT e.*
    FROM public.sms_send_events e
    WHERE e.clerk_user_id = p_clerk_user_id
      AND e.send_slot IN ('morning', 'evening_checkin')
    ORDER BY e.id
    FOR UPDATE
  LOOP
    IF v_other.id = p_event_id THEN
      v_row := v_other;
      v_found := true;
      CONTINUE;
    END IF;
    v_attempted := coalesce(v_other.metadata->>'twilio_send_attempted', '') = 'true';
    v_sid := nullif(btrim(coalesce(v_other.message_sid, '')), '');
    IF v_other.status = 'reserved' AND v_sid IS NULL AND NOT v_attempted
       AND coalesce(v_other.metadata->>'scheduled_delivery', '') = 'member_local_delivery_v1' THEN
      BEGIN
        v_lease := nullif(v_other.metadata->>'reserved_at', '')::timestamptz;
      EXCEPTION WHEN others THEN
        RETURN QUERY SELECT 'stale'::text, 'lease_unreadable'::text;
        RETURN;
      END;
      IF v_lease IS NULL OR v_lease > clock_timestamp() - interval '2 minutes' THEN
        RETURN QUERY SELECT 'blocked'::text, 'competing_reservation'::text;
        RETURN;
      END IF;
      CONTINUE;
    END IF;
    v_applies := v_other.day_key = p_member_local_date
      OR coalesce(v_other.metadata->>'member_local_date', '') = p_member_local_date;
    BEGIN
      v_provider := coalesce(
        nullif(v_other.metadata->>'provider_attempt_at', '')::timestamptz,
        nullif(v_other.metadata->>'sent_at', '')::timestamptz
      );
    EXCEPTION WHEN others THEN
      v_provider := NULL;
    END;
    IF v_provider IS NOT NULL
       AND to_char(v_provider AT TIME ZONE p_time_zone, 'YYYY-MM-DD') = p_member_local_date THEN
      v_applies := true;
    ELSIF v_provider IS NULL AND v_other.created_at IS NOT NULL
       AND to_char(v_other.created_at AT TIME ZONE p_time_zone, 'YYYY-MM-DD') = p_member_local_date THEN
      v_applies := true;
    END IF;
    IF v_applies AND (v_sid IS NOT NULL OR v_other.status = 'sent' OR v_attempted) THEN
      RETURN QUERY SELECT 'blocked'::text, 'daily_delivery_closed'::text;
      RETURN;
    END IF;
  END LOOP;
  IF NOT v_found OR v_row.clerk_user_id IS DISTINCT FROM p_clerk_user_id THEN
    RETURN QUERY SELECT 'lost'::text, 'missing'::text;
    RETURN;
  END IF;
  IF clock_timestamp() < p_utc_instant
     OR clock_timestamp() >= p_utc_instant + interval '15 minutes' THEN
    RETURN QUERY SELECT 'stale'::text, 'grace'::text;
    RETURN;
  END IF;
  BEGIN
    v_local_date := to_char(clock_timestamp() AT TIME ZONE p_time_zone, 'YYYY-MM-DD');
  EXCEPTION WHEN others THEN
    RETURN QUERY SELECT 'stale'::text, 'timezone_invalid'::text;
    RETURN;
  END;
  IF v_local_date IS DISTINCT FROM p_member_local_date THEN
    RETURN QUERY SELECT 'stale'::text, 'member_local_date_rolled'::text;
    RETURN;
  END IF;
  BEGIN
    v_lease := nullif(v_row.metadata->>'reserved_at', '')::timestamptz;
  EXCEPTION WHEN others THEN
    RETURN QUERY SELECT 'stale'::text, 'lease_unreadable'::text;
    RETURN;
  END;
  IF coalesce(v_row.metadata->>'scheduled_delivery', '') IS DISTINCT FROM 'member_local_delivery_v1'
     OR v_lease IS NULL
     OR v_lease <= clock_timestamp() - interval '2 minutes' THEN
    RETURN QUERY SELECT 'stale'::text, 'lease_expired'::text;
    RETURN;
  END IF;
  IF v_row.status IS DISTINCT FROM 'reserved'
     OR v_row.metadata->>'reservation_owner_id' IS DISTINCT FROM p_reservation_owner_id::text
     OR coalesce(v_row.metadata->>'twilio_send_attempted', '') = 'true'
     OR nullif(btrim(coalesce(v_row.message_sid, '')), '') IS NOT NULL THEN
    RETURN QUERY SELECT 'lost'::text, 'reservation_not_owned'::text;
    RETURN;
  END IF;
  IF v_row.metadata->>'generation_id' IS DISTINCT FROM p_generation_id::text
     OR coalesce(v_row.metadata->>'body_hash', '') IS DISTINCT FROM coalesce(p_body_hash, '')
     OR coalesce(v_row.metadata->>'phone', '') IS DISTINCT FROM coalesce(p_phone, '') THEN
    RETURN QUERY SELECT 'stale'::text, 'authority_changed'::text;
    RETURN;
  END IF;
  IF p_edited_at IS DISTINCT FROM NULLIF(v_row.metadata->>'edited_at', '')::timestamptz THEN
    RETURN QUERY SELECT 'stale'::text, 'edited_at_changed'::text;
    RETURN;
  END IF;
  UPDATE public.sms_send_events
  SET metadata = v_row.metadata || jsonb_build_object(
    'twilio_send_attempted', true,
    'provider_attempt_at', to_jsonb(clock_timestamp())
  )
  WHERE id = p_event_id
    AND status = 'reserved'
    AND metadata->>'reservation_owner_id' = p_reservation_owner_id::text
    AND coalesce(metadata->>'twilio_send_attempted', '') IS DISTINCT FROM 'true';
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'lost'::text, 'attempt_not_marked'::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'attempt'::text, 'marked'::text;
END;
$$;

CREATE FUNCTION public.tto_abort_scheduled_daily_reservation(
  p_event_id uuid,
  p_reservation_owner_id uuid,
  p_reason text,
  p_clerk_user_id text DEFAULT NULL
)
RETURNS TABLE (outcome text, reason text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row public.sms_send_events%ROWTYPE;
  v_clerk text;
BEGIN
  v_clerk := nullif(btrim(coalesce(p_clerk_user_id, '')), '');
  IF v_clerk IS NULL THEN
    SELECT clerk_user_id INTO v_clerk
    FROM public.sms_send_events
    WHERE id = p_event_id;
  END IF;
  IF v_clerk IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock_shared(
      hashtext('sms_account_deletion_member'),
      hashtext(v_clerk)
    );
    IF public.sms_account_deletion_member_blocked(v_clerk) THEN
      RETURN QUERY SELECT 'lost'::text, 'account_deletion'::text;
      RETURN;
    END IF;
  END IF;
  IF p_clerk_user_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_clerk_user_id), hashtext('scheduled-daily-member'));
  END IF;
  SELECT * INTO v_row FROM public.sms_send_events WHERE id = p_event_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RETURN QUERY SELECT 'lost'::text, 'missing'::text;
    RETURN;
  END IF;
  IF p_clerk_user_id IS NOT NULL AND v_row.clerk_user_id IS DISTINCT FROM p_clerk_user_id THEN
    RETURN QUERY SELECT 'lost'::text, 'other_member'::text;
    RETURN;
  END IF;
  IF v_row.metadata->>'reservation_owner_id' IS DISTINCT FROM p_reservation_owner_id::text THEN
    RETURN QUERY SELECT 'lost'::text, 'other_owner'::text;
    RETURN;
  END IF;
  IF coalesce(v_row.metadata->>'twilio_send_attempted', '') = 'true'
     OR nullif(btrim(coalesce(v_row.message_sid, '')), '') IS NOT NULL
     OR v_row.status = 'sent' THEN
    RETURN QUERY SELECT 'uncertain'::text, 'provider_boundary_held'::text;
    RETURN;
  END IF;
  UPDATE public.sms_send_events
  SET status = 'send_failed',
      metadata = v_row.metadata || jsonb_build_object(
        'twilio_send_attempted', false,
        'note', 'proven_pre_provider_failure',
        'abort_reason', p_reason
      )
  WHERE id = p_event_id
    AND status = 'reserved'
    AND coalesce(metadata->>'twilio_send_attempted', '') IS DISTINCT FROM 'true';
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'lost'::text, 'not_aborted'::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'aborted'::text, 'pre_provider'::text;
END;
$$;

CREATE FUNCTION public.tto_finalize_scheduled_daily_acceptance(
  p_event_id uuid,
  p_reservation_owner_id uuid,
  p_message_sid text,
  p_body text,
  p_clerk_user_id text DEFAULT NULL
)
RETURNS TABLE (outcome text, reason text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row public.sms_send_events%ROWTYPE;
  v_clerk text;
BEGIN
  IF p_message_sid IS NULL OR btrim(p_message_sid) = '' THEN
    RETURN QUERY SELECT 'refused'::text, 'missing_sid'::text;
    RETURN;
  END IF;
  v_clerk := nullif(btrim(coalesce(p_clerk_user_id, '')), '');
  IF v_clerk IS NULL THEN
    SELECT clerk_user_id INTO v_clerk
    FROM public.sms_send_events
    WHERE id = p_event_id;
  END IF;
  IF v_clerk IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock_shared(
      hashtext('sms_account_deletion_member'),
      hashtext(v_clerk)
    );
    IF public.sms_account_deletion_member_blocked(v_clerk) THEN
      RETURN QUERY SELECT 'lost'::text, 'account_deletion'::text;
      RETURN;
    END IF;
  END IF;
  IF p_clerk_user_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_clerk_user_id), hashtext('scheduled-daily-member'));
  END IF;
  SELECT * INTO v_row FROM public.sms_send_events WHERE id = p_event_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RETURN QUERY SELECT 'lost'::text, 'missing'::text;
    RETURN;
  END IF;
  IF v_row.metadata->>'reservation_owner_id' IS DISTINCT FROM p_reservation_owner_id::text THEN
    RETURN QUERY SELECT 'lost'::text, 'other_owner'::text;
    RETURN;
  END IF;
  IF coalesce(v_row.metadata->>'twilio_send_attempted', '') IS DISTINCT FROM 'true' THEN
    RETURN QUERY SELECT 'lost'::text, 'attempt_not_marked'::text;
    RETURN;
  END IF;
  IF v_row.message_sid IS NOT NULL AND v_row.message_sid IS DISTINCT FROM p_message_sid THEN
    RETURN QUERY SELECT 'blocked'::text, 'different_sid'::text;
    RETURN;
  END IF;
  UPDATE public.sms_send_events
  SET status = 'sent',
      message_sid = p_message_sid,
      sms_body = p_body,
      metadata = v_row.metadata || jsonb_build_object(
        'twilio_send_attempted', true,
        'note', 'scheduled_daily_sent',
        'sent_at', to_jsonb(clock_timestamp()),
        'final_body_sent', p_body
      )
  WHERE id = p_event_id
    AND metadata->>'reservation_owner_id' = p_reservation_owner_id::text;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'lost'::text, 'not_finalized'::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'sent'::text, 'accepted'::text;
END;
$$;

CREATE FUNCTION public.tto_release_proven_pre_provider(
  p_event_id uuid,
  p_reservation_owner_id uuid,
  p_clerk_user_id text,
  p_reason text
)
RETURNS TABLE (outcome text, reason text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row public.sms_send_events%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN (
    'account_deletion', 'deletion_lookup_failed', 'twilio_not_configured', 'missing_clerk_user_id', 'draft_changed', 'grace', 'member_local_date_rolled', 'execution_expired'
  ) THEN
    RETURN QUERY SELECT 'refused'::text, 'reason_not_proven'::text;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock_shared(
    hashtext('sms_account_deletion_member'),
    hashtext(p_clerk_user_id)
  );
  IF public.sms_account_deletion_member_blocked(p_clerk_user_id) THEN
    RETURN QUERY SELECT 'lost'::text, 'account_deletion'::text;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_clerk_user_id), hashtext('scheduled-daily-member'));
  SELECT * INTO v_row FROM public.sms_send_events WHERE id = p_event_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.clerk_user_id IS DISTINCT FROM p_clerk_user_id THEN
    RETURN QUERY SELECT 'lost'::text, 'missing'::text;
    RETURN;
  END IF;
  IF v_row.metadata->>'reservation_owner_id' IS DISTINCT FROM p_reservation_owner_id::text THEN
    RETURN QUERY SELECT 'lost'::text, 'other_owner'::text;
    RETURN;
  END IF;
  IF nullif(btrim(coalesce(v_row.message_sid, '')), '') IS NOT NULL OR v_row.status = 'sent' THEN
    RETURN QUERY SELECT 'uncertain'::text, 'provider_boundary_held'::text;
    RETURN;
  END IF;
  UPDATE public.sms_send_events
  SET status = 'send_failed',
      metadata = v_row.metadata || jsonb_build_object(
        'twilio_send_attempted', false,
        'note', 'proven_pre_provider_failure',
        'abort_reason', p_reason
      )
  WHERE id = p_event_id
    AND message_sid IS NULL
    AND status IS DISTINCT FROM 'sent';
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'uncertain'::text, 'provider_boundary_held'::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'aborted'::text, 'pre_provider'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.tto_reserve_scheduled_daily_delivery(
  text, text, text, text, uuid, uuid, text, timestamptz, text, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tto_begin_scheduled_daily_provider_attempt(
  uuid, uuid, uuid, text, timestamptz, text, text, text, text, text, timestamptz, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tto_abort_scheduled_daily_reservation(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tto_finalize_scheduled_daily_acceptance(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tto_release_proven_pre_provider(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.tto_reserve_scheduled_daily_delivery(
  text, text, text, text, uuid, uuid, text, timestamptz, text, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.tto_begin_scheduled_daily_provider_attempt(
  uuid, uuid, uuid, text, timestamptz, text, text, text, text, text, timestamptz, text, text, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.tto_abort_scheduled_daily_reservation(uuid, uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.tto_finalize_scheduled_daily_acceptance(uuid, uuid, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.tto_release_proven_pre_provider(uuid, uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.purge_app_data_for_account_deletion(p_request_id uuid, p_clerk_user_id text, p_expected_orchestration_version integer, p_lock_owner text, p_lease_ms integer DEFAULT 120000)
 RETURNS TABLE(outcome text, counts jsonb, limitations jsonb)
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path = public
AS $purge_app_data$
DECLARE
  v_clerk TEXT := trim(coalesce(p_clerk_user_id, ''));
  v_owner TEXT := trim(coalesce(p_lock_owner, ''));
  v_lease_ms INTEGER := coalesce(p_lease_ms, 120000);
  v_req public.account_deletion_requests%ROWTYPE;
  v_counts JSONB := '{}'::jsonb;
  v_limitations JSONB := '[]'::jsonb;
  v_n BIGINT := 0;
  v_total BIGINT := 0;
  v_batch public.sms_tto_generation_batches%ROWTYPE;
  v_kept jsonb;
  v_occ_removed bigint := 0;
  v_non_removed bigint := 0;
BEGIN
  -- Single-user purge bound; fail whole function on error (implicit txn).
  PERFORM set_config('statement_timeout', '120000', true);

  IF p_request_id IS NULL
     OR length(v_clerk) = 0
     OR length(v_owner) = 0
     OR p_expected_orchestration_version IS NULL THEN
    outcome := 'conflict';
    counts := '{}'::jsonb;
    limitations := '[]'::jsonb;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Structurally plausible Clerk user id (user_…).
  IF v_clerk !~ '^user_[A-Za-z0-9_-]+$' OR length(v_clerk) < 8 OR length(v_clerk) > 128 THEN
    outcome := 'conflict';
    counts := '{}'::jsonb;
    limitations := '[]'::jsonb;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_lease_ms < 1000 OR v_lease_ms > 3600000 THEN
    outcome := 'conflict';
    counts := '{}'::jsonb;
    limitations := '[]'::jsonb;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Exclusive member fence before any row lock, including the deletion request.
  PERFORM pg_advisory_xact_lock(
    hashtext('sms_account_deletion_member'),
    hashtext(v_clerk)
  );

  SELECT * INTO v_req
  FROM public.account_deletion_requests AS r
  WHERE r.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    outcome := 'conflict';
    counts := '{}'::jsonb;
    limitations := '[]'::jsonb;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_req.clerk_user_id IS DISTINCT FROM v_clerk
     OR v_req.status IS DISTINCT FROM 'purging_app_data'
     OR v_req.current_step IS DISTINCT FROM 'purging_app_data'
     OR v_req.orchestration_version IS DISTINCT FROM p_expected_orchestration_version
     OR v_req.lock_owner IS DISTINCT FROM v_owner
     OR v_req.locked_at IS NULL
     OR v_req.locked_at < (now() - (v_lease_ms::double precision * INTERVAL '1 millisecond'))
     OR v_req.status IN ('completed', 'failed_terminal') THEN
    outcome := 'conflict';
    counts := '{}'::jsonb;
    limitations := '[]'::jsonb;
    RETURN NEXT;
    RETURN;
  END IF;

  -- =========================================================================
  -- 2–5. SMS binding / jobs / context / ledgers
  -- =========================================================================
  DELETE FROM public.sms_identities WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('sms_identities', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.sms_audience WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('sms_audience', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.sms_inbound_coach_jobs WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('sms_inbound_coach_jobs', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.sms_last_outbound_context WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('sms_last_outbound_context', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.sms_delivery_state WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('sms_delivery_state', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.sms_send_events WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('sms_send_events', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.sms_weekly_send_events WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('sms_weekly_send_events', v_n);
  v_total := v_total + v_n;

  IF to_regclass('public.sms_audience_pref_backup') IS NOT NULL THEN
    DELETE FROM public.sms_audience_pref_backup WHERE clerk_user_id = v_clerk;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('sms_audience_pref_backup', v_n);
    v_total := v_total + v_n;
  END IF;

  DELETE FROM public.sms_daily_drafts WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('sms_daily_drafts', v_n);
  v_total := v_total + v_n;

  UPDATE public.sms_daily_draft_generations
  SET superseded_by_generation_id = NULL
  WHERE clerk_user_id = v_clerk
    AND superseded_by_generation_id IS NOT NULL;

  DELETE FROM public.sms_daily_draft_generations WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('sms_daily_draft_generations', v_n);
  v_total := v_total + v_n;

  INSERT INTO public.sms_opt_out_tombstones (
    message_sid,
    received_at,
    opt_out_command_token
  )
  SELECT
    m.message_sid,
    coalesce(m.received_at, now()),
    lower(trim(regexp_replace(coalesce(m.raw_body, ''), '\s+', ' ', 'g')))
  FROM public.sms_inbound_messages AS m
  WHERE m.clerk_user_id = v_clerk
    AND m.message_sid IS NOT NULL
    AND length(trim(m.message_sid)) > 0
    AND lower(trim(regexp_replace(coalesce(m.raw_body, ''), '\s+', ' ', 'g')))
        IN ('stop', 'unsubscribe', 'cancel', 'end')
  ON CONFLICT (message_sid) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('sms_opt_out_tombstones_inserted', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.sms_inbound_messages WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('sms_inbound_messages', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.journal_entries WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('journal_entries', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.daily_summaries WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('daily_summaries', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.weekly_summaries WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('weekly_summaries', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.recent_summary WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('recent_summary', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.pattern_insights WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('pattern_insights', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.ask_pat_questions WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('ask_pat_questions', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.ask_pat_usage WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('ask_pat_usage', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.coach_conversations WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('coach_conversations', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.coach_pat_daily_notes WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('coach_pat_daily_notes', v_n);
  v_total := v_total + v_n;

  IF to_regclass('public.coach_pat_daily_usage') IS NOT NULL THEN
    DELETE FROM public.coach_pat_daily_usage WHERE clerk_user_id = v_clerk;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('coach_pat_daily_usage', v_n);
    v_total := v_total + v_n;
  END IF;

  DELETE FROM public.coach_reply_usage WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('coach_reply_usage', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.daily_prompt_versions WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('daily_prompt_versions', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.daily_prompts WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('daily_prompts', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.weekly_sms_reflections WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('weekly_sms_reflections', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.daily_completion_events WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('daily_completion_events', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.feedback_events WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('feedback_events', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.winback_queue WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('winback_queue', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.retention_signals WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('retention_signals', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.achievements_unlocked WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('achievements_unlocked', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.v2_sms_meaning_interpretation_shadow WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('v2_sms_meaning_interpretation_shadow', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.v2_sms_pattern_correction
  WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('v2_sms_pattern_correction', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.v2_inbound_media_job WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('v2_inbound_media_job', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.v2_win_media WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('v2_win_media', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.v2_durable_user_evidence
  WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('durable_user_evidence', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.meta_capi_web_identifiers WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('meta_capi_web_identifiers', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.v2_coach_relationship_memory
  WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('coach_relationship_memory', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.learning_reflection_answers
  WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('learning_reflection_answers', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.learning_mini_program_progress
  WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('learning_mini_program_progress', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.v2_win WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('v2_win', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.v2_user_sms_comms_preferences WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('v2_user_sms_comms_preferences', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.v2_user_send_time_profile WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('v2_user_send_time_profile', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.v2_user_rollout WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('v2_user_rollout', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.v2_event WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('v2_event', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.goal_coherence_log WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('goal_coherence_log', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.v2_victory_season_summary_snapshot WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('v2_victory_season_summary_snapshot', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.v2_victory_pat_read_snapshot WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('v2_victory_pat_read_snapshot', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.v2_victory_pat_principles_snapshot WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('v2_victory_pat_principles_snapshot', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.user_accountability_season WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('user_accountability_season', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.v2_check_sent_outbound_intent_snapshot WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('v2_check_sent_outbound_intent_snapshot', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.v2_refresh_outbound_intent_snapshot WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('v2_refresh_outbound_intent_snapshot', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.v2_commitment_sms_thread_memory WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('v2_commitment_sms_thread_memory', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.v2_commitment_coaching_memory WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('v2_commitment_coaching_memory', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.v2_commitment_event WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('v2_commitment_event', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.v2_commitment_evolution_recommendation WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('v2_commitment_evolution_recommendation', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.v2_commitment_intake WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('v2_commitment_intake', v_n);
  v_total := v_total + v_n;

  UPDATE public.v2_commitment
  SET supersedes_commitment_id = NULL
  WHERE clerk_user_id = v_clerk
    AND supersedes_commitment_id IS NOT NULL;

  DELETE FROM public.v2_commitment WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('v2_commitment', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.important_people WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('important_people', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.user_profiles WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('user_profiles', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.user_identity_version WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('user_identity_version', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.testimonials WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('testimonials', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.admin_customer_relationship_notes WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('admin_customer_relationship_notes', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.coach_shipping_addresses WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('coach_shipping_addresses', v_n);
  v_total := v_total + v_n;

  IF to_regclass('public.quotes_book_fulfillment_reminders') IS NOT NULL THEN
    DELETE FROM public.quotes_book_fulfillment_reminders WHERE clerk_user_id = v_clerk;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('quotes_book_fulfillment_reminders', v_n);
    v_total := v_total + v_n;
  END IF;

  DELETE FROM public.challenge_participants
  WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('challenge_rows_deleted', v_n);
  v_total := v_total + v_n;

  -- Remove this member from batch JSON. Do not delete the batch or rewrite its clock.
  v_occ_removed := 0;
  v_non_removed := 0;
  FOR v_batch IN
    SELECT b.*
    FROM public.sms_tto_generation_batches b
    WHERE EXISTS (
      SELECT 1
      FROM jsonb_array_elements(coalesce(b.occurrences, '[]'::jsonb)) AS element
      WHERE element->>'clerk_user_id' = v_clerk
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(coalesce(b.non_scheduled, '[]'::jsonb)) AS element
      WHERE element->>'clerk_user_id' = v_clerk
    )
    ORDER BY b.id
    FOR UPDATE
  LOOP
    SELECT coalesce(jsonb_agg(element.value ORDER BY element.ordinality), '[]'::jsonb)
      INTO v_kept
    FROM jsonb_array_elements(coalesce(v_batch.occurrences, '[]'::jsonb))
      WITH ORDINALITY AS element(value, ordinality)
    WHERE element.value->>'clerk_user_id' IS DISTINCT FROM v_clerk;
    v_occ_removed := v_occ_removed
      + jsonb_array_length(coalesce(v_batch.occurrences, '[]'::jsonb))
      - jsonb_array_length(v_kept);

    UPDATE public.sms_tto_generation_batches
    SET occurrences = v_kept
    WHERE id = v_batch.id;

    SELECT coalesce(jsonb_agg(element.value ORDER BY element.ordinality), '[]'::jsonb)
      INTO v_kept
    FROM jsonb_array_elements(coalesce(v_batch.non_scheduled, '[]'::jsonb))
      WITH ORDINALITY AS element(value, ordinality)
    WHERE element.value->>'clerk_user_id' IS DISTINCT FROM v_clerk;
    v_non_removed := v_non_removed
      + jsonb_array_length(coalesce(v_batch.non_scheduled, '[]'::jsonb))
      - jsonb_array_length(v_kept);

    UPDATE public.sms_tto_generation_batches
    SET non_scheduled = v_kept,
        updated_at = clock_timestamp()
    WHERE id = v_batch.id;
  END LOOP;

  v_counts := v_counts || jsonb_build_object(
    'sms_tto_generation_batch_occurrences_removed', v_occ_removed,
    'sms_tto_generation_batch_non_scheduled_removed', v_non_removed
  );
  v_total := v_total + v_occ_removed + v_non_removed;

  IF jsonb_array_length(v_limitations) > 0 THEN
    outcome := 'incomplete';
  ELSIF v_total = 0 THEN
    outcome := 'already_absent';
  ELSE
    outcome := 'purged';
  END IF;

  counts := v_counts;
  limitations := v_limitations;
  RETURN NEXT;
END;
$purge_app_data$;


-- ---------------------------------------------------------------------------
-- Direct generation insert used by Morning and Evening persistence.
-- The deletion fence and the insert commit together. The model call is not
-- inside this transaction.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.tto_insert_generation_row(p_row jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_clerk text := btrim(coalesce(p_row->>'clerk_user_id', ''));
  v_id uuid;
  v_row public.sms_daily_draft_generations%ROWTYPE;
BEGIN
  IF v_clerk = '' THEN
    RAISE EXCEPTION 'missing_clerk_user_id';
  END IF;
  PERFORM pg_advisory_xact_lock_shared(
    hashtext('sms_account_deletion_member'),
    hashtext(v_clerk)
  );
  IF public.sms_account_deletion_member_blocked(v_clerk) THEN
    RAISE EXCEPTION 'account_deletion' USING ERRCODE = 'P0001';
  END IF;
  v_row := jsonb_populate_record(NULL::public.sms_daily_draft_generations, p_row);
  INSERT INTO public.sms_daily_draft_generations (
    clerk_user_id,
    draft_for_day_key,
    send_slot,
    generation_number,
    generation_reason,
    commitment_id,
    machine_draft_body,
    machine_should_send,
    machine_no_send_reason,
    writer_openai_messages,
    writer_prompt_path,
    writer_notebook_snapshot,
    notebook_hash,
    notebook_verdict,
    notebook_verdict_reason,
    notebook_source_candidate_count,
    notebook_exact_source_message_count,
    notebook_thread_message_count,
    notebook_filtered_out_reason_top,
    route_kind,
    generation_metadata,
    timezone_snapshot,
    send_pref_snapshot,
    machine_body_hash,
    last_inbound_at_at_generation,
    last_outbound_at_at_generation
  ) VALUES (
    v_row.clerk_user_id,
    v_row.draft_for_day_key,
    v_row.send_slot,
    v_row.generation_number,
    v_row.generation_reason,
    v_row.commitment_id,
    v_row.machine_draft_body,
    coalesce(v_row.machine_should_send, false),
    v_row.machine_no_send_reason,
    coalesce(v_row.writer_openai_messages, '[]'::jsonb),
    v_row.writer_prompt_path,
    v_row.writer_notebook_snapshot,
    v_row.notebook_hash,
    v_row.notebook_verdict,
    v_row.notebook_verdict_reason,
    v_row.notebook_source_candidate_count,
    v_row.notebook_exact_source_message_count,
    v_row.notebook_thread_message_count,
    v_row.notebook_filtered_out_reason_top,
    v_row.route_kind,
    v_row.generation_metadata,
    v_row.timezone_snapshot,
    v_row.send_pref_snapshot,
    v_row.machine_body_hash,
    v_row.last_inbound_at_at_generation,
    v_row.last_outbound_at_at_generation
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Account schedule, pause, and START preference clears.
-- Partial: a key absent from p_patch is left unchanged.
-- JSON null becomes SQL NULL. A deleted member is not inserted.

CREATE FUNCTION public.v2_upsert_sms_comms_preferences(
  p_clerk_user_id text,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_clerk text := btrim(coalesce(p_clerk_user_id, ''));
  v_row jsonb;
BEGIN
  IF v_clerk = '' THEN
    RAISE EXCEPTION 'missing_clerk_user_id';
  END IF;
  PERFORM pg_advisory_xact_lock_shared(
    hashtext('sms_account_deletion_member'),
    hashtext(v_clerk)
  );
  IF public.sms_account_deletion_member_blocked(v_clerk) THEN
    RAISE EXCEPTION 'account_deletion' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.v2_user_sms_comms_preferences (clerk_user_id)
  VALUES (v_clerk)
  ON CONFLICT (clerk_user_id) DO NOTHING;

  UPDATE public.v2_user_sms_comms_preferences
  SET
    pause_until = CASE
      WHEN p_patch ? 'pause_until' THEN NULLIF(p_patch->>'pause_until', '')::timestamptz
      ELSE pause_until
    END,
    pause_reason_category = CASE
      WHEN p_patch ? 'pause_reason_category' THEN NULLIF(p_patch->>'pause_reason_category', '')
      ELSE pause_reason_category
    END,
    cadence_override = CASE
      WHEN p_patch ? 'cadence_override' THEN NULLIF(p_patch->>'cadence_override', '')
      ELSE cadence_override
    END,
    weekend_send_policy = CASE
      WHEN p_patch ? 'weekend_send_policy' THEN NULLIF(p_patch->>'weekend_send_policy', '')
      ELSE weekend_send_policy
    END,
    preferred_send_window = CASE
      WHEN p_patch ? 'preferred_send_window' THEN NULLIF(p_patch->>'preferred_send_window', '')
      ELSE preferred_send_window
    END,
    preferred_local_hour = CASE
      WHEN p_patch ? 'preferred_local_hour' THEN NULLIF(p_patch->>'preferred_local_hour', '')::smallint
      ELSE preferred_local_hour
    END,
    source_message_sid = CASE
      WHEN p_patch ? 'source_message_sid' THEN NULLIF(p_patch->>'source_message_sid', '')
      ELSE source_message_sid
    END,
    resume_prompt_sent_at = CASE
      WHEN p_patch ? 'resume_prompt_sent_at' THEN NULLIF(p_patch->>'resume_prompt_sent_at', '')::timestamptz
      ELSE resume_prompt_sent_at
    END,
    weekly_schedule = CASE
      WHEN NOT (p_patch ? 'weekly_schedule') THEN weekly_schedule
      WHEN jsonb_typeof(p_patch->'weekly_schedule') = 'null' THEN NULL
      ELSE p_patch->'weekly_schedule'
    END,
    schedule_timezone = CASE
      WHEN p_patch ? 'schedule_timezone' THEN NULLIF(p_patch->>'schedule_timezone', '')
      ELSE schedule_timezone
    END,
    pause_indefinite = CASE
      WHEN NOT (p_patch ? 'pause_indefinite') THEN pause_indefinite
      ELSE coalesce((p_patch->>'pause_indefinite')::boolean, false)
    END
  WHERE clerk_user_id = v_clerk;

  SELECT to_jsonb(prefs) INTO v_row
  FROM public.v2_user_sms_comms_preferences AS prefs
  WHERE prefs.clerk_user_id = v_clerk;
  RETURN v_row;
END;
$$;


REVOKE ALL ON FUNCTION public.tto_insert_generation_row(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.v2_upsert_sms_comms_preferences(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tto_insert_generation_row(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.v2_upsert_sms_comms_preferences(text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.purge_app_data_for_account_deletion(uuid, text, integer, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_app_data_for_account_deletion(uuid, text, integer, text, integer) TO service_role;

-- Scheduled post-send bookkeeping.
-- One transaction: shared member lock, deletion check, then the writes.
-- The lock releases on commit. Do not call this around Twilio or OpenAI.
-- Legacy check_sent and refresh functions stay available to their existing callers.
-- A scheduled replay calls those functions only after the fence passes.

CREATE FUNCTION public.tto_record_scheduled_post_send_bookkeeping(
  p_clerk_user_id text,
  p_commitment_id uuid,
  p_day_key text DEFAULT NULL,
  p_send_slot text DEFAULT NULL,
  p_message_sid text DEFAULT NULL,
  p_body_preview text DEFAULT NULL,
  p_sent_at timestamptz DEFAULT NULL,
  p_record_check_sent boolean DEFAULT false,
  p_thread_memory jsonb DEFAULT NULL,
  p_replay jsonb DEFAULT NULL
)
RETURNS TABLE (
  outcome text,
  reason text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_clerk text := btrim(coalesce(p_clerk_user_id, ''));
  v_owner text;
  v_key text;
  v_legacy text;
  v_exists boolean;
  v_check_error text;
  v_check_status text;
  v_thread_error text;
  v_op jsonb;
  v_patch jsonb;
  v_row jsonb;
  v_inner text;
  v_updated timestamptz;
BEGIN
  IF v_clerk = '' OR p_commitment_id IS NULL THEN
    RETURN QUERY SELECT 'invalid'::text, 'missing_required_fields'::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtext('sms_account_deletion_member'),
    hashtext(v_clerk)
  );
  IF public.sms_account_deletion_member_blocked(v_clerk) THEN
    RETURN QUERY SELECT 'account_deletion'::text, 'account_deletion'::text;
    RETURN;
  END IF;

  IF p_replay IS NOT NULL AND jsonb_typeof(p_replay) = 'object' THEN
    IF p_replay->>'kind' = 'check_sent' THEN
      SELECT m.result
        INTO v_inner
      FROM public.v2_apply_check_sent_post_send_bookkeeping_mutation(
        p_commitment_id,
        v_clerk,
        p_replay->>'day_key',
        p_replay->>'message_sid',
        (p_replay->>'template_id')::integer,
        p_replay->>'template_family',
        p_replay->>'body_preview',
        p_replay->>'effective_ask_text',
        p_replay->>'prompt_kind',
        p_replay->>'expected_reply_semantics',
        coalesce(p_replay->'check_payload_json', '{}'::jsonb),
        coalesce(NULLIF(p_replay->>'now', '')::timestamptz, clock_timestamp()),
        coalesce((p_replay->>'include_contract_overlay_proposal')::boolean, false),
        NULLIF(p_replay->>'proposal_text', ''),
        NULLIF(p_replay->>'contract_kind', '')
      ) AS m;
      RETURN QUERY SELECT coalesce(v_inner, 'error')::text, NULL::text;
      RETURN;
    END IF;

    IF p_replay->>'kind' = 'refresh' THEN
      SELECT m.result, m.updated_at
        INTO v_inner, v_updated
      FROM public.v2_apply_refresh_prompted_post_send_bookkeeping_mutation(
        p_commitment_id,
        v_clerk,
        p_replay->>'message_sid',
        p_replay->>'prompt_step',
        p_replay->>'prompt_kind',
        p_replay->>'body_preview',
        coalesce(p_replay->'next_refresh_session', '{}'::jsonb),
        NULLIF(p_replay->>'expected_session_id', ''),
        NULLIF(p_replay->>'expected_updated_at', '')::timestamptz,
        coalesce(NULLIF(p_replay->>'now', '')::timestamptz, clock_timestamp())
      ) AS m;
      RETURN QUERY SELECT coalesce(v_inner, 'error')::text, v_updated::text;
      RETURN;
    END IF;

    RETURN QUERY SELECT 'invalid'::text, 'unknown_replay'::text;
    RETURN;
  END IF;

  SELECT c.clerk_user_id
    INTO v_owner
  FROM public.v2_commitment AS c
  WHERE c.id = p_commitment_id;
  IF v_owner IS DISTINCT FROM v_clerk THEN
    RETURN QUERY SELECT 'commitment_absent'::text, 'commitment_absent'::text;
    RETURN;
  END IF;

  IF p_thread_memory IS NOT NULL AND jsonb_typeof(p_thread_memory->'ops') = 'array' THEN
    FOR v_op IN
      SELECT value FROM jsonb_array_elements(p_thread_memory->'ops')
    LOOP
      BEGIN
        IF v_op->>'op' = 'update' THEN
          v_patch := coalesce(v_op->'patch', '{}'::jsonb);
          UPDATE public.v2_commitment_sms_thread_memory
          SET
            last_outbound_full_body = CASE
              WHEN NOT (v_patch ? 'last_outbound_full_body') THEN last_outbound_full_body
              WHEN jsonb_typeof(v_patch->'last_outbound_full_body') = 'null' THEN NULL
              ELSE v_patch->>'last_outbound_full_body'
            END,
            last_outbound_sent_at = CASE
              WHEN NOT (v_patch ? 'last_outbound_sent_at') THEN last_outbound_sent_at
              WHEN jsonb_typeof(v_patch->'last_outbound_sent_at') = 'null' THEN NULL
              ELSE NULLIF(v_patch->>'last_outbound_sent_at', '')::timestamptz
            END,
            last_outbound_source = CASE
              WHEN NOT (v_patch ? 'last_outbound_source') THEN last_outbound_source
              WHEN jsonb_typeof(v_patch->'last_outbound_source') = 'null' THEN NULL
              ELSE v_patch->>'last_outbound_source'
            END,
            last_outbound_message_sid = CASE
              WHEN NOT (v_patch ? 'last_outbound_message_sid') THEN last_outbound_message_sid
              WHEN jsonb_typeof(v_patch->'last_outbound_message_sid') = 'null' THEN NULL
              ELSE v_patch->>'last_outbound_message_sid'
            END,
            updated_at = CASE
              WHEN NOT (v_patch ? 'updated_at') THEN updated_at
              ELSE coalesce(NULLIF(v_patch->>'updated_at', '')::timestamptz, clock_timestamp())
            END,
            last_5_coach_questions = CASE
              WHEN NOT (v_patch ? 'last_5_coach_questions') THEN last_5_coach_questions
              WHEN jsonb_typeof(v_patch->'last_5_coach_questions') = 'array' THEN v_patch->'last_5_coach_questions'
              ELSE last_5_coach_questions
            END,
            do_not_repeat_phrases = CASE
              WHEN NOT (v_patch ? 'do_not_repeat_phrases') THEN do_not_repeat_phrases
              WHEN jsonb_typeof(v_patch->'do_not_repeat_phrases') = 'array' THEN v_patch->'do_not_repeat_phrases'
              ELSE do_not_repeat_phrases
            END,
            open_question_text = CASE
              WHEN NOT (v_patch ? 'open_question_text') THEN open_question_text
              WHEN jsonb_typeof(v_patch->'open_question_text') = 'null' THEN NULL
              ELSE v_patch->>'open_question_text'
            END,
            open_question_pending = CASE
              WHEN NOT (v_patch ? 'open_question_pending') THEN open_question_pending
              ELSE coalesce((v_patch->>'open_question_pending')::boolean, false)
            END,
            open_question_asked_at = CASE
              WHEN NOT (v_patch ? 'open_question_asked_at') THEN open_question_asked_at
              WHEN jsonb_typeof(v_patch->'open_question_asked_at') = 'null' THEN NULL
              ELSE NULLIF(v_patch->>'open_question_asked_at', '')::timestamptz
            END,
            open_question_source_message_sid = CASE
              WHEN NOT (v_patch ? 'open_question_source_message_sid') THEN open_question_source_message_sid
              WHEN jsonb_typeof(v_patch->'open_question_source_message_sid') = 'null' THEN NULL
              ELSE v_patch->>'open_question_source_message_sid'
            END,
            open_question_expected_answer_type = CASE
              WHEN NOT (v_patch ? 'open_question_expected_answer_type') THEN open_question_expected_answer_type
              WHEN jsonb_typeof(v_patch->'open_question_expected_answer_type') = 'null' THEN NULL
              ELSE v_patch->>'open_question_expected_answer_type'
            END,
            open_question_answer_text = CASE
              WHEN NOT (v_patch ? 'open_question_answer_text') THEN open_question_answer_text
              WHEN jsonb_typeof(v_patch->'open_question_answer_text') = 'null' THEN NULL
              ELSE v_patch->>'open_question_answer_text'
            END,
            open_question_answered_at = CASE
              WHEN NOT (v_patch ? 'open_question_answered_at') THEN open_question_answered_at
              WHEN jsonb_typeof(v_patch->'open_question_answered_at') = 'null' THEN NULL
              ELSE NULLIF(v_patch->>'open_question_answered_at', '')::timestamptz
            END
          WHERE commitment_id = p_commitment_id
            AND clerk_user_id = v_clerk
            AND (
              v_op->'cas' IS NULL
              OR jsonb_typeof(v_op->'cas') = 'null'
              OR (
                open_question_pending = true
                AND open_question_text = v_op->'cas'->>'text'
                AND open_question_asked_at = NULLIF(v_op->'cas'->>'asked_at', '')::timestamptz
              )
            );
        ELSIF v_op->>'op' = 'insert' THEN
          v_row := coalesce(v_op->'row', '{}'::jsonb);
          INSERT INTO public.v2_commitment_sms_thread_memory (
            commitment_id,
            clerk_user_id,
            projection_version,
            last_outbound_full_body,
            last_outbound_sent_at,
            last_outbound_source,
            last_outbound_message_sid,
            last_inbound_full_body,
            last_inbound_at,
            last_inbound_message_sid,
            last_5_coach_questions,
            last_5_user_answers,
            open_question_text,
            open_question_asked_at,
            open_question_expected_answer_type,
            open_question_source_message_sid,
            open_question_answer_text,
            open_question_answered_at,
            open_question_pending,
            do_not_repeat_phrases,
            recent_frustration_corrections,
            current_live_thread_summary,
            last_recomputed_from_spine_at,
            created_at,
            updated_at
          ) VALUES (
            p_commitment_id,
            v_clerk,
            coalesce(NULLIF(v_row->>'projection_version', '')::integer, 1),
            v_row->>'last_outbound_full_body',
            NULLIF(v_row->>'last_outbound_sent_at', '')::timestamptz,
            v_row->>'last_outbound_source',
            NULLIF(v_row->>'last_outbound_message_sid', ''),
            NULLIF(v_row->>'last_inbound_full_body', ''),
            NULLIF(v_row->>'last_inbound_at', '')::timestamptz,
            NULLIF(v_row->>'last_inbound_message_sid', ''),
            CASE
              WHEN jsonb_typeof(v_row->'last_5_coach_questions') = 'array' THEN v_row->'last_5_coach_questions'
              ELSE '[]'::jsonb
            END,
            CASE
              WHEN jsonb_typeof(v_row->'last_5_user_answers') = 'array' THEN v_row->'last_5_user_answers'
              ELSE '[]'::jsonb
            END,
            NULLIF(v_row->>'open_question_text', ''),
            NULLIF(v_row->>'open_question_asked_at', '')::timestamptz,
            NULLIF(v_row->>'open_question_expected_answer_type', ''),
            NULLIF(v_row->>'open_question_source_message_sid', ''),
            NULLIF(v_row->>'open_question_answer_text', ''),
            NULLIF(v_row->>'open_question_answered_at', '')::timestamptz,
            coalesce((v_row->>'open_question_pending')::boolean, false),
            CASE
              WHEN jsonb_typeof(v_row->'do_not_repeat_phrases') = 'array' THEN v_row->'do_not_repeat_phrases'
              ELSE '[]'::jsonb
            END,
            CASE
              WHEN jsonb_typeof(v_row->'recent_frustration_corrections') = 'array' THEN v_row->'recent_frustration_corrections'
              ELSE '[]'::jsonb
            END,
            NULLIF(v_row->>'current_live_thread_summary', ''),
            NULLIF(v_row->>'last_recomputed_from_spine_at', '')::timestamptz,
            coalesce(NULLIF(v_row->>'created_at', '')::timestamptz, clock_timestamp()),
            coalesce(NULLIF(v_row->>'updated_at', '')::timestamptz, coalesce(p_sent_at, clock_timestamp()))
          );
        END IF;
      EXCEPTION WHEN others THEN
        IF v_thread_error IS NULL THEN
          v_thread_error := SQLERRM;
        END IF;
      END;
    END LOOP;
  END IF;

  IF coalesce(p_record_check_sent, false) THEN
    BEGIN
      IF p_send_slot IS DISTINCT FROM 'morning' AND p_send_slot IS DISTINCT FROM 'evening_checkin' THEN
        v_check_error := 'bad_slot';
      ELSIF btrim(coalesce(p_day_key, '')) = '' OR btrim(coalesce(p_message_sid, '')) = '' THEN
        v_check_error := 'missing_check_sent_fields';
      ELSE
        v_key := 'v2_check_sent:' || p_commitment_id::text || ':' || btrim(p_day_key) || ':' || p_send_slot;
        v_legacy := 'v2_check_sent:' || p_commitment_id::text || ':' || btrim(p_day_key);
        SELECT EXISTS (
          SELECT 1
          FROM public.v2_commitment_event
          WHERE idempotency_key = v_key
            AND event_type = 'check_sent'
        ) INTO v_exists;
        IF NOT v_exists AND p_send_slot = 'morning' THEN
          SELECT EXISTS (
            SELECT 1
            FROM public.v2_commitment_event
            WHERE idempotency_key = v_legacy
              AND event_type = 'check_sent'
          ) INTO v_exists;
        END IF;
        IF v_exists THEN
          v_check_status := 'already';
        ELSE
          INSERT INTO public.v2_commitment_event (
            commitment_id,
            clerk_user_id,
            event_type,
            occurred_at,
            source,
            payload_json,
            idempotency_key
          ) VALUES (
            p_commitment_id,
            v_clerk,
            'check_sent',
            coalesce(p_sent_at, clock_timestamp()),
            'sms_v2_accountability',
            jsonb_build_object(
              'day_key', btrim(p_day_key),
              'send_slot', p_send_slot,
              'template_id', 0,
              'template_family', 'standard',
              'channel', 'sms',
              'message_sid', btrim(p_message_sid),
              'body_preview', left(coalesce(p_body_preview, ''), 240)
            ),
            v_key
          );
          v_check_status := 'inserted';
        END IF;
      END IF;
    EXCEPTION
      WHEN unique_violation THEN
        v_check_status := 'already';
      WHEN others THEN
        v_check_error := SQLERRM;
    END;
  END IF;

  IF v_check_error IS NOT NULL THEN
    RETURN QUERY SELECT 'check_sent_failed'::text, v_check_error;
    RETURN;
  END IF;
  IF v_thread_error IS NOT NULL THEN
    RETURN QUERY SELECT 'thread_memory_failed'::text, v_thread_error;
    RETURN;
  END IF;
  IF v_check_status = 'already' THEN
    RETURN QUERY SELECT 'already_recorded'::text, NULL::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'recorded'::text, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.tto_record_scheduled_post_send_bookkeeping(
  text, uuid, text, text, text, text, timestamptz, boolean, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tto_record_scheduled_post_send_bookkeeping(
  text, uuid, text, text, text, text, timestamptz, boolean, jsonb, jsonb
) TO service_role;


COMMIT;
