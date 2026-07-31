-- Umbrella 1: durable Victory Room Wins (v2_win) + account-deletion purge extension.
-- Additive. Service-role-only. Whole-life Wins may have commitment_id NULL.
-- Migration NOT applied by this slice.

CREATE TABLE public.v2_win (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_message_sid TEXT NULL,
  source_message_id UUID NULL REFERENCES public.sms_inbound_messages (id) ON DELETE SET NULL,
  source_event_id UUID NULL REFERENCES public.v2_commitment_event (id) ON DELETE SET NULL,
  commitment_id UUID NULL REFERENCES public.v2_commitment (id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  recognized_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  action_fact TEXT NOT NULL,
  why_meaningful TEXT NULL,
  display_title TEXT NOT NULL,
  display_body TEXT NOT NULL,
  supporting_quote TEXT NULL,
  relationship_type TEXT NOT NULL,
  recognition_mode TEXT NOT NULL,
  user_expressed_pride BOOLEAN NOT NULL DEFAULT false,
  identity_related BOOLEAN NOT NULL DEFAULT false,
  sensitivity_caution BOOLEAN NOT NULL DEFAULT false,
  celebration_appropriate BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'active',
  hidden_at TIMESTAMPTZ NULL,
  hidden_reason TEXT NULL,
  candidate_ordinal SMALLINT NOT NULL,
  idempotency_key TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT 'win_v1',
  model_confidence NUMERIC NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT v2_win_source_type_chk CHECK (
    source_type IN ('sms_inbound', 'system_event')
  ),
  CONSTRAINT v2_win_relationship_type_chk CHECK (
    relationship_type IN ('goal', 'identity', 'whole_life', 'mixed')
  ),
  CONSTRAINT v2_win_recognition_mode_chk CHECK (
    recognition_mode IN ('user_identified', 'coach_recognized')
  ),
  CONSTRAINT v2_win_status_chk CHECK (
    status IN ('active', 'hidden')
  ),
  CONSTRAINT v2_win_candidate_ordinal_chk CHECK (
    candidate_ordinal IN (0, 1)
  ),
  CONSTRAINT v2_win_schema_version_chk CHECK (
    schema_version IN ('win_v1')
  ),
  CONSTRAINT v2_win_model_confidence_chk CHECK (
    model_confidence IS NULL OR (model_confidence >= 0 AND model_confidence <= 1)
  ),
  CONSTRAINT v2_win_action_fact_len_chk CHECK (
    char_length(action_fact) > 0 AND char_length(action_fact) <= 240
  ),
  CONSTRAINT v2_win_why_meaningful_len_chk CHECK (
    why_meaningful IS NULL OR char_length(why_meaningful) <= 360
  ),
  CONSTRAINT v2_win_display_title_len_chk CHECK (
    char_length(display_title) > 0 AND char_length(display_title) <= 80
  ),
  CONSTRAINT v2_win_display_body_len_chk CHECK (
    char_length(display_body) > 0 AND char_length(display_body) <= 240
  ),
  CONSTRAINT v2_win_supporting_quote_len_chk CHECK (
    supporting_quote IS NULL OR char_length(supporting_quote) <= 240
  ),
  CONSTRAINT v2_win_hidden_reason_len_chk CHECK (
    hidden_reason IS NULL OR char_length(hidden_reason) <= 240
  ),
  CONSTRAINT v2_win_sms_inbound_sid_chk CHECK (
    source_type <> 'sms_inbound' OR (source_message_sid IS NOT NULL AND length(trim(source_message_sid)) > 0)
  )
);

-- Explicit FK: live + purge-aligned schema uses UUID sms_inbound_messages.id.
-- ON DELETE SET NULL preserves durable Wins if raw inbound rows are removed.

CREATE UNIQUE INDEX uq_v2_win_idempotency_key
  ON public.v2_win (idempotency_key);

CREATE INDEX idx_v2_win_clerk_status_occurred
  ON public.v2_win (clerk_user_id, status, occurred_at DESC);

CREATE INDEX idx_v2_win_commitment_status_occurred
  ON public.v2_win (commitment_id, status, occurred_at DESC)
  WHERE commitment_id IS NOT NULL;

CREATE INDEX idx_v2_win_source_message_sid
  ON public.v2_win (source_message_sid)
  WHERE source_message_sid IS NOT NULL;

CREATE INDEX idx_v2_win_clerk_user_id
  ON public.v2_win (clerk_user_id);

COMMENT ON TABLE public.v2_win IS
  'Durable Victory Room Wins. OpenAI owns semantic recognition; server owns persistence/idempotency. Whole-life Wins may have commitment_id NULL.';

ALTER TABLE public.v2_win ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.v2_win FROM anon;
REVOKE ALL ON TABLE public.v2_win FROM authenticated;
REVOKE ALL ON TABLE public.v2_win FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.set_v2_win_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_v2_win_updated_at
  BEFORE UPDATE ON public.v2_win
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_v2_win_updated_at();


-- ---------------------------------------------------------------------------
-- Account deletion: purge v2_win with other V2 soft-linked rows
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_app_data_for_account_deletion(
  p_request_id UUID,
  p_clerk_user_id TEXT,
  p_expected_orchestration_version INTEGER,
  p_lock_owner TEXT,
  p_lease_ms INTEGER DEFAULT 120000
)
RETURNS TABLE (
  outcome TEXT,
  counts JSONB,
  limitations JSONB
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_clerk TEXT := trim(coalesce(p_clerk_user_id, ''));
  v_owner TEXT := trim(coalesce(p_lock_owner, ''));
  v_lease_ms INTEGER := coalesce(p_lease_ms, 120000);
  v_req public.account_deletion_requests%ROWTYPE;
  v_counts JSONB := '{}'::jsonb;
  v_limitations JSONB := '[]'::jsonb;
  v_n BIGINT := 0;
  v_total BIGINT := 0;
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

  -- Optional ops backup: absent is expected/harmless (no limitation).
  IF to_regclass('public.sms_audience_pref_backup') IS NOT NULL THEN
    DELETE FROM public.sms_audience_pref_backup WHERE clerk_user_id = v_clerk;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('sms_audience_pref_backup', v_n);
    v_total := v_total + v_n;
  END IF;

  -- =========================================================================
  -- 6. Drafts before generations (FK NO ACTION on current_generation_id)
  -- =========================================================================
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

  -- =========================================================================
  -- 7. STOP tombstone copy then delete all target inbound rows
  -- =========================================================================
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

  -- =========================================================================
  -- 8. Non-V2 user content
  -- =========================================================================
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

  -- Optional orphan twin: absent is expected/harmless (no limitation).
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

  -- =========================================================================
  -- 9. V2 soft-linked
  -- =========================================================================
  DELETE FROM public.v2_sms_meaning_interpretation_shadow WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('v2_sms_meaning_interpretation_shadow', v_n);
  v_total := v_total + v_n;

  DELETE FROM public.v2_sms_pattern_correction
  WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('v2_sms_pattern_correction', v_n);
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

  -- =========================================================================
  -- 10. RESTRICT children before identity versions / commitment
  -- =========================================================================
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

  -- =========================================================================
  -- 11. Explicit commitment children then commitment
  -- =========================================================================
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

  -- =========================================================================
  -- 12–14. Orphans, profiles, identity versions
  -- =========================================================================
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

  -- =========================================================================
  -- 15. Testimonials (all) / admin notes (entire row) / shipping
  -- =========================================================================
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

  -- Optional fulfillment reminders: absent is expected/harmless (no limitation).
  IF to_regclass('public.quotes_book_fulfillment_reminders') IS NOT NULL THEN
    DELETE FROM public.quotes_book_fulfillment_reminders WHERE clerk_user_id = v_clerk;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('quotes_book_fulfillment_reminders', v_n);
    v_total := v_total + v_n;
  END IF;

  -- Challenge: exact Clerk ownership only. Legacy email-only (NULL clerk) untouched.
  DELETE FROM public.challenge_participants
  WHERE clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('challenge_rows_deleted', v_n);
  v_total := v_total + v_n;

  -- Never touch: account_deletion_requests (except later CAS), stripe_webhook_events,
  -- catalogs, aggregates, other users, external systems, legacy email-only challenge rows.

  -- Blocking limitations (none expected in V1 C2 after challenge Clerk column) force incomplete.
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
$$;


COMMENT ON FUNCTION public.purge_app_data_for_account_deletion(UUID, TEXT, INTEGER, TEXT, INTEGER) IS
  'APP-041C2: allowlisted user-bound app-data purge. Requires purging_app_data + active lease. '
  'STOP → sms_opt_out_tombstones then delete inbound. Includes v2_win. Challenge DELETE by clerk_user_id only. Service-role only.';

REVOKE ALL ON FUNCTION public.purge_app_data_for_account_deletion(UUID, TEXT, INTEGER, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_app_data_for_account_deletion(UUID, TEXT, INTEGER, TEXT, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.purge_app_data_for_account_deletion(UUID, TEXT, INTEGER, TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_app_data_for_account_deletion(UUID, TEXT, INTEGER, TEXT, INTEGER) TO service_role;
