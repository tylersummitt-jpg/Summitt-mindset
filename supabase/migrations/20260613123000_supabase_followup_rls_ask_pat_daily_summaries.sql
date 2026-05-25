-- Follow-up to 20260613120000_supabase_service_role_only_hardening.sql
--
-- Enables RLS and revokes direct anon/authenticated/PUBLIC table access for
-- ask_pat_questions, ask_pat_usage, and daily_summaries only.
-- Summitt continues to use server-side service-role access (supabaseServer).
-- No client RLS policies are created.

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'ask_pat_questions',
    'ask_pat_usage',
    'daily_summaries'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables
  LOOP
    IF to_regclass(format('public.%I', tbl)) IS NULL THEN
      RAISE NOTICE 'supabase_followup_rls_ask_pat_daily_summaries: skipping missing table %', tbl;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', tbl);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', tbl);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', tbl);
  END LOOP;
END $$;
