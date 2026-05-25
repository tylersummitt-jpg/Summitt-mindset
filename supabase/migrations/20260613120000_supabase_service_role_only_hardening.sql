-- Supabase service-role-only hardening (defense in depth).
--
-- Summitt uses server-side service-role Supabase access (supabaseServer).
-- Direct anon/authenticated table access is intentionally revoked.
-- User access must go through Clerk-authenticated Next.js server routes.
-- No client RLS policies are created in this migration.

-- ---------------------------------------------------------------------------
-- SECTION A — Table hardening: enable RLS + revoke client role privileges
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'feedback_events',
    'film_videos',
    'goal_coherence_log',
    'important_people',
    'journal_entries',
    'pat_quotes',
    'pat_quotes_sms',
    'pattern_insights',
    'practice_prompts',
    'quotes_book_fulfillment_reminders',
    'recent_summary',
    'respond_day_questions',
    'retention_daily_rollups',
    'retention_signals',
    'sms_audience',
    'sms_audience_pref_backup',
    'sms_daily_stats',
    'sms_delivery_state',
    'sms_identities',
    'sms_inbound_coach_jobs',
    'sms_inbound_messages',
    'sms_last_outbound_context',
    'sms_send_events',
    'sms_weekly_send_events',
    'stripe_webhook_events',
    'testimonials',
    'training_camp_non_video_days',
    'user_accountability_season',
    'user_identity_version',
    'user_profiles',
    'v2_check_sent_outbound_intent_snapshot',
    'v2_commitment',
    'v2_commitment_coaching_memory',
    'v2_commitment_event',
    'v2_commitment_evolution_recommendation',
    'v2_commitment_intake',
    'v2_commitment_sms_thread_memory',
    'v2_event',
    'v2_refresh_outbound_intent_snapshot',
    'v2_rollout_flag',
    'v2_sms_meaning_interpretation_shadow',
    'v2_sms_pattern_correction',
    'v2_user_rollout',
    'v2_user_send_time_profile',
    'v2_user_sms_comms_preferences',
    'v2_victory_pat_principles_snapshot',
    'v2_victory_pat_read_snapshot',
    'v2_victory_season_summary_snapshot',
    'weekly_sms_reflections',
    'weekly_summaries',
    'winback_queue'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables
  LOOP
    IF to_regclass(format('public.%I', tbl)) IS NULL THEN
      RAISE NOTICE 'supabase_service_role_only_hardening: skipping missing table %', tbl;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', tbl);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', tbl);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', tbl);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- SECTION B — Drop unused SMS prefs client policy (server API uses service role)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS v2_user_sms_comms_prefs_select_own ON public.v2_user_sms_comms_preferences;

-- ---------------------------------------------------------------------------
-- SECTION C — Function/RPC hardening: service_role EXECUTE only
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn record;
  allowlist text[] := ARRAY[
    'set_updated_at',
    'set_updated_at_coach_shipping_addresses',
    'set_v2_user_sms_comms_prefs_updated_at',
    'update_sms_audience_timestamp',
    'update_user_profiles_timestamp',
    'update_weekly_summaries_updated_at',
    'v2_apply_check_sent_post_send_bookkeeping_mutation',
    'v2_apply_guided_commitment_replace_mutation',
    'v2_apply_overlay_consent_mutation',
    'v2_apply_refresh_commitment_step_resolution_mutation',
    'v2_apply_refresh_identity_step_resolution_mutation',
    'v2_apply_refresh_prompted_post_send_bookkeeping_mutation',
    'sob_complete_onboarding_activation',
    'v2_apply_sms_goal_change_with_season_mutation',
    'v2_close_active_accountability_season',
    'v2_rename_accountability_season',
    'v2_start_accountability_season_for_commitment'
  ];
  fn_sig text;
BEGIN
  FOR fn IN
    SELECT
      p.oid,
      n.nspname AS schema_name,
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (allowlist)
  LOOP
    fn_sig := format('%I.%I(%s)', fn.schema_name, fn.proname, fn.args);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn_sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn_sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn_sig);
    RAISE NOTICE 'supabase_service_role_only_hardening: hardened function %', fn_sig;
  END LOOP;
END $$;
