-- ============================================================================
-- ALREADY APPLIED LIVE MANUALLY via Supabase SQL Editor on 2026-09-12.
-- IMMUTABLE HISTORICAL RECORD. DO NOT REPLAY AGAINST PRODUCTION.
--
-- Current production DB is already on the later item-row architecture
-- (see 20260912130000_v2_coach_relationship_memory_items.sql).
-- Git push / Vercel do not execute this migration.
-- Do not treat this file as a pending migration for supabase db push / db reset
-- without first reconciling migration history against what already ran live.
-- ============================================================================
--
-- Coach Relationship Memory (F). Additive. Service-role-only.
-- One row per Clerk user. Standing generalized relationship meaning.
-- Do not put this on user_profiles (Ask Pat SELECT *).

CREATE TABLE public.v2_coach_relationship_memory (
  clerk_user_id TEXT PRIMARY KEY,
  memory_body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT v2_coach_relationship_memory_clerk_chk CHECK (
    length(trim(clerk_user_id)) > 0
  ),
  CONSTRAINT v2_coach_relationship_memory_body_len_chk CHECK (
    char_length(memory_body) > 0 AND char_length(memory_body) <= 4000
  )
);

COMMENT ON TABLE public.v2_coach_relationship_memory IS
  'Standing Coach–member relationship meaning. One row per Clerk user. Full-replacement body. Not identity, Current Goal, durable evidence, Wins, or event archive.';

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

CREATE FUNCTION public.set_v2_coach_relationship_memory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_v2_coach_relationship_memory_updated_at
  BEFORE UPDATE ON public.v2_coach_relationship_memory
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_v2_coach_relationship_memory_updated_at();

-- ---------------------------------------------------------------------------
-- Account deletion (repository contract only — do not REPLACE the live RPC here).
--
-- Git does not contain authoritative live current purge function truth.
-- Last full CREATE OR REPLACE in repo is 20260810140000_v2_win_media.sql.
-- Replacing public.purge_app_data_for_account_deletion from any historical
-- copy would clobber live purge behavior. Do not guess the full body.
--
-- Tyler: insert the snippet below into the LIVE function definition
-- (Dashboard → Database → Functions, or pg_get_functiondef), using the
-- live variable names. In every historical copy they are:
--   v_clerk TEXT, v_n BIGINT, v_counts JSONB, v_total BIGINT
--
-- Placement: V2 soft-linked / user-content section near
-- v2_durable_user_evidence, meta_capi_web_identifiers, and v2_win.
-- Preferred: immediately before `DELETE FROM public.v2_win WHERE clerk_user_id = v_clerk;`
-- (same placement convention as v2_durable_user_evidence).
--
-- Live snippet (do not execute from this migration):
--   DELETE FROM public.v2_coach_relationship_memory WHERE clerk_user_id = v_clerk;
--   GET DIAGNOSTICS v_n = ROW_COUNT;
--   v_counts := v_counts || jsonb_build_object('coach_relationship_memory', v_n);
--   v_total := v_total + v_n;
-- ---------------------------------------------------------------------------
