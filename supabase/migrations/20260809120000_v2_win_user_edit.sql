-- Item #4: user Edit Win — user_edited_at marker + revision history + atomic edit RPC.
-- Additive. Service-role-only. Do NOT apply automatically — Tyler applies after audit.
-- No backfill. Existing Wins keep user_edited_at NULL.

-- ---------------------------------------------------------------------------
-- 1) Durable "user owns presentation" marker on v2_win
-- ---------------------------------------------------------------------------
ALTER TABLE public.v2_win
  ADD COLUMN IF NOT EXISTS user_edited_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.v2_win.user_edited_at IS
  'Set on successful user Edit Win. Once non-null, user presentation has authority over AI/reconciliation.';

-- ---------------------------------------------------------------------------
-- 2) Immutable revision history (state BEFORE each successful user edit)
-- ---------------------------------------------------------------------------
CREATE TABLE public.v2_win_revision (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  win_id UUID NOT NULL REFERENCES public.v2_win (id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  edited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  previous_display_title TEXT NOT NULL,
  previous_display_body TEXT NOT NULL,
  previous_occurred_at TIMESTAMPTZ NOT NULL,
  previous_commitment_id UUID NULL,
  previous_supporting_quote TEXT NULL,
  previous_action_fact TEXT NULL,
  previous_why_meaningful TEXT NULL,
  previous_relationship_type TEXT NULL,
  editor_source TEXT NOT NULL,
  CONSTRAINT v2_win_revision_editor_source_chk CHECK (
    editor_source IN ('user')
  ),
  CONSTRAINT v2_win_revision_title_len_chk CHECK (
    char_length(previous_display_title) > 0 AND char_length(previous_display_title) <= 80
  ),
  CONSTRAINT v2_win_revision_body_len_chk CHECK (
    char_length(previous_display_body) > 0 AND char_length(previous_display_body) <= 240
  ),
  CONSTRAINT v2_win_revision_quote_len_chk CHECK (
    previous_supporting_quote IS NULL OR char_length(previous_supporting_quote) <= 240
  ),
  CONSTRAINT v2_win_revision_action_fact_len_chk CHECK (
    previous_action_fact IS NULL OR (
      char_length(previous_action_fact) > 0 AND char_length(previous_action_fact) <= 240
    )
  ),
  CONSTRAINT v2_win_revision_why_len_chk CHECK (
    previous_why_meaningful IS NULL OR char_length(previous_why_meaningful) <= 360
  ),
  CONSTRAINT v2_win_revision_relationship_type_chk CHECK (
    previous_relationship_type IS NULL OR previous_relationship_type IN (
      'goal', 'identity', 'whole_life', 'mixed'
    )
  )
);

CREATE INDEX idx_v2_win_revision_win_edited
  ON public.v2_win_revision (win_id, edited_at DESC);

CREATE INDEX idx_v2_win_revision_clerk_edited
  ON public.v2_win_revision (clerk_user_id, edited_at DESC);

COMMENT ON TABLE public.v2_win_revision IS
  'Internal history of USER edits to v2_win. Records pre-edit presentation/membership. Soft-hide keeps rows; account purge cascades via v2_win delete.';

ALTER TABLE public.v2_win_revision ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.v2_win_revision FROM anon;
REVOKE ALL ON TABLE public.v2_win_revision FROM authenticated;
REVOKE ALL ON TABLE public.v2_win_revision FROM PUBLIC;

-- Fresh DBs may grant service_role ALL via default privileges on CREATE TABLE.
-- Strip those, then grant only what SECURITY INVOKER RPC needs.
REVOKE ALL ON TABLE public.v2_win_revision FROM service_role;
-- No UPDATE/DELETE/TRUNCATE: revisions are immutable via ordinary application paths.
-- Physical delete remains via ON DELETE CASCADE when v2_win is purged.
GRANT SELECT, INSERT ON TABLE public.v2_win_revision TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Atomic edit: revision snapshot + conditional Win update
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.v2_apply_user_win_edit_mutation(
  p_win_id UUID,
  p_clerk_user_id TEXT,
  p_expected_updated_at TIMESTAMPTZ,
  p_display_title TEXT,
  p_display_body TEXT,
  p_occurred_at TIMESTAMPTZ,
  p_commitment_id UUID,
  p_supporting_quote TEXT,
  p_action_fact TEXT,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  result TEXT,
  updated_at TIMESTAMPTZ,
  revision_id UUID
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_clerk TEXT := trim(coalesce(p_clerk_user_id, ''));
  v_title TEXT := trim(coalesce(p_display_title, ''));
  v_body TEXT := trim(coalesce(p_display_body, ''));
  v_action TEXT := trim(coalesce(p_action_fact, ''));
  v_row public.v2_win%ROWTYPE;
  v_revision_id UUID;
  v_new_updated_at TIMESTAMPTZ;
BEGIN
  IF p_win_id IS NULL OR length(v_clerk) = 0 OR p_expected_updated_at IS NULL THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;

  IF length(v_title) = 0 OR length(v_title) > 80 THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;

  IF length(v_body) = 0 OR length(v_body) > 240 THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;

  IF length(v_action) = 0 OR length(v_action) > 240 THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;

  IF p_occurred_at IS NULL THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;

  IF p_supporting_quote IS NOT NULL AND char_length(p_supporting_quote) > 240 THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;

  SELECT *
  INTO v_row
  FROM public.v2_win
  WHERE id = p_win_id
    AND clerk_user_id = v_clerk
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;

  IF v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN QUERY SELECT 'conflict'::TEXT, v_row.updated_at, NULL::UUID;
    RETURN;
  END IF;

  INSERT INTO public.v2_win_revision (
    win_id,
    clerk_user_id,
    edited_at,
    previous_display_title,
    previous_display_body,
    previous_occurred_at,
    previous_commitment_id,
    previous_supporting_quote,
    previous_action_fact,
    previous_why_meaningful,
    previous_relationship_type,
    editor_source
  )
  VALUES (
    v_row.id,
    v_row.clerk_user_id,
    p_now,
    v_row.display_title,
    v_row.display_body,
    v_row.occurred_at,
    v_row.commitment_id,
    v_row.supporting_quote,
    v_row.action_fact,
    v_row.why_meaningful,
    v_row.relationship_type,
    'user'
  )
  RETURNING id INTO v_revision_id;

  UPDATE public.v2_win
  SET
    display_title = v_title,
    display_body = v_body,
    occurred_at = p_occurred_at,
    commitment_id = p_commitment_id,
    supporting_quote = p_supporting_quote,
    action_fact = v_action,
    user_edited_at = p_now
  WHERE id = v_row.id
    AND clerk_user_id = v_clerk
    AND status = 'active'
    AND updated_at = p_expected_updated_at
  RETURNING public.v2_win.updated_at INTO v_new_updated_at;

  IF v_new_updated_at IS NULL THEN
    -- Unreachable after FOR UPDATE + expected match. RAISE so the already-inserted
    -- revision rolls back with this transaction (never leave orphan history).
    RAISE EXCEPTION 'v2_win_edit_conflict_after_revision'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT 'applied'::TEXT, v_new_updated_at, v_revision_id;
END;
$$;

COMMENT ON FUNCTION public.v2_apply_user_win_edit_mutation(
  UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT, TIMESTAMPTZ
) IS
  'Item #4: atomic user Edit Win — insert v2_win_revision (pre-edit) then conditional update of presentation/membership. Service-role only.';

REVOKE ALL ON FUNCTION public.v2_apply_user_win_edit_mutation(
  UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.v2_apply_user_win_edit_mutation(
  UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT, TIMESTAMPTZ
) FROM anon;
REVOKE ALL ON FUNCTION public.v2_apply_user_win_edit_mutation(
  UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT, TIMESTAMPTZ
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.v2_apply_user_win_edit_mutation(
  UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;
