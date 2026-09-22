-- Programs V1: Respect Yourself and Others progress and reflections.
-- Prepared for manual review. This file was not executed by Cursor.
-- Do not run this against production until Tyler approves it.
--
-- These are new tables. They do not alter SMS, TTO, Hallway, Notebook,
-- Victory Room, goals, identity, onboarding, Film Room, or coaching memory.
--
-- Browser clients do not write these tables. The app uses the Supabase
-- service role after Clerk identifies the signed-in member. RLS is enabled
-- and anon/authenticated have no privileges, matching v2_durable_user_evidence.

CREATE TABLE public.learning_mini_program_progress (
  clerk_user_id TEXT NOT NULL,
  mini_program_id TEXT NOT NULL,
  current_step_id TEXT NOT NULL,
  status TEXT NOT NULL,
  curriculum_version INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT learning_mini_program_progress_pkey
    PRIMARY KEY (clerk_user_id, mini_program_id),
  CONSTRAINT learning_mini_program_progress_clerk_user_id_check
    CHECK (char_length(btrim(clerk_user_id)) > 0),
  CONSTRAINT learning_mini_program_progress_mini_program_id_check
    CHECK (char_length(btrim(mini_program_id)) > 0),
  CONSTRAINT learning_mini_program_progress_current_step_id_check
    CHECK (char_length(btrim(current_step_id)) > 0),
  CONSTRAINT learning_mini_program_progress_curriculum_version_check
    CHECK (curriculum_version >= 1),
  CONSTRAINT learning_mini_program_progress_status_check
    CHECK (
      (
        status = 'in_progress'
        AND completed_at IS NULL
      )
      OR (
        status = 'completed'
        AND completed_at IS NOT NULL
      )
    )
);

COMMENT ON TABLE public.learning_mini_program_progress IS
  'One Programs progress row per member per mini-program. current_step_id is the furthest unfinished step. Not Started is the absence of a row.';

COMMENT ON COLUMN public.learning_mini_program_progress.current_step_id IS
  'Furthest reached step id. Reviewing an earlier step does not move this backward.';

COMMENT ON COLUMN public.learning_mini_program_progress.curriculum_version IS
  'Curriculum version at the time the member started. Version 1 for Respect Yourself and Others.';

CREATE TABLE public.learning_reflection_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  mini_program_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  question_text TEXT NOT NULL,
  answer_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT learning_reflection_answers_member_question_key
    UNIQUE (clerk_user_id, mini_program_id, question_id),
  CONSTRAINT learning_reflection_answers_clerk_user_id_check
    CHECK (char_length(btrim(clerk_user_id)) > 0),
  CONSTRAINT learning_reflection_answers_mini_program_id_check
    CHECK (char_length(btrim(mini_program_id)) > 0),
  CONSTRAINT learning_reflection_answers_step_id_check
    CHECK (char_length(btrim(step_id)) > 0),
  CONSTRAINT learning_reflection_answers_question_id_check
    CHECK (char_length(btrim(question_id)) > 0),
  CONSTRAINT learning_reflection_answers_question_text_check
    CHECK (
      char_length(btrim(question_text)) >= 1
      AND char_length(question_text) <= 1000
    ),
  CONSTRAINT learning_reflection_answers_answer_text_check
    CHECK (
      char_length(btrim(answer_text)) >= 1
      AND char_length(answer_text) <= 4000
    )
);

COMMENT ON TABLE public.learning_reflection_answers IS
  'Latest Programs reflection for a member, mini-program, and stable question id. question_text is a snapshot of the prompt they answered. No quiz scores and no version history.';

CREATE INDEX learning_reflection_answers_member_program_idx
  ON public.learning_reflection_answers (clerk_user_id, mini_program_id);

ALTER TABLE public.learning_mini_program_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_reflection_answers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.learning_mini_program_progress FROM PUBLIC;
REVOKE ALL ON TABLE public.learning_mini_program_progress FROM anon;
REVOKE ALL ON TABLE public.learning_mini_program_progress FROM authenticated;

REVOKE ALL ON TABLE public.learning_reflection_answers FROM PUBLIC;
REVOKE ALL ON TABLE public.learning_reflection_answers FROM anon;
REVOKE ALL ON TABLE public.learning_reflection_answers FROM authenticated;

GRANT ALL PRIVILEGES
ON TABLE public.learning_mini_program_progress
TO service_role;

GRANT ALL PRIVILEGES
ON TABLE public.learning_reflection_answers
TO service_role;

GRANT SELECT
ON TABLE public.learning_mini_program_progress
TO readonly_user;

GRANT SELECT
ON TABLE public.learning_reflection_answers
TO readonly_user;

CREATE OR REPLACE FUNCTION public.set_learning_mini_program_progress_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_learning_mini_program_progress_updated_at
  BEFORE UPDATE ON public.learning_mini_program_progress
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_learning_mini_program_progress_updated_at();

CREATE OR REPLACE FUNCTION public.set_learning_reflection_answers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_learning_reflection_answers_updated_at
  BEFORE UPDATE ON public.learning_reflection_answers
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_learning_reflection_answers_updated_at();

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
-- Placement: V2 soft-linked / user-content section, immediately before
-- `DELETE FROM public.v2_win WHERE clerk_user_id = v_clerk;`
-- Delete reflection answers first, then progress. There is no foreign key
-- between these tables; the order matches "child content, then progress."
--
-- Live snippet (do not execute from this migration):
--   DELETE FROM public.learning_reflection_answers WHERE clerk_user_id = v_clerk;
--   GET DIAGNOSTICS v_n = ROW_COUNT;
--   v_counts := v_counts || jsonb_build_object('learning_reflection_answers', v_n);
--   v_total := v_total + v_n;
--
--   DELETE FROM public.learning_mini_program_progress WHERE clerk_user_id = v_clerk;
--   GET DIAGNOSTICS v_n = ROW_COUNT;
--   v_counts := v_counts || jsonb_build_object('learning_mini_program_progress', v_n);
--   v_total := v_total + v_n;
-- ---------------------------------------------------------------------------

-- Verification (run manually after the tables exist; not part of the migration body):
-- SELECT to_regclass('public.learning_mini_program_progress') AS progress_table,
--        to_regclass('public.learning_reflection_answers') AS reflection_table;
--
-- SELECT relname, relrowsecurity
-- FROM pg_class
-- WHERE relname IN ('learning_mini_program_progress', 'learning_reflection_answers');
--
-- SELECT grantee, table_name, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name IN ('learning_mini_program_progress', 'learning_reflection_answers')
-- ORDER BY table_name, grantee, privilege_type;
