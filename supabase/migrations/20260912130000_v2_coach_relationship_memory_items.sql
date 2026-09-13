-- ============================================================================
-- ALREADY APPLIED LIVE MANUALLY via Supabase SQL Editor on 2026-09-12.
-- IMMUTABLE HISTORICAL RECORD. DO NOT REPLAY AGAINST PRODUCTION.
--
-- Current live DB already has the item-row table and
-- public.v2_apply_coach_relationship_memory_mutations.
-- Git push / Vercel do not execute this migration.
--
-- REPLAY HAZARD: the empty-table guard below checks row COUNT, NOT table shape.
-- If the current item table is empty, replay can PASS the guard, then
-- DROP public.v2_coach_relationship_memory, then CREATE FUNCTION can collide
-- with the already-existing RPC. Empty is NOT replay-safe.
-- ============================================================================
--
-- Coach Relationship Memory (F) — item rows + atomic mutation RPC.
-- Additive conversion. Service-role-only.
--
-- Migration 1 (20260912120000) created the blob table (one row per Clerk user,
-- memory_body <= 4000) and was applied live. Live row count was verified ZERO.
-- Do not rewrite migration 1. Do not newline-split memory_body.
--
-- This migration drops the empty blob-shaped table and recreates the SAME
-- table name as one row per active standing-memory item.
--
-- Does NOT CREATE OR REPLACE public.purge_app_data_for_account_deletion.
-- Live purge DELETE ... WHERE clerk_user_id = v_clerk remains valid.
--
-- Preserves public.set_v2_coach_relationship_memory_updated_at() from
-- migration 1. Only the table trigger is recreated after DROP TABLE.

DO $guard$
DECLARE
  v_n BIGINT;
BEGIN
  SELECT COUNT(*)::bigint
  INTO v_n
  FROM public.v2_coach_relationship_memory;

  IF v_n <> 0 THEN
    RAISE EXCEPTION 'v2_coach_relationship_memory_items_refusing_nonempty_blob_table'
      USING ERRCODE = 'P0001';
  END IF;
END
$guard$;

-- Historical statement: this DROP already ran during the verified empty
-- blob-table conversion. Re-running this statement against production is an
-- operational incident.
DROP TABLE public.v2_coach_relationship_memory;

CREATE TABLE public.v2_coach_relationship_memory (
  memory_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  memory_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT v2_coach_relationship_memory_clerk_chk CHECK (
    length(trim(clerk_user_id)) > 0
  ),
  CONSTRAINT v2_coach_relationship_memory_text_chk CHECK (
    length(trim(memory_text)) > 0
    AND char_length(memory_text) <= 400
  )
);

CREATE INDEX idx_v2_coach_relationship_memory_clerk_created_id
  ON public.v2_coach_relationship_memory (clerk_user_id, created_at, memory_id);

COMMENT ON TABLE public.v2_coach_relationship_memory IS
  'Standing Coach–member relationship meaning. One row per active item. Sol owns English meaning; server owns IDs, ownership, lengths, counts, and atomic apply. Not identity, Current Goal, durable evidence, Wins, or event archive.';

ALTER TABLE public.v2_coach_relationship_memory ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.v2_coach_relationship_memory FROM PUBLIC;
REVOKE ALL ON TABLE public.v2_coach_relationship_memory FROM anon;
REVOKE ALL ON TABLE public.v2_coach_relationship_memory FROM authenticated;

GRANT ALL PRIVILEGES
ON TABLE public.v2_coach_relationship_memory
TO service_role;

GRANT SELECT
ON TABLE public.v2_coach_relationship_memory
TO readonly_user;

CREATE TRIGGER trg_v2_coach_relationship_memory_updated_at
  BEFORE UPDATE ON public.v2_coach_relationship_memory
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_v2_coach_relationship_memory_updated_at();

CREATE FUNCTION public.v2_apply_coach_relationship_memory_mutations(
  p_clerk_user_id TEXT,
  p_adds JSONB DEFAULT '[]'::jsonb,
  p_updates JSONB DEFAULT '[]'::jsonb,
  p_deletes JSONB DEFAULT '[]'::jsonb
)
RETURNS TABLE (
  result TEXT,
  item_count INTEGER,
  total_chars INTEGER,
  add_count INTEGER,
  update_count INTEGER,
  delete_count INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $crm$
DECLARE
  v_clerk TEXT := trim(coalesce(p_clerk_user_id, ''));
  v_adds JSONB;
  v_updates JSONB;
  v_deletes JSONB;
  v_add_n INTEGER;
  v_update_n INTEGER;
  v_delete_n INTEGER;
  v_elem JSONB;
  v_text TEXT;
  v_id UUID;
  v_update_ids UUID[] := ARRAY[]::uuid[];
  v_update_texts TEXT[] := ARRAY[]::text[];
  v_delete_ids UUID[] := ARRAY[]::uuid[];
  v_add_texts TEXT[] := ARRAY[]::text[];
  v_i INTEGER;
  v_item_count INTEGER;
  v_total_chars INTEGER;
BEGIN
  IF length(v_clerk) = 0 THEN
    RAISE EXCEPTION 'v2_apply_coach_relationship_memory_mutations_invalid_clerk'
      USING ERRCODE = '22023';
  END IF;

  -- Transaction-scoped per-Clerk lock. Namespace 6091213 is this RPC family only.
  -- key2 = hashtext(clerk). A hash collision only shares the lock (extra wait),
  -- never mixes rows: all DML is still filtered by clerk_user_id.
  PERFORM pg_advisory_xact_lock(6091213, hashtext(v_clerk));

  v_adds := coalesce(p_adds, '[]'::jsonb);
  IF jsonb_typeof(v_adds) = 'null' THEN
    v_adds := '[]'::jsonb;
  END IF;
  v_updates := coalesce(p_updates, '[]'::jsonb);
  IF jsonb_typeof(v_updates) = 'null' THEN
    v_updates := '[]'::jsonb;
  END IF;
  v_deletes := coalesce(p_deletes, '[]'::jsonb);
  IF jsonb_typeof(v_deletes) = 'null' THEN
    v_deletes := '[]'::jsonb;
  END IF;

  IF jsonb_typeof(v_adds) <> 'array'
     OR jsonb_typeof(v_updates) <> 'array'
     OR jsonb_typeof(v_deletes) <> 'array' THEN
    RAISE EXCEPTION 'v2_apply_coach_relationship_memory_mutations_invalid_payload'
      USING ERRCODE = '22023';
  END IF;

  v_add_n := jsonb_array_length(v_adds);
  v_update_n := jsonb_array_length(v_updates);
  v_delete_n := jsonb_array_length(v_deletes);

  IF v_add_n + v_update_n + v_delete_n > 6 THEN
    RAISE EXCEPTION 'v2_apply_coach_relationship_memory_mutations_op_cap'
      USING ERRCODE = '22023';
  END IF;

  FOR v_elem IN
    SELECT value FROM jsonb_array_elements(v_adds) AS t(value)
  LOOP
    IF jsonb_typeof(v_elem) <> 'string' THEN
      RAISE EXCEPTION 'v2_apply_coach_relationship_memory_mutations_invalid_add'
        USING ERRCODE = '22023';
    END IF;
    v_text := trim(v_elem #>> '{}');
    IF length(v_text) = 0 OR char_length(v_text) > 400 THEN
      RAISE EXCEPTION 'v2_apply_coach_relationship_memory_mutations_invalid_add'
        USING ERRCODE = '22023';
    END IF;
    v_add_texts := array_append(v_add_texts, v_text);
  END LOOP;

  FOR v_elem IN
    SELECT value FROM jsonb_array_elements(v_updates) AS t(value)
  LOOP
    IF jsonb_typeof(v_elem) <> 'object' THEN
      RAISE EXCEPTION 'v2_apply_coach_relationship_memory_mutations_invalid_update'
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_elem -> 'memory_id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_elem -> 'text') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'v2_apply_coach_relationship_memory_mutations_invalid_update'
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_id := (v_elem ->> 'memory_id')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'v2_apply_coach_relationship_memory_mutations_invalid_id'
          USING ERRCODE = '22023';
    END;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'v2_apply_coach_relationship_memory_mutations_invalid_id'
        USING ERRCODE = '22023';
    END IF;

    v_text := trim(v_elem ->> 'text');
    IF length(v_text) = 0 OR char_length(v_text) > 400 THEN
      RAISE EXCEPTION 'v2_apply_coach_relationship_memory_mutations_invalid_update'
        USING ERRCODE = '22023';
    END IF;

    IF v_id = ANY (v_update_ids) THEN
      RAISE EXCEPTION 'v2_apply_coach_relationship_memory_mutations_duplicate_id'
        USING ERRCODE = '22023';
    END IF;

    v_update_ids := array_append(v_update_ids, v_id);
    v_update_texts := array_append(v_update_texts, v_text);
  END LOOP;

  FOR v_elem IN
    SELECT value FROM jsonb_array_elements(v_deletes) AS t(value)
  LOOP
    IF jsonb_typeof(v_elem) <> 'string' THEN
      RAISE EXCEPTION 'v2_apply_coach_relationship_memory_mutations_invalid_delete'
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_id := (v_elem #>> '{}')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'v2_apply_coach_relationship_memory_mutations_invalid_id'
          USING ERRCODE = '22023';
    END;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'v2_apply_coach_relationship_memory_mutations_invalid_id'
        USING ERRCODE = '22023';
    END IF;

    IF v_id = ANY (v_delete_ids) THEN
      RAISE EXCEPTION 'v2_apply_coach_relationship_memory_mutations_duplicate_id'
        USING ERRCODE = '22023';
    END IF;
    IF v_id = ANY (v_update_ids) THEN
      RAISE EXCEPTION 'v2_apply_coach_relationship_memory_mutations_id_conflict'
        USING ERRCODE = '22023';
    END IF;

    v_delete_ids := array_append(v_delete_ids, v_id);
  END LOOP;

  FOREACH v_id IN ARRAY v_update_ids
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.v2_coach_relationship_memory
      WHERE memory_id = v_id
        AND clerk_user_id = v_clerk
    ) THEN
      RAISE EXCEPTION 'v2_apply_coach_relationship_memory_mutations_id_not_owned'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOREACH v_id IN ARRAY v_delete_ids
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.v2_coach_relationship_memory
      WHERE memory_id = v_id
        AND clerk_user_id = v_clerk
    ) THEN
      RAISE EXCEPTION 'v2_apply_coach_relationship_memory_mutations_id_not_owned'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOREACH v_id IN ARRAY v_delete_ids
  LOOP
    DELETE FROM public.v2_coach_relationship_memory
    WHERE memory_id = v_id
      AND clerk_user_id = v_clerk;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'v2_apply_coach_relationship_memory_mutations_id_not_owned'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOR v_i IN 1..coalesce(array_length(v_update_ids, 1), 0)
  LOOP
    UPDATE public.v2_coach_relationship_memory
    SET memory_text = v_update_texts[v_i]
    WHERE memory_id = v_update_ids[v_i]
      AND clerk_user_id = v_clerk;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'v2_apply_coach_relationship_memory_mutations_id_not_owned'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOR v_i IN 1..coalesce(array_length(v_add_texts, 1), 0)
  LOOP
    INSERT INTO public.v2_coach_relationship_memory (clerk_user_id, memory_text)
    VALUES (v_clerk, v_add_texts[v_i]);
  END LOOP;

  SELECT
    COUNT(*)::integer,
    coalesce(SUM(char_length(memory_text)), 0)::integer
  INTO v_item_count, v_total_chars
  FROM public.v2_coach_relationship_memory
  WHERE clerk_user_id = v_clerk;

  IF v_item_count > 40 THEN
    RAISE EXCEPTION 'v2_apply_coach_relationship_memory_mutations_item_cap'
      USING ERRCODE = '22023';
  END IF;

  IF v_total_chars > 4000 THEN
    RAISE EXCEPTION 'v2_apply_coach_relationship_memory_mutations_char_cap'
      USING ERRCODE = '22023';
  END IF;

  result := 'applied';
  item_count := v_item_count;
  total_chars := v_total_chars;
  add_count := v_add_n;
  update_count := v_update_n;
  delete_count := v_delete_n;
  RETURN NEXT;
END;
$crm$;

COMMENT ON FUNCTION public.v2_apply_coach_relationship_memory_mutations(TEXT, JSONB, JSONB, JSONB) IS
  'Atomic Coach Relationship Memory item mutations for one Clerk user. Mechanical validation only. Service-role only. RAISE rolls back the whole set.';

REVOKE ALL ON FUNCTION public.v2_apply_coach_relationship_memory_mutations(TEXT, JSONB, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.v2_apply_coach_relationship_memory_mutations(TEXT, JSONB, JSONB, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.v2_apply_coach_relationship_memory_mutations(TEXT, JSONB, JSONB, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.v2_apply_coach_relationship_memory_mutations(TEXT, JSONB, JSONB, JSONB) TO service_role;
