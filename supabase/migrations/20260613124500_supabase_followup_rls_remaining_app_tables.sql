-- Follow-up to 20260613120000_supabase_service_role_only_hardening.sql
-- and 20260613123000_supabase_followup_rls_ask_pat_daily_summaries.sql
--
-- Enables RLS and revokes direct anon/authenticated/PUBLIC table access for
-- the remaining app tables listed below only.
-- Summitt continues to use server-side service-role access (supabaseServer).
-- No client RLS policies are created.

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'achievements_unlocked',
    'challenge_participants',
    'coach_conversations',
    'coach_pat_daily_notes',
    'coach_pat_daily_usage',
    'coach_reply_usage',
    'coach_shipping_addresses',
    'daily_completion_events',
    'daily_prompt_versions',
    'daily_prompts'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables
  LOOP
    IF to_regclass(format('public.%I', tbl)) IS NULL THEN
      RAISE NOTICE 'supabase_followup_rls_remaining_app_tables: skipping missing table %', tbl;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', tbl);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', tbl);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', tbl);
  END LOOP;
END $$;
