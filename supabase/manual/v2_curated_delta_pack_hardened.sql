-- =============================================================================
-- CURATED V2 MANUAL DELTA PACK (production baseline database)
-- =============================================================================
-- This is a hand-ordered apply script for the V2 layer on a database that
-- already contains the legacy "old system" tables and data.
--
-- Supabase migration history is NOT updated by executing this file. Before or
-- after apply, decide how this run relates to `supabase migration list` /
-- `supabase db push` (e.g. migration repair, or documenting that prod DDL was
-- applied out-of-band). Do not assume a future `db push` is safe without
-- reconciling recorded version(s) against this apply.
-- =============================================================================

-- =============================================================================
-- PREFLIGHT (read-only): stray / partial V2 objects BEFORE the apply transaction
-- =============================================================================

-- Existing public.v2_% base tables
SELECT
  table_schema,
  table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name LIKE 'v2\_%' ESCAPE '\'
ORDER BY table_name;

-- Existing public.v2_apply_% routines (signatures; reveals overloads)
SELECT
  p.oid::regprocedure AS routine_signature,
  pg_get_function_identity_arguments(p.oid) AS identity_args
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE 'v2\_apply\_%' ESCAPE '\'
ORDER BY p.proname, p.oid;

-- Overload count per v2_apply_* name (expect 1 per RPC you ship)
SELECT
  p.proname,
  count(*)::bigint AS overload_count
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE 'v2\_apply\_%' ESCAPE '\'
GROUP BY p.proname
ORDER BY p.proname;

-- Cheap index names on public v2_% tables
SELECT
  schemaname,
  tablename,
  indexname
FROM pg_catalog.pg_indexes
WHERE schemaname = 'public'
  AND tablename LIKE 'v2\_%' ESCAPE '\'
ORDER BY tablename, indexname;

-- Cheap constraints on public v2_% tables (P/F/U/C)
SELECT
  c.relname AS table_name,
  con.conname,
  con.contype
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname LIKE 'v2\_%' ESCAPE '\'
ORDER BY c.relname, con.conname;

-- =============================================================================
-- APPLY: single transaction (SET LOCAL search_path for object resolution)
-- =============================================================================

BEGIN;

SET LOCAL search_path TO public;

-- >>> migration: 20260423140000_v2_001_rollout_flag_user_rollout_event.sql

-- V2 sandbox — Migration 001 (additive only)
-- New tables only: v2_rollout_flag, v2_user_rollout, v2_event
-- No triggers, no RLS, no policies, no seeds, no legacy changes, no FKs to legacy.

-- ---------------------------------------------------------------------------
-- v2_rollout_flag: one row per named flag (catalog)
-- ---------------------------------------------------------------------------
CREATE TABLE v2_rollout_flag (
  flag_key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- v2_user_rollout: per-user pilot enrollment / overrides
-- ---------------------------------------------------------------------------
CREATE TABLE v2_user_rollout (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  feature_key TEXT NOT NULL,
  cohort TEXT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT v2_user_rollout_user_feature_uniq UNIQUE (clerk_user_id, feature_key)
);

CREATE INDEX idx_v2_user_rollout_clerk_user_id
  ON v2_user_rollout (clerk_user_id);

-- ---------------------------------------------------------------------------
-- v2_event: append-only event spine (convention: no updates; new row = fix)
-- ---------------------------------------------------------------------------
CREATE TABLE v2_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL,
  clerk_user_id TEXT NULL,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  correlation_id TEXT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT v2_event_idempotency_key_uniq UNIQUE (idempotency_key)
);

CREATE INDEX idx_v2_event_clerk_occurred
  ON v2_event (clerk_user_id, occurred_at DESC);

CREATE INDEX idx_v2_event_type_occurred
  ON v2_event (event_type, occurred_at DESC);

-- >>> migration: 20260429120000_v2_user_send_time_profile.sql

-- V2: learned send-time profile (user-scoped, rule-derived). Additive only.

CREATE TABLE v2_user_send_time_profile (
  clerk_user_id TEXT PRIMARY KEY,
  preferred_window TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  reply_count_morning INTEGER NOT NULL DEFAULT 0,
  reply_count_midday INTEGER NOT NULL DEFAULT 0,
  reply_count_afternoon INTEGER NOT NULL DEFAULT 0,
  reply_count_evening INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT v2_user_send_time_profile_window_chk CHECK (
    preferred_window IN ('morning', 'midday', 'afternoon', 'evening')
  )
);

CREATE INDEX idx_v2_user_send_time_profile_confidence
  ON v2_user_send_time_profile (confidence DESC);

-- >>> migration: 20260423140001_v2_send_time_weak_no_reply.sql

-- Weak no-reply counters for V2 learned send-time (additive, rollback = DROP COLUMN).

ALTER TABLE v2_user_send_time_profile
  ADD COLUMN IF NOT EXISTS weak_no_reply_morning INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weak_no_reply_midday INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weak_no_reply_afternoon INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weak_no_reply_evening INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN v2_user_send_time_profile.weak_no_reply_morning IS
  'Bounded weak-negative count: accountability check sent in morning window with no same-calendar-day user outcome.';

-- >>> migration: 20260424120000_v2_002_commitment.sql

-- V2 sandbox — Migration 002: commitment + append-only commitment events
-- Additive only. No legacy tables. No triggers. No RLS. No seeds.
-- Depends on Migration 001 existing only in the sense of separate v2_* namespace;
-- no FK between 001 tables and these.

-- ---------------------------------------------------------------------------
-- v2_commitment: one row per commitment (current or historical)
-- At most one row per user with status = 'active' (partial unique index).
-- ---------------------------------------------------------------------------
CREATE TABLE v2_commitment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  commitment_type TEXT NOT NULL,
  behavior_statement TEXT NOT NULL,
  success_criteria TEXT NULL,
  cadence_kind TEXT NOT NULL DEFAULT 'daily',
  tone_preference TEXT NULL,
  reachability_window JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT v2_commitment_status_chk CHECK (
    status IN (
      'proposed',
      'active',
      'paused',
      'completed',
      'abandoned',
      'superseded'
    )
  )
);

CREATE UNIQUE INDEX uq_v2_commitment_one_active_per_user
  ON v2_commitment (clerk_user_id)
  WHERE status = 'active';

CREATE INDEX idx_v2_commitment_clerk_user_id
  ON v2_commitment (clerk_user_id);

CREATE INDEX idx_v2_commitment_clerk_started
  ON v2_commitment (clerk_user_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- v2_commitment_event: append-only history for a commitment
-- ---------------------------------------------------------------------------
CREATE TABLE v2_commitment_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id UUID NOT NULL REFERENCES v2_commitment (id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT v2_commitment_event_type_chk CHECK (
    event_type IN (
      'created',
      'activated',
      'check_sent',
      'user_yes',
      'user_no',
      'user_partial',
      'user_silent',
      'ask_shrunk',
      'timing_shifted',
      'tone_shifted',
      'paused',
      'resumed',
      'completed',
      'abandoned',
      'superseded'
    )
  )
);

CREATE INDEX idx_v2_commitment_event_commitment_occurred
  ON v2_commitment_event (commitment_id, occurred_at DESC);

CREATE INDEX idx_v2_commitment_event_clerk_occurred
  ON v2_commitment_event (clerk_user_id, occurred_at DESC);

CREATE UNIQUE INDEX uq_v2_commitment_event_idempotency_key
  ON v2_commitment_event (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- >>> migration: 20260425120000_v2_blocker_capture.sql

-- V2: pending blocker capture window + blocker_captured event type

ALTER TABLE v2_commitment
  ADD COLUMN IF NOT EXISTS blocker_capture_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS blocker_capture_after_event TEXT NULL;

ALTER TABLE v2_commitment_event DROP CONSTRAINT IF EXISTS v2_commitment_event_type_chk;

ALTER TABLE v2_commitment_event ADD CONSTRAINT v2_commitment_event_type_chk CHECK (
  event_type IN (
    'created',
    'activated',
    'check_sent',
    'user_yes',
    'user_no',
    'user_partial',
    'user_silent',
    'blocker_captured',
    'ask_shrunk',
    'timing_shifted',
    'tone_shifted',
    'paused',
    'resumed',
    'completed',
    'abandoned',
    'superseded'
  )
);

-- >>> migration: 20260426120000_v2_adaptive_contract_overlay.sql

-- V2: temporary adaptive ask overlay + explicit shrink proposal (same commitment row).
-- Additive only. No new tables.

ALTER TABLE v2_commitment
  ADD COLUMN IF NOT EXISTS adaptive_ask_text TEXT NULL,
  ADD COLUMN IF NOT EXISTS adaptive_ask_active_from TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS adaptive_ask_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS adaptive_proposal_text TEXT NULL,
  ADD COLUMN IF NOT EXISTS adaptive_proposal_created_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS adaptive_proposal_expires_at TIMESTAMPTZ NULL;

ALTER TABLE v2_commitment_event DROP CONSTRAINT IF EXISTS v2_commitment_event_type_chk;

ALTER TABLE v2_commitment_event ADD CONSTRAINT v2_commitment_event_type_chk CHECK (
  event_type IN (
    'created',
    'activated',
    'check_sent',
    'user_yes',
    'user_no',
    'user_partial',
    'user_silent',
    'blocker_captured',
    'contract_overlay_proposed',
    'contract_overlay_activated',
    'contract_overlay_declined',
    'ask_shrunk',
    'timing_shifted',
    'tone_shifted',
    'paused',
    'resumed',
    'completed',
    'abandoned',
    'superseded'
  )
);

-- >>> migration: 20260427120000_v2_commitment_coaching_memory.sql

-- V2: denormalized coaching memory projection (recomputable from commitment + events).
-- Additive only. No new event types.

CREATE TABLE v2_commitment_coaching_memory (
  commitment_id UUID PRIMARY KEY REFERENCES v2_commitment (id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  effective_ask_text TEXT NOT NULL,
  coaching_state TEXT NOT NULL,
  silence_tier_snapshot TEXT NOT NULL,
  unanswered_checks_snapshot INTEGER NOT NULL DEFAULT 0,
  days_since_last_user_outcome_snapshot INTEGER NOT NULL DEFAULT 0,
  cadence_level TEXT NOT NULL,
  cadence_reason_code TEXT NOT NULL,
  next_move_type TEXT NOT NULL,
  next_move_reason_code TEXT NOT NULL,
  overlay_active BOOLEAN NOT NULL DEFAULT false,
  overlay_expires_at TIMESTAMPTZ NULL,
  yes_streak_14d INTEGER NOT NULL DEFAULT 0,
  no_count_14d INTEGER NOT NULL DEFAULT 0,
  partial_count_14d INTEGER NOT NULL DEFAULT 0,
  latest_blocker_preview TEXT NULL,
  blocker_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  coaching_summary TEXT NULL,
  summary_updated_at TIMESTAMPTZ NULL,
  summary_version TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_v2_commitment_coaching_memory_clerk
  ON v2_commitment_coaching_memory (clerk_user_id);

-- >>> migration: 20260423160000_v2_coaching_memory_relationship_profile.sql

-- V2 SMS: long-horizon relationship profile (rule-derived projection on coaching memory).
-- Additive only. No new spine event types.

ALTER TABLE v2_commitment_coaching_memory
  ADD COLUMN IF NOT EXISTS relationship_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS relationship_profile_version TEXT NULL,
  ADD COLUMN IF NOT EXISTS relationship_profile_updated_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN v2_commitment_coaching_memory.relationship_profile IS
  'Structured sms_relationship_v1 JSON: tone/density fit hints; rule-derived; not authoritative for cadence/next_move/overlays.';

-- >>> migration: 20260428120000_v2_low_pressure_reactivation.sql

-- V2: stored low-pressure reactivation (pause-until-reply). Additive only. No new event types.

ALTER TABLE v2_commitment
  ADD COLUMN IF NOT EXISTS accountability_phase TEXT NOT NULL DEFAULT 'active_accountability',
  ADD COLUMN IF NOT EXISTS reactivation_entered_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reactivation_last_sent_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reactivation_entry_reason_code TEXT NULL;

ALTER TABLE v2_commitment
  ADD CONSTRAINT v2_commitment_accountability_phase_chk CHECK (
    accountability_phase IN ('active_accountability', 'low_pressure_reactivation')
  );

ALTER TABLE v2_commitment_coaching_memory
  ADD COLUMN IF NOT EXISTS accountability_phase TEXT NOT NULL DEFAULT 'active_accountability',
  ADD COLUMN IF NOT EXISTS reactivation_entered_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reactivation_last_sent_at TIMESTAMPTZ NULL;

ALTER TABLE v2_commitment_coaching_memory
  ADD CONSTRAINT v2_commitment_coaching_memory_accountability_phase_chk CHECK (
    accountability_phase IN ('active_accountability', 'low_pressure_reactivation')
  );

-- >>> migration: 20260430120000_user_profiles_identity_anchor.sql

-- Identity anchor for V2 coaching (user-origin; user_profiles is source of truth).
-- Additive only; no new tables.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS identity_anchor_text TEXT NULL,
  ADD COLUMN IF NOT EXISTS identity_source TEXT NULL,
  ADD COLUMN IF NOT EXISTS identity_last_confirmed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS identity_refresh_due_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS identity_last_referenced_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.user_profiles.identity_source IS
  'e.g. onboarding_life_desires | user_edited — informational; not enforced by CHECK in v1.';

-- >>> migration: 20260501120000_v2_coaching_refresh_session.sql

-- V2: explicit identity + commitment refresh session (SMS-first, auditable).
ALTER TABLE v2_commitment
  ADD COLUMN IF NOT EXISTS refresh_session JSONB NULL,
  ADD COLUMN IF NOT EXISTS commitment_refresh_last_prompted_at TIMESTAMPTZ NULL;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS identity_refresh_last_prompted_at TIMESTAMPTZ NULL;

ALTER TABLE v2_commitment_event DROP CONSTRAINT IF EXISTS v2_commitment_event_type_chk;

ALTER TABLE v2_commitment_event ADD CONSTRAINT v2_commitment_event_type_chk CHECK (
  event_type IN (
    'created',
    'activated',
    'check_sent',
    'user_yes',
    'user_no',
    'user_partial',
    'user_silent',
    'blocker_captured',
    'contract_overlay_proposed',
    'contract_overlay_activated',
    'contract_overlay_declined',
    'coaching_refresh_prompted',
    'coaching_refresh_resolved',
    'ask_shrunk',
    'timing_shifted',
    'tone_shifted',
    'paused',
    'resumed',
    'completed',
    'abandoned',
    'superseded'
  )
);

-- >>> migration: 20260502120000_v2_guided_pending_resolution.sql

-- V2: bounded pending state after refresh SMS handoff (CHANGE / NEW → app).
ALTER TABLE v2_commitment
  ADD COLUMN IF NOT EXISTS pending_resolution_kind TEXT NULL,
  ADD COLUMN IF NOT EXISTS pending_resolution_created_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS pending_resolution_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS pending_resolution_payload JSONB NULL;

COMMENT ON COLUMN v2_commitment.pending_resolution_kind IS 'identity_anchor_update | commitment_replace (app guided flow)';
COMMENT ON COLUMN v2_commitment.pending_resolution_expires_at IS 'Abandon handoff after this time; cleared on save/cancel/reactivation.';

-- >>> migration: 20260503120000_retention_reporting_truth_columns.sql

-- Retention / reporting: additive truth columns + COMMENT ON (no drops, no renames).
-- Pairs with app dual-write in retention-metrics cron.

-- ---------------------------------------------------------------------------
-- retention_signals: parallel V2-spine / basis fields; legacy columns preserved.
-- ---------------------------------------------------------------------------
ALTER TABLE public.retention_signals
  ADD COLUMN IF NOT EXISTS retention_staleness_basis TEXT,
  ADD COLUMN IF NOT EXISTS last_v2_spine_activity_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hours_since_v2_spine INTEGER;

COMMENT ON TABLE public.retention_signals IS
  'Per-subscriber retention snapshot. Cron upserts: legacy-titled columns remain for backward '
  'compatibility; retention_staleness_basis, last_v2_spine_activity_at, and hours_since_v2_spine '
  'document the current V2/legacy model explicitly.';

COMMENT ON COLUMN public.retention_signals.hours_since_last_completion IS
  'Legacy column name. Whole hours of staleness for the user at compute time. For V2 users this '
  'uses the latest v2_commitment_event (or Clerk lastCompletedAt when no spine rows yet), same '
  'as the cron logic. Not a literal "completion" in the V2 system; see retention_staleness_basis.';

COMMENT ON COLUMN public.retention_signals.days_since_last_completion IS
  'Legacy column name. FLOOR(hours_since_last_completion / 24) from the same staleness hours.';

COMMENT ON COLUMN public.retention_signals.last_completed_at IS
  'Clerk public_metadata lastCompletedAt (cache). For V2 users it may lag or seed cold start; it '
  'is not the v2 commitment spine.';

COMMENT ON COLUMN public.retention_signals.retention_staleness_basis IS
  'v2_spine: staleness from latest v2_commitment_event. v2_clerk_cache_fallback: no spine rows, '
  'staleness from Clerk lastCompletedAt. legacy_clerk: non–fully-V2 user, staleness from Clerk.';

COMMENT ON COLUMN public.retention_signals.last_v2_spine_activity_at IS
  'MAX(v2_commitment_event created_at) for this user when any spine rows exist; NULL otherwise.';

COMMENT ON COLUMN public.retention_signals.hours_since_v2_spine IS
  'Whole hours since last v2 spine event when a row exists; NULL when the user has no '
  'v2_commitment_event rows.';

-- ---------------------------------------------------------------------------
-- retention_daily_rollups: split “touch” counts; legacy column names preserved.
-- ---------------------------------------------------------------------------
ALTER TABLE public.retention_daily_rollups
  ADD COLUMN IF NOT EXISTS v2_spine_touches_today INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS legacy_daily_completion_touches_today INTEGER NOT NULL DEFAULT 0;

COMMENT ON TABLE public.retention_daily_rollups IS
  'Per UTC day_key and staleness_mode bucket. completions_count is a legacy name for mixed '
  '"activity today"; v2_spine_touches_today and legacy_daily_completion_touches_today are additive.';

COMMENT ON COLUMN public.retention_daily_rollups.completions_count IS
  'Legacy name: users in this bucket with any qualifying touch for the day. V2: v2_commitment_event '
  'activity that UTC day; legacy: daily_completion_events for that day. See split columns.';

COMMENT ON COLUMN public.retention_daily_rollups.v2_spine_touches_today IS
  'Count of users in this bucket with at least one v2_commitment_event on day_key (UTC).';

COMMENT ON COLUMN public.retention_daily_rollups.legacy_daily_completion_touches_today IS
  'Count of users in this bucket (not on the fully-V2 path used by the cron) with '
  'daily_completion_events for day_key.';

-- >>> migration: 20260504120000_v2_commitment_lineage_and_memory_provenance_v1.sql

-- V2 lineage + coaching-memory provenance v1 (additive only).
-- No drops, no renames, no strict enums/checks.

-- ---------------------------------------------------------------------------
-- v2_commitment: one-direction lineage pointer + optional evolution metadata.
-- ---------------------------------------------------------------------------
ALTER TABLE v2_commitment
  ADD COLUMN IF NOT EXISTS supersedes_commitment_id UUID NULL,
  ADD COLUMN IF NOT EXISTS evolution_kind TEXT NULL,
  ADD COLUMN IF NOT EXISTS evolution_reason_code TEXT NULL,
  ADD COLUMN IF NOT EXISTS evolution_notes TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'v2_commitment_supersedes_commitment_id_fkey'
  ) THEN
    ALTER TABLE v2_commitment
      ADD CONSTRAINT v2_commitment_supersedes_commitment_id_fkey
      FOREIGN KEY (supersedes_commitment_id)
      REFERENCES v2_commitment(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_v2_commitment_supersedes_commitment_id
  ON v2_commitment (supersedes_commitment_id);

COMMENT ON COLUMN v2_commitment.supersedes_commitment_id IS
  'Nullable lineage pointer: this commitment supersedes the referenced prior commitment row.';

COMMENT ON COLUMN v2_commitment.evolution_kind IS
  'Optional coarse lineage kind written by app flows (examples: replace, reframe, tighten). No strict CHECK in v1.';

COMMENT ON COLUMN v2_commitment.evolution_reason_code IS
  'Optional machine-readable reason code for why a new commitment supersedes a prior one. No strict CHECK in v1.';

COMMENT ON COLUMN v2_commitment.evolution_notes IS
  'Optional short operator/debug note for evolution context when grounded input exists.';

-- ---------------------------------------------------------------------------
-- v2_commitment_coaching_memory: projection provenance metadata (v1).
-- ---------------------------------------------------------------------------
ALTER TABLE v2_commitment_coaching_memory
  ADD COLUMN IF NOT EXISTS projection_model_version TEXT NULL,
  ADD COLUMN IF NOT EXISTS projection_prompt_version TEXT NULL,
  ADD COLUMN IF NOT EXISTS projection_last_recomputed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS projection_input_event_upper_bound_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS projection_reason_code TEXT NULL,
  ADD COLUMN IF NOT EXISTS projection_run_id TEXT NULL;

COMMENT ON COLUMN v2_commitment_coaching_memory.projection_model_version IS
  'Version string of deterministic projection logic used for this row snapshot.';

COMMENT ON COLUMN v2_commitment_coaching_memory.projection_prompt_version IS
  'Optional prompt/version marker when an AI-assisted summary/prompted component contributes to projection output.';

COMMENT ON COLUMN v2_commitment_coaching_memory.projection_last_recomputed_at IS
  'Timestamp when this projection row was most recently recomputed and upserted.';

COMMENT ON COLUMN v2_commitment_coaching_memory.projection_input_event_upper_bound_at IS
  'Newest v2_commitment_event timestamp included in this projection recompute window (NULL if no events).';

COMMENT ON COLUMN v2_commitment_coaching_memory.projection_reason_code IS
  'Optional reason code from caller context (for example guided resolution, inbound, cron, manual).';

COMMENT ON COLUMN v2_commitment_coaching_memory.projection_run_id IS
  'Opaque per-recompute run identifier for lightweight tracing without introducing a separate audit table in v1.';

-- >>> migration: 20260506120000_v2_overlay_consent_transaction_wrapper.sql

-- V2 overlay consent transactional wrapper (additive).
-- Atomic bundle: validate pending proposal state + mutate v2_commitment row + insert consent event.

CREATE OR REPLACE FUNCTION public.v2_apply_overlay_consent_mutation(
  p_commitment_id UUID,
  p_clerk_user_id TEXT,
  p_inbound_message_sid TEXT,
  p_decision TEXT,
  p_proposal_text TEXT,
  p_contract_kind TEXT,
  p_expected_proposal_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_expected_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  result TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.v2_commitment%ROWTYPE;
  v_decision TEXT;
  v_proposal_text TEXT;
  v_event_type TEXT;
  v_event_idempotency_key TEXT;
  v_overlay_expires TIMESTAMPTZ;
BEGIN
  v_decision := lower(trim(coalesce(p_decision, '')));
  IF v_decision NOT IN ('accept', 'decline') THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  v_proposal_text := trim(coalesce(p_proposal_text, ''));
  IF v_proposal_text = '' THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT *
  INTO v_row
  FROM public.v2_commitment
  WHERE id = p_commitment_id
    AND clerk_user_id = p_clerk_user_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  v_event_type := CASE WHEN v_decision = 'accept' THEN 'contract_overlay_activated' ELSE 'contract_overlay_declined' END;
  v_event_idempotency_key := format(
    'v2_contract_overlay_%s:%s:%s',
    CASE WHEN v_decision = 'accept' THEN 'activated' ELSE 'declined' END,
    p_commitment_id::TEXT,
    trim(coalesce(p_inbound_message_sid, ''))
  );

  IF EXISTS (
    SELECT 1
    FROM public.v2_commitment_event
    WHERE idempotency_key = v_event_idempotency_key
  ) THEN
    RETURN QUERY SELECT 'already_applied'::TEXT, v_row.updated_at;
    RETURN;
  END IF;

  IF trim(coalesce(v_row.adaptive_proposal_text, '')) = '' THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at;
    RETURN;
  END IF;
  IF trim(v_row.adaptive_proposal_text) <> v_proposal_text THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at;
    RETURN;
  END IF;
  IF v_row.adaptive_ask_text IS NOT NULL THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at;
    RETURN;
  END IF;
  IF p_expected_proposal_expires_at IS NOT NULL
     AND v_row.adaptive_proposal_expires_at IS DISTINCT FROM p_expected_proposal_expires_at THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at;
    RETURN;
  END IF;
  IF p_expected_updated_at IS NOT NULL
     AND v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at;
    RETURN;
  END IF;

  IF v_decision = 'accept' THEN
    v_overlay_expires := p_now + interval '7 days';
    UPDATE public.v2_commitment
    SET adaptive_ask_text = v_proposal_text,
        adaptive_ask_active_from = p_now,
        adaptive_ask_expires_at = v_overlay_expires,
        adaptive_proposal_text = NULL,
        adaptive_proposal_created_at = NULL,
        adaptive_proposal_expires_at = NULL,
        updated_at = p_now
    WHERE id = p_commitment_id
    RETURNING public.v2_commitment.updated_at INTO v_row.updated_at;
  ELSE
    UPDATE public.v2_commitment
    SET adaptive_proposal_text = NULL,
        adaptive_proposal_created_at = NULL,
        adaptive_proposal_expires_at = NULL,
        updated_at = p_now
    WHERE id = p_commitment_id
    RETURNING public.v2_commitment.updated_at INTO v_row.updated_at;
  END IF;

  INSERT INTO public.v2_commitment_event (
    commitment_id,
    clerk_user_id,
    event_type,
    occurred_at,
    source,
    payload_json,
    idempotency_key
  )
  VALUES (
    p_commitment_id,
    p_clerk_user_id,
    v_event_type,
    p_now,
    'sms_v2_accountability',
    CASE
      WHEN v_decision = 'accept' THEN
        jsonb_build_object(
          'contract_kind', p_contract_kind,
          'adaptive_ask_text', v_proposal_text,
          'adaptive_ask_expires_at', v_overlay_expires,
          'overlay_duration_days', 7,
          'consent_inbound_message_sid', trim(coalesce(p_inbound_message_sid, ''))
        )
      ELSE
        jsonb_build_object(
          'contract_kind', p_contract_kind,
          'declined_proposal_text', v_proposal_text,
          'consent_inbound_message_sid', trim(coalesce(p_inbound_message_sid, ''))
        )
    END,
    v_event_idempotency_key
  );

  RETURN QUERY SELECT 'applied'::TEXT, v_row.updated_at;
END;
$$;

COMMENT ON FUNCTION public.v2_apply_overlay_consent_mutation(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
) IS 'Transactional wrapper for V2 overlay consent decision (accept/decline): validates pending proposal state, mutates v2_commitment, inserts consent event atomically.';

-- >>> migration: 20260507120000_v2_refresh_commitment_step_transaction_wrapper.sql

-- V2 refresh transactional wrapper (first slice): commitment-step outcomes only.
-- Atomic bundle: validate active refresh_session(step=commitment), insert resolved event,
-- clear refresh_session, and set/clear pending_resolution state.

CREATE OR REPLACE FUNCTION public.v2_apply_refresh_commitment_step_resolution_mutation(
  p_commitment_id UUID,
  p_clerk_user_id TEXT,
  p_inbound_message_sid TEXT,
  p_resolution TEXT,
  p_expected_session_id TEXT DEFAULT NULL,
  p_expected_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  result TEXT,
  updated_at TIMESTAMPTZ,
  pending_resolution_kind TEXT
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.v2_commitment%ROWTYPE;
  v_resolution TEXT;
  v_session JSONB;
  v_session_step TEXT;
  v_session_id TEXT;
  v_event_idempotency_key TEXT;
  v_pending_kind TEXT;
  v_pending_created_at TIMESTAMPTZ;
  v_pending_expires_at TIMESTAMPTZ;
  v_pending_payload JSONB;
BEGIN
  v_resolution := lower(trim(coalesce(p_resolution, '')));
  IF v_resolution NOT IN ('keep', 'tighten', 'new', 'aborted_unclear') THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ, NULL::TEXT;
    RETURN;
  END IF;

  SELECT *
  INTO v_row
  FROM public.v2_commitment
  WHERE id = p_commitment_id
    AND clerk_user_id = p_clerk_user_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::TIMESTAMPTZ, NULL::TEXT;
    RETURN;
  END IF;

  IF p_expected_updated_at IS NOT NULL
     AND v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at, NULL::TEXT;
    RETURN;
  END IF;

  IF v_row.refresh_session IS NULL OR jsonb_typeof(v_row.refresh_session) <> 'object' THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at, NULL::TEXT;
    RETURN;
  END IF;
  v_session := v_row.refresh_session;
  v_session_step := trim(coalesce(v_session->>'step', ''));
  v_session_id := trim(coalesce(v_session->>'session_id', ''));
  IF v_session_step <> 'commitment' OR v_session_id = '' THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at, NULL::TEXT;
    RETURN;
  END IF;
  IF p_expected_session_id IS NOT NULL
     AND trim(p_expected_session_id) <> ''
     AND trim(p_expected_session_id) <> v_session_id THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at, NULL::TEXT;
    RETURN;
  END IF;

  v_event_idempotency_key := format(
    'v2_coaching_refresh_resolved:%s:%s:%s:%s:%s',
    p_commitment_id::TEXT,
    v_session_id,
    'commitment',
    v_resolution,
    trim(coalesce(p_inbound_message_sid, 'none'))
  );

  IF EXISTS (
    SELECT 1
    FROM public.v2_commitment_event
    WHERE idempotency_key = v_event_idempotency_key
  ) THEN
    RETURN QUERY SELECT
      'already_applied'::TEXT,
      v_row.updated_at,
      v_row.pending_resolution_kind;
    RETURN;
  END IF;

  IF v_resolution = 'tighten' THEN
    v_pending_kind := 'commitment_tighten';
    v_pending_created_at := p_now;
    v_pending_expires_at := p_now + interval '7 days';
    v_pending_payload := jsonb_build_object(
      'source', 'coaching_refresh_resolved',
      'resolution', 'tighten',
      'session_id', v_session_id,
      'inbound_message_sid', trim(coalesce(p_inbound_message_sid, ''))
    );
  ELSIF v_resolution = 'new' THEN
    v_pending_kind := 'commitment_replace';
    v_pending_created_at := p_now;
    v_pending_expires_at := p_now + interval '7 days';
    v_pending_payload := jsonb_build_object(
      'source', 'coaching_refresh_resolved',
      'resolution', 'new',
      'session_id', v_session_id,
      'inbound_message_sid', trim(coalesce(p_inbound_message_sid, ''))
    );
  ELSE
    v_pending_kind := NULL;
    v_pending_created_at := NULL;
    v_pending_expires_at := NULL;
    v_pending_payload := NULL;
  END IF;

  INSERT INTO public.v2_commitment_event (
    commitment_id,
    clerk_user_id,
    event_type,
    occurred_at,
    source,
    payload_json,
    idempotency_key
  )
  VALUES (
    p_commitment_id,
    p_clerk_user_id,
    'coaching_refresh_resolved',
    p_now,
    'sms_v2_accountability',
    jsonb_build_object(
      'session_id', v_session_id,
      'step', 'commitment',
      'resolution', v_resolution,
      'inbound_message_sid', trim(coalesce(p_inbound_message_sid, ''))
    ),
    v_event_idempotency_key
  );

  UPDATE public.v2_commitment
  SET refresh_session = NULL,
      pending_resolution_kind = v_pending_kind,
      pending_resolution_created_at = v_pending_created_at,
      pending_resolution_expires_at = v_pending_expires_at,
      pending_resolution_payload = v_pending_payload,
      updated_at = p_now
  WHERE id = p_commitment_id
  RETURNING public.v2_commitment.updated_at, public.v2_commitment.pending_resolution_kind
  INTO v_row.updated_at, v_row.pending_resolution_kind;

  RETURN QUERY SELECT
    'applied'::TEXT,
    v_row.updated_at,
    v_row.pending_resolution_kind;
END;
$$;

COMMENT ON FUNCTION public.v2_apply_refresh_commitment_step_resolution_mutation(
  UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) IS 'Transactional wrapper for V2 refresh commitment-step resolution (keep/tighten/new/aborted_unclear): validates session state, inserts coaching_refresh_resolved, clears refresh_session, and sets/clears pending_resolution atomically.';

-- >>> migration: 20260507140000_v2_refresh_identity_step_transaction_wrapper.sql

-- V2 refresh transactional wrapper (identity-step slice).
-- Atomic bundle: validate identity refresh session state, insert resolved event,
-- mutate refresh_session, and set/clear pending_resolution state.

CREATE OR REPLACE FUNCTION public.v2_apply_refresh_identity_step_resolution_mutation(
  p_commitment_id UUID,
  p_clerk_user_id TEXT,
  p_inbound_message_sid TEXT,
  p_resolution TEXT,
  p_expected_session_id TEXT DEFAULT NULL,
  p_expected_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  result TEXT,
  updated_at TIMESTAMPTZ,
  pending_resolution_kind TEXT,
  refresh_session_step TEXT
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.v2_commitment%ROWTYPE;
  v_resolution TEXT;
  v_session JSONB;
  v_session_step TEXT;
  v_session_id TEXT;
  v_started_at TEXT;
  v_channel TEXT;
  v_clarifications_remaining INTEGER;
  v_event_idempotency_key TEXT;
  v_event_resolution TEXT;
  v_next_refresh_session JSONB;
  v_pending_kind TEXT;
  v_pending_created_at TIMESTAMPTZ;
  v_pending_expires_at TIMESTAMPTZ;
  v_pending_payload JSONB;
BEGIN
  v_resolution := lower(trim(coalesce(p_resolution, '')));
  IF v_resolution NOT IN ('still', 'change', 'clarify_identity', 'aborted_unclear') THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  SELECT *
  INTO v_row
  FROM public.v2_commitment
  WHERE id = p_commitment_id
    AND clerk_user_id = p_clerk_user_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::TIMESTAMPTZ, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF p_expected_updated_at IS NOT NULL
     AND v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at, v_row.pending_resolution_kind, NULL::TEXT;
    RETURN;
  END IF;

  IF v_row.refresh_session IS NULL OR jsonb_typeof(v_row.refresh_session) <> 'object' THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at, v_row.pending_resolution_kind, NULL::TEXT;
    RETURN;
  END IF;

  v_session := v_row.refresh_session;
  v_session_step := trim(coalesce(v_session->>'step', ''));
  v_session_id := trim(coalesce(v_session->>'session_id', ''));
  IF v_session_step <> 'identity' OR v_session_id = '' THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at, v_row.pending_resolution_kind, NULL::TEXT;
    RETURN;
  END IF;
  IF p_expected_session_id IS NOT NULL
     AND trim(p_expected_session_id) <> ''
     AND trim(p_expected_session_id) <> v_session_id THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at, v_row.pending_resolution_kind, v_session_step;
    RETURN;
  END IF;

  v_event_resolution := CASE
    WHEN v_resolution = 'clarify_identity' THEN 'clarify_identity'
    ELSE v_resolution
  END;
  v_event_idempotency_key := format(
    'v2_coaching_refresh_resolved:%s:%s:%s:%s:%s',
    p_commitment_id::TEXT,
    v_session_id,
    'identity',
    v_event_resolution,
    trim(coalesce(p_inbound_message_sid, 'none'))
  );

  IF EXISTS (
    SELECT 1
    FROM public.v2_commitment_event
    WHERE idempotency_key = v_event_idempotency_key
  ) THEN
    RETURN QUERY SELECT
      'already_applied'::TEXT,
      v_row.updated_at,
      v_row.pending_resolution_kind,
      v_session_step;
    RETURN;
  END IF;

  v_pending_kind := NULL;
  v_pending_created_at := NULL;
  v_pending_expires_at := NULL;
  v_pending_payload := NULL;
  v_next_refresh_session := NULL;

  IF v_resolution = 'still' THEN
    v_started_at := to_char(p_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    v_channel := coalesce(v_session->>'channel', 'sms');
    v_clarifications_remaining := COALESCE((v_session->>'clarifications_remaining')::INTEGER, 1);
    v_next_refresh_session := jsonb_build_object(
      'session_id', v_session_id,
      'step', 'commitment',
      'started_at', v_started_at,
      'channel', v_channel,
      'clarifications_remaining', GREATEST(0, v_clarifications_remaining),
      'commitment_prompt_delivered', false
    );
  ELSIF v_resolution = 'change' THEN
    v_pending_kind := 'identity_anchor_update';
    v_pending_created_at := p_now;
    v_pending_expires_at := p_now + interval '7 days';
    v_pending_payload := jsonb_build_object(
      'source', 'coaching_refresh_resolved',
      'resolution', 'change',
      'session_id', v_session_id,
      'inbound_message_sid', trim(coalesce(p_inbound_message_sid, ''))
    );
  ELSIF v_resolution = 'clarify_identity' THEN
    v_started_at := coalesce(v_session->>'started_at', to_char(p_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    v_channel := coalesce(v_session->>'channel', 'sms');
    v_clarifications_remaining := COALESCE((v_session->>'clarifications_remaining')::INTEGER, 0);
    IF v_clarifications_remaining <= 0 THEN
      RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at, v_row.pending_resolution_kind, v_session_step;
      RETURN;
    END IF;
    v_next_refresh_session := jsonb_build_object(
      'session_id', v_session_id,
      'step', 'identity',
      'started_at', v_started_at,
      'channel', v_channel,
      'clarifications_remaining', v_clarifications_remaining - 1,
      'commitment_prompt_delivered', (v_session->>'commitment_prompt_delivered') = 'true'
    );
  END IF;

  INSERT INTO public.v2_commitment_event (
    commitment_id,
    clerk_user_id,
    event_type,
    occurred_at,
    source,
    payload_json,
    idempotency_key
  )
  VALUES (
    p_commitment_id,
    p_clerk_user_id,
    'coaching_refresh_resolved',
    p_now,
    'sms_v2_accountability',
    jsonb_build_object(
      'session_id', v_session_id,
      'step', 'identity',
      'resolution', v_event_resolution,
      'inbound_message_sid', trim(coalesce(p_inbound_message_sid, ''))
    ),
    v_event_idempotency_key
  );

  UPDATE public.v2_commitment
  SET refresh_session = v_next_refresh_session,
      pending_resolution_kind = v_pending_kind,
      pending_resolution_created_at = v_pending_created_at,
      pending_resolution_expires_at = v_pending_expires_at,
      pending_resolution_payload = v_pending_payload,
      updated_at = p_now
  WHERE id = p_commitment_id
  RETURNING
    public.v2_commitment.updated_at,
    public.v2_commitment.pending_resolution_kind,
    CASE
      WHEN public.v2_commitment.refresh_session IS NULL THEN NULL
      ELSE trim(coalesce(public.v2_commitment.refresh_session->>'step', ''))
    END
  INTO
    v_row.updated_at,
    v_row.pending_resolution_kind,
    v_session_step;

  RETURN QUERY SELECT
    'applied'::TEXT,
    v_row.updated_at,
    v_row.pending_resolution_kind,
    v_session_step;
END;
$$;

COMMENT ON FUNCTION public.v2_apply_refresh_identity_step_resolution_mutation(
  UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) IS 'Transactional wrapper for V2 refresh identity-step resolution (still/change/clarify_identity/aborted_unclear): validates session state, inserts coaching_refresh_resolved, mutates refresh_session, and sets/clears pending_resolution atomically.';

-- >>> migration: 20260507150000_v2_refresh_prompted_post_send_wrapper.sql

-- V2 refresh post-send prompted bookkeeping wrapper.
-- Atomic bundle after successful outbound refresh SMS send:
-- - validate active commitment/session state
-- - persist refresh_session progression
-- - update prompted timestamp field(s)
-- - insert coaching_refresh_prompted event

CREATE OR REPLACE FUNCTION public.v2_apply_refresh_prompted_post_send_bookkeeping_mutation(
  p_commitment_id UUID,
  p_clerk_user_id TEXT,
  p_message_sid TEXT,
  p_prompt_step TEXT,
  p_prompt_kind TEXT,
  p_body_preview TEXT,
  p_next_refresh_session JSONB,
  p_expected_session_id TEXT DEFAULT NULL,
  p_expected_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  result TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.v2_commitment%ROWTYPE;
  v_prompt_step TEXT;
  v_prompt_kind TEXT;
  v_message_sid TEXT;
  v_event_idempotency_key TEXT;
  v_current_session_id TEXT;
BEGIN
  v_prompt_step := lower(trim(coalesce(p_prompt_step, '')));
  v_prompt_kind := lower(trim(coalesce(p_prompt_kind, '')));
  v_message_sid := trim(coalesce(p_message_sid, ''));

  IF v_prompt_step NOT IN ('identity', 'commitment') THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;
  IF v_prompt_kind NOT IN ('identity_first', 'identity_reminder', 'commitment_daily') THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;
  IF v_message_sid = '' THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;
  IF p_next_refresh_session IS NULL OR jsonb_typeof(p_next_refresh_session) <> 'object' THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT *
  INTO v_row
  FROM public.v2_commitment
  WHERE id = p_commitment_id
    AND clerk_user_id = p_clerk_user_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF p_expected_updated_at IS NOT NULL
     AND v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at;
    RETURN;
  END IF;

  IF p_expected_session_id IS NOT NULL AND trim(p_expected_session_id) <> '' THEN
    IF v_row.refresh_session IS NULL OR jsonb_typeof(v_row.refresh_session) <> 'object' THEN
      RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at;
      RETURN;
    END IF;
    v_current_session_id := trim(coalesce(v_row.refresh_session->>'session_id', ''));
    IF v_current_session_id = '' OR v_current_session_id <> trim(p_expected_session_id) THEN
      RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at;
      RETURN;
    END IF;
  END IF;

  v_event_idempotency_key := format(
    'v2_coaching_refresh_prompted:%s:%s:%s:%s',
    p_commitment_id::TEXT,
    trim(coalesce(p_next_refresh_session->>'session_id', '')),
    v_prompt_step,
    v_message_sid
  );

  IF EXISTS (
    SELECT 1
    FROM public.v2_commitment_event
    WHERE idempotency_key = v_event_idempotency_key
  ) THEN
    RETURN QUERY SELECT 'already_applied'::TEXT, v_row.updated_at;
    RETURN;
  END IF;

  UPDATE public.v2_commitment
  SET refresh_session = p_next_refresh_session,
      commitment_refresh_last_prompted_at = CASE
        WHEN v_prompt_kind = 'commitment_daily' THEN p_now
        ELSE public.v2_commitment.commitment_refresh_last_prompted_at
      END,
      updated_at = p_now
  WHERE id = p_commitment_id
  RETURNING public.v2_commitment.updated_at INTO v_row.updated_at;

  IF v_prompt_kind = 'identity_first' OR v_prompt_kind = 'identity_reminder' THEN
    UPDATE public.user_profiles
    SET identity_refresh_last_prompted_at = p_now
    WHERE clerk_user_id = p_clerk_user_id;
  END IF;

  INSERT INTO public.v2_commitment_event (
    commitment_id,
    clerk_user_id,
    event_type,
    occurred_at,
    source,
    payload_json,
    idempotency_key
  )
  VALUES (
    p_commitment_id,
    p_clerk_user_id,
    'coaching_refresh_prompted',
    p_now,
    'sms_v2_accountability',
    jsonb_build_object(
      'session_id', trim(coalesce(p_next_refresh_session->>'session_id', '')),
      'step', v_prompt_step,
      'message_sid', v_message_sid,
      'body_preview', left(coalesce(p_body_preview, ''), 160)
    ),
    v_event_idempotency_key
  );

  RETURN QUERY SELECT 'applied'::TEXT, v_row.updated_at;
END;
$$;

COMMENT ON FUNCTION public.v2_apply_refresh_prompted_post_send_bookkeeping_mutation(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) IS 'Transactional wrapper for post-send refresh bookkeeping: validates state, writes refresh_session progression, updates prompted timestamp fields, and inserts coaching_refresh_prompted atomically.';

-- >>> migration: 20260508120000_v2_refresh_outbound_intent_snapshot.sql

-- V2 refresh outbound deterministic replay source.
-- Persist exact outbound intent snapshot at post-send bookkeeping boundary.

CREATE TABLE IF NOT EXISTS v2_refresh_outbound_intent_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id UUID NOT NULL REFERENCES v2_commitment(id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  message_sid TEXT NOT NULL,
  refresh_session_id TEXT NOT NULL,
  refresh_step TEXT NOT NULL CHECK (refresh_step IN ('identity', 'commitment')),
  prompt_kind TEXT NOT NULL CHECK (prompt_kind IN ('identity_first', 'identity_reminder', 'commitment_daily')),
  body_preview TEXT NOT NULL DEFAULT '',
  intended_next_refresh_session JSONB NOT NULL,
  expected_session_id TEXT NULL,
  expected_updated_at TIMESTAMPTZ NULL,
  source_wrapped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS v2_refresh_outbound_intent_snapshot_key_idx
  ON v2_refresh_outbound_intent_snapshot (commitment_id, refresh_session_id, refresh_step, message_sid);

CREATE INDEX IF NOT EXISTS v2_refresh_outbound_intent_snapshot_commitment_time_idx
  ON v2_refresh_outbound_intent_snapshot (commitment_id, source_wrapped_at DESC);

CREATE OR REPLACE FUNCTION public.v2_apply_refresh_prompted_post_send_bookkeeping_mutation(
  p_commitment_id UUID,
  p_clerk_user_id TEXT,
  p_message_sid TEXT,
  p_prompt_step TEXT,
  p_prompt_kind TEXT,
  p_body_preview TEXT,
  p_next_refresh_session JSONB,
  p_expected_session_id TEXT DEFAULT NULL,
  p_expected_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  result TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.v2_commitment%ROWTYPE;
  v_prompt_step TEXT;
  v_prompt_kind TEXT;
  v_message_sid TEXT;
  v_event_idempotency_key TEXT;
  v_current_session_id TEXT;
  v_next_session_id TEXT;
BEGIN
  v_prompt_step := lower(trim(coalesce(p_prompt_step, '')));
  v_prompt_kind := lower(trim(coalesce(p_prompt_kind, '')));
  v_message_sid := trim(coalesce(p_message_sid, ''));
  v_next_session_id := trim(coalesce(p_next_refresh_session->>'session_id', ''));

  IF v_prompt_step NOT IN ('identity', 'commitment') THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;
  IF v_prompt_kind NOT IN ('identity_first', 'identity_reminder', 'commitment_daily') THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;
  IF v_message_sid = '' THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;
  IF p_next_refresh_session IS NULL OR jsonb_typeof(p_next_refresh_session) <> 'object' THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;
  IF v_next_session_id = '' THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT *
  INTO v_row
  FROM public.v2_commitment
  WHERE id = p_commitment_id
    AND clerk_user_id = p_clerk_user_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF p_expected_updated_at IS NOT NULL
     AND v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at;
    RETURN;
  END IF;

  IF p_expected_session_id IS NOT NULL AND trim(p_expected_session_id) <> '' THEN
    IF v_row.refresh_session IS NULL OR jsonb_typeof(v_row.refresh_session) <> 'object' THEN
      RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at;
      RETURN;
    END IF;
    v_current_session_id := trim(coalesce(v_row.refresh_session->>'session_id', ''));
    IF v_current_session_id = '' OR v_current_session_id <> trim(p_expected_session_id) THEN
      RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at;
      RETURN;
    END IF;
  END IF;

  v_event_idempotency_key := format(
    'v2_coaching_refresh_prompted:%s:%s:%s:%s',
    p_commitment_id::TEXT,
    v_next_session_id,
    v_prompt_step,
    v_message_sid
  );

  IF EXISTS (
    SELECT 1
    FROM public.v2_commitment_event
    WHERE idempotency_key = v_event_idempotency_key
  ) THEN
    RETURN QUERY SELECT 'already_applied'::TEXT, v_row.updated_at;
    RETURN;
  END IF;

  INSERT INTO public.v2_refresh_outbound_intent_snapshot (
    commitment_id,
    clerk_user_id,
    message_sid,
    refresh_session_id,
    refresh_step,
    prompt_kind,
    body_preview,
    intended_next_refresh_session,
    expected_session_id,
    expected_updated_at,
    source_wrapped_at
  )
  VALUES (
    p_commitment_id,
    p_clerk_user_id,
    v_message_sid,
    v_next_session_id,
    v_prompt_step,
    v_prompt_kind,
    left(coalesce(p_body_preview, ''), 160),
    p_next_refresh_session,
    nullif(trim(coalesce(p_expected_session_id, '')), ''),
    p_expected_updated_at,
    p_now
  )
  ON CONFLICT (commitment_id, refresh_session_id, refresh_step, message_sid) DO NOTHING;

  UPDATE public.v2_commitment
  SET refresh_session = p_next_refresh_session,
      commitment_refresh_last_prompted_at = CASE
        WHEN v_prompt_kind = 'commitment_daily' THEN p_now
        ELSE public.v2_commitment.commitment_refresh_last_prompted_at
      END,
      updated_at = p_now
  WHERE id = p_commitment_id
  RETURNING public.v2_commitment.updated_at INTO v_row.updated_at;

  IF v_prompt_kind = 'identity_first' OR v_prompt_kind = 'identity_reminder' THEN
    UPDATE public.user_profiles
    SET identity_refresh_last_prompted_at = p_now
    WHERE clerk_user_id = p_clerk_user_id;
  END IF;

  INSERT INTO public.v2_commitment_event (
    commitment_id,
    clerk_user_id,
    event_type,
    occurred_at,
    source,
    payload_json,
    idempotency_key
  )
  VALUES (
    p_commitment_id,
    p_clerk_user_id,
    'coaching_refresh_prompted',
    p_now,
    'sms_v2_accountability',
    jsonb_build_object(
      'session_id', v_next_session_id,
      'step', v_prompt_step,
      'message_sid', v_message_sid,
      'body_preview', left(coalesce(p_body_preview, ''), 160)
    ),
    v_event_idempotency_key
  );

  RETURN QUERY SELECT 'applied'::TEXT, v_row.updated_at;
END;
$$;

COMMENT ON TABLE v2_refresh_outbound_intent_snapshot IS 'Deterministic source-of-truth snapshots for refresh outbound intent captured at post-send bookkeeping time.';

COMMENT ON FUNCTION public.v2_apply_refresh_prompted_post_send_bookkeeping_mutation(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) IS 'Transactional wrapper for post-send refresh bookkeeping: validates state, stores deterministic outbound intent snapshot, writes refresh_session progression, updates prompted timestamps, and inserts coaching_refresh_prompted atomically.';

-- >>> migration: 20260508150000_v2_check_sent_post_send_wrapper.sql

-- V2 standard accountability outbound deterministic post-send bookkeeping.
-- Scope: canonical check_sent spine write + deterministic outbound intent snapshot.

CREATE TABLE IF NOT EXISTS v2_check_sent_outbound_intent_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id UUID NOT NULL REFERENCES v2_commitment(id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  message_sid TEXT NOT NULL,
  template_id INTEGER NOT NULL,
  template_family TEXT NOT NULL CHECK (template_family IN ('standard', 'recovery')),
  body_preview TEXT NOT NULL DEFAULT '',
  effective_ask_text TEXT NOT NULL DEFAULT '',
  prompt_kind TEXT NOT NULL CHECK (prompt_kind IN ('standard_accountability', 'contract_overlay_proposal')),
  expected_reply_semantics TEXT NOT NULL CHECK (expected_reply_semantics IN ('yes_no_partial', 'proposal_yes_no')),
  check_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL,
  source_wrapped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS v2_check_sent_outbound_intent_snapshot_key_idx
  ON v2_check_sent_outbound_intent_snapshot (idempotency_key);

CREATE INDEX IF NOT EXISTS v2_check_sent_outbound_intent_snapshot_commitment_time_idx
  ON v2_check_sent_outbound_intent_snapshot (commitment_id, source_wrapped_at DESC);

COMMENT ON TABLE v2_check_sent_outbound_intent_snapshot IS 'Deterministic source-of-truth snapshots for standard V2 accountability check_sent post-send bookkeeping.';


-- >>> migration: 20260508170000_v2_guided_commitment_replace_wrapper.sql

-- V2 guided resolution: DB-atomic commitment replacement wrapper.
-- Scope: commitment_replace only.

CREATE OR REPLACE FUNCTION public.v2_apply_guided_commitment_replace_mutation(
  p_old_commitment_id UUID,
  p_clerk_user_id TEXT,
  p_new_behavior_statement TEXT,
  p_expected_old_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  result TEXT,
  old_commitment_id UUID,
  new_commitment_id UUID
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_old public.v2_commitment%ROWTYPE;
  v_new_id UUID;
  v_now TIMESTAMPTZ;
  v_new_behavior TEXT;
  v_created_key TEXT;
  v_activated_key TEXT;
BEGIN
  v_now := coalesce(p_now, now());
  v_new_behavior := trim(coalesce(p_new_behavior_statement, ''));

  IF v_new_behavior = '' THEN
    RETURN QUERY SELECT 'error'::TEXT, p_old_commitment_id, NULL::UUID;
    RETURN;
  END IF;

  -- Idempotent retry winner: replacement already exists and is currently active.
  SELECT c.id
  INTO v_new_id
  FROM public.v2_commitment c
  WHERE c.clerk_user_id = p_clerk_user_id
    AND c.status = 'active'
    AND c.supersedes_commitment_id = p_old_commitment_id
  ORDER BY c.started_at DESC
  LIMIT 1;

  IF v_new_id IS NOT NULL THEN
    RETURN QUERY SELECT 'already_applied'::TEXT, p_old_commitment_id, v_new_id;
    RETURN;
  END IF;

  SELECT *
  INTO v_old
  FROM public.v2_commitment
  WHERE id = p_old_commitment_id
    AND clerk_user_id = p_clerk_user_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT, p_old_commitment_id, NULL::UUID;
    RETURN;
  END IF;

  IF p_expected_old_updated_at IS NOT NULL
     AND v_old.updated_at IS DISTINCT FROM p_expected_old_updated_at THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, p_old_commitment_id, NULL::UUID;
    RETURN;
  END IF;

  IF v_old.pending_resolution_kind IS DISTINCT FROM 'commitment_replace' THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, p_old_commitment_id, NULL::UUID;
    RETURN;
  END IF;

  -- 1) Supersede old active chapter and clear pending state atomically.
  UPDATE public.v2_commitment
  SET status = 'superseded',
      ended_at = v_now,
      pending_resolution_kind = NULL,
      pending_resolution_created_at = NULL,
      pending_resolution_expires_at = NULL,
      pending_resolution_payload = NULL,
      updated_at = v_now
  WHERE id = v_old.id;

  -- 2) Insert new active chapter with explicit lineage fields.
  INSERT INTO public.v2_commitment (
    clerk_user_id,
    status,
    title,
    commitment_type,
    behavior_statement,
    success_criteria,
    cadence_kind,
    tone_preference,
    reachability_window,
    source,
    started_at,
    updated_at,
    supersedes_commitment_id,
    evolution_kind,
    evolution_reason_code,
    pending_resolution_kind,
    pending_resolution_created_at,
    pending_resolution_expires_at,
    pending_resolution_payload
  )
  VALUES (
    v_old.clerk_user_id,
    'active',
    v_old.title,
    v_old.commitment_type,
    v_new_behavior,
    v_old.success_criteria,
    coalesce(v_old.cadence_kind, 'daily'),
    v_old.tone_preference,
    coalesce(v_old.reachability_window, '{}'::jsonb),
    'guided_resolution_v2',
    v_now,
    v_now,
    v_old.id,
    'replace',
    'guided_resolution_new',
    NULL,
    NULL,
    NULL,
    NULL
  )
  RETURNING id INTO v_new_id;

  -- 3) Canonical chapter transition events (new row).
  v_created_key := format('guided_resolution_replace_created:%s', v_new_id::TEXT);
  v_activated_key := format('guided_resolution_replace_activated:%s', v_new_id::TEXT);

  INSERT INTO public.v2_commitment_event (
    commitment_id,
    clerk_user_id,
    event_type,
    occurred_at,
    source,
    payload_json,
    idempotency_key
  )
  VALUES (
    v_new_id,
    v_old.clerk_user_id,
    'created',
    v_now,
    'guided_resolution_v2',
    jsonb_build_object(
      'supersedes_commitment_id', v_old.id,
      'evolution_kind', 'replace',
      'evolution_reason_code', 'guided_resolution_new'
    ),
    v_created_key
  );

  INSERT INTO public.v2_commitment_event (
    commitment_id,
    clerk_user_id,
    event_type,
    occurred_at,
    source,
    payload_json,
    idempotency_key
  )
  VALUES (
    v_new_id,
    v_old.clerk_user_id,
    'activated',
    v_now,
    'guided_resolution_v2',
    jsonb_build_object(
      'supersedes_commitment_id', v_old.id,
      'evolution_kind', 'replace',
      'evolution_reason_code', 'guided_resolution_new'
    ),
    v_activated_key
  );

  RETURN QUERY SELECT 'applied'::TEXT, v_old.id, v_new_id;
END;
$$;

COMMENT ON FUNCTION public.v2_apply_guided_commitment_replace_mutation(
  UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) IS 'Transactional wrapper for guided commitment replacement: validates active+pending replacement state, supersedes old chapter, inserts new active chapter with lineage, and writes created/activated events atomically.';

-- >>> migration: 20260509120000_v2_proposal_mode_atomic_check_sent_bookkeeping.sql

-- Atomic proposal-mode outbound bookkeeping: check_sent + snapshot + contract_overlay_proposed
-- + v2_commitment pending proposal columns in one transaction (removes split-brain vs separate persist).
-- NOTE: no SAVEPOINT / ROLLBACK TO SAVEPOINT (unsafe for this RPC under PostgREST); compensating DELETEs on conflict.

CREATE OR REPLACE FUNCTION public.v2_apply_check_sent_post_send_bookkeeping_mutation(
  p_commitment_id UUID,
  p_clerk_user_id TEXT,
  p_day_key TEXT,
  p_message_sid TEXT,
  p_template_id INTEGER,
  p_template_family TEXT,
  p_body_preview TEXT,
  p_effective_ask_text TEXT,
  p_prompt_kind TEXT,
  p_expected_reply_semantics TEXT,
  p_check_payload_json JSONB DEFAULT '{}'::jsonb,
  p_now TIMESTAMPTZ DEFAULT now(),
  p_include_contract_overlay_proposal BOOLEAN DEFAULT FALSE,
  p_proposal_text TEXT DEFAULT NULL,
  p_contract_kind TEXT DEFAULT NULL
)
RETURNS TABLE (
  result TEXT
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.v2_commitment%ROWTYPE;
  v_day_key TEXT;
  v_message_sid TEXT;
  v_template_family TEXT;
  v_prompt_kind TEXT;
  v_expected_reply_semantics TEXT;
  v_idempotency_key TEXT;
  v_proposed_key TEXT;
  v_payload JSONB;
  v_has_check BOOLEAN;
  v_has_proposed BOOLEAN;
  v_proposal_plain TEXT;
  v_contract_kind TEXT;
  v_proposal_expires TIMESTAMPTZ;
  v_proposed_payload JSONB;
  v_updated INT;
  v_snapshot_id UUID;
BEGIN
  v_day_key := trim(coalesce(p_day_key, ''));
  v_message_sid := trim(coalesce(p_message_sid, ''));
  v_template_family := lower(trim(coalesce(p_template_family, '')));
  v_prompt_kind := lower(trim(coalesce(p_prompt_kind, '')));
  v_expected_reply_semantics := lower(trim(coalesce(p_expected_reply_semantics, '')));

  IF v_day_key = '' OR v_message_sid = '' THEN
    RETURN QUERY SELECT 'error'::TEXT;
    RETURN;
  END IF;
  IF p_template_id IS NULL OR p_template_id <= 0 THEN
    RETURN QUERY SELECT 'error'::TEXT;
    RETURN;
  END IF;
  IF v_template_family NOT IN ('standard', 'recovery') THEN
    RETURN QUERY SELECT 'error'::TEXT;
    RETURN;
  END IF;
  IF v_prompt_kind NOT IN ('standard_accountability', 'contract_overlay_proposal') THEN
    RETURN QUERY SELECT 'error'::TEXT;
    RETURN;
  END IF;
  IF v_expected_reply_semantics NOT IN ('yes_no_partial', 'proposal_yes_no') THEN
    RETURN QUERY SELECT 'error'::TEXT;
    RETURN;
  END IF;
  IF p_check_payload_json IS NULL OR jsonb_typeof(p_check_payload_json) <> 'object' THEN
    RETURN QUERY SELECT 'error'::TEXT;
    RETURN;
  END IF;

  IF p_include_contract_overlay_proposal THEN
    IF v_prompt_kind <> 'contract_overlay_proposal' THEN
      RETURN QUERY SELECT 'error'::TEXT;
      RETURN;
    END IF;
    v_proposal_plain := trim(coalesce(p_proposal_text, ''));
    v_contract_kind := lower(trim(coalesce(p_contract_kind, '')));
    IF v_proposal_plain = '' OR v_contract_kind NOT IN ('shrink_ask', 'recommit_same') THEN
      RETURN QUERY SELECT 'error'::TEXT;
      RETURN;
    END IF;
  END IF;

  SELECT *
  INTO v_row
  FROM public.v2_commitment
  WHERE id = p_commitment_id
    AND clerk_user_id = p_clerk_user_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT;
    RETURN;
  END IF;

  v_idempotency_key := format('v2_check_sent:%s:%s', p_commitment_id::TEXT, v_day_key);
  v_proposed_key := format('v2_contract_overlay_proposed:%s:%s', p_commitment_id::TEXT, v_day_key);

  SELECT EXISTS (
    SELECT 1 FROM public.v2_commitment_event
    WHERE idempotency_key = v_idempotency_key
      AND event_type = 'check_sent'
  ) INTO v_has_check;

  SELECT EXISTS (
    SELECT 1 FROM public.v2_commitment_event
    WHERE idempotency_key = v_proposed_key
      AND event_type = 'contract_overlay_proposed'
  ) INTO v_has_proposed;

  v_proposal_expires := p_now + interval '48 hours';

  v_payload := p_check_payload_json
    || jsonb_build_object(
      'day_key', v_day_key,
      'template_id', p_template_id,
      'template_family', v_template_family,
      'channel', 'sms',
      'message_sid', v_message_sid,
      'body_preview', left(coalesce(p_body_preview, ''), 160),
      'effective_ask_text', left(coalesce(p_effective_ask_text, ''), 240),
      'prompt_kind', v_prompt_kind,
      'expected_reply_semantics', v_expected_reply_semantics
    );

  -- Idempotent / repair when check_sent already exists (legacy split-brain or duplicate caller).
  IF v_has_check THEN
    IF NOT p_include_contract_overlay_proposal THEN
      RETURN QUERY SELECT 'already_applied'::TEXT;
      RETURN;
    END IF;
    IF v_prompt_kind <> 'contract_overlay_proposal' THEN
      RETURN QUERY SELECT 'already_applied'::TEXT;
      RETURN;
    END IF;

    IF v_has_proposed THEN
      IF trim(coalesce(v_row.adaptive_proposal_text, '')) = v_proposal_plain THEN
        RETURN QUERY SELECT 'already_applied'::TEXT;
      ELSE
        RETURN QUERY SELECT 'state_conflict'::TEXT;
      END IF;
      RETURN;
    END IF;

    IF trim(coalesce(v_row.adaptive_ask_text, '')) <> '' THEN
      RETURN QUERY SELECT 'state_conflict'::TEXT;
      RETURN;
    END IF;
    IF v_row.adaptive_proposal_text IS NOT NULL
       AND trim(coalesce(v_row.adaptive_proposal_text, '')) <> v_proposal_plain THEN
      RETURN QUERY SELECT 'state_conflict'::TEXT;
      RETURN;
    END IF;

    v_proposed_payload := jsonb_build_object(
      'contract_kind', v_contract_kind,
      'proposal_text', v_proposal_plain,
      'proposal_expires_at', v_proposal_expires,
      'day_key', v_day_key,
      'message_sid', v_message_sid,
      'proposal_ttl_hours', 48
    );

    INSERT INTO public.v2_commitment_event (
      commitment_id,
      clerk_user_id,
      event_type,
      occurred_at,
      source,
      payload_json,
      idempotency_key
    )
    VALUES (
      p_commitment_id,
      p_clerk_user_id,
      'contract_overlay_proposed',
      p_now,
      'sms_v2_accountability',
      v_proposed_payload,
      v_proposed_key
    );

    UPDATE public.v2_commitment
    SET
      adaptive_proposal_text = v_proposal_plain,
      adaptive_proposal_created_at = p_now,
      adaptive_proposal_expires_at = v_proposal_expires,
      updated_at = p_now
    WHERE id = p_commitment_id
      AND clerk_user_id = p_clerk_user_id
      AND status = 'active'
      AND (
        (adaptive_proposal_text IS NULL AND adaptive_ask_text IS NULL)
        OR trim(coalesce(adaptive_proposal_text, '')) = v_proposal_plain
      );

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      DELETE FROM public.v2_commitment_event
      WHERE idempotency_key = v_proposed_key
        AND event_type = 'contract_overlay_proposed'
        AND commitment_id = p_commitment_id
        AND clerk_user_id = p_clerk_user_id;
      RETURN QUERY SELECT 'state_conflict'::TEXT;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'applied'::TEXT;
    RETURN;
  END IF;

  -- Fresh path: snapshot + check_sent (+ proposal bundle when requested).
  IF p_include_contract_overlay_proposal THEN
    IF v_row.adaptive_proposal_text IS NOT NULL OR v_row.adaptive_ask_text IS NOT NULL THEN
      RETURN QUERY SELECT 'state_conflict'::TEXT;
      RETURN;
    END IF;
  END IF;

  v_snapshot_id := NULL;

  INSERT INTO public.v2_check_sent_outbound_intent_snapshot (
    commitment_id,
    clerk_user_id,
    day_key,
    message_sid,
    template_id,
    template_family,
    body_preview,
    effective_ask_text,
    prompt_kind,
    expected_reply_semantics,
    check_payload_json,
    idempotency_key,
    source_wrapped_at
  )
  VALUES (
    p_commitment_id,
    p_clerk_user_id,
    v_day_key,
    v_message_sid,
    p_template_id,
    v_template_family,
    left(coalesce(p_body_preview, ''), 160),
    left(coalesce(p_effective_ask_text, ''), 240),
    v_prompt_kind,
    v_expected_reply_semantics,
    v_payload,
    v_idempotency_key,
    p_now
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_snapshot_id;

  INSERT INTO public.v2_commitment_event (
    commitment_id,
    clerk_user_id,
    event_type,
    occurred_at,
    source,
    payload_json,
    idempotency_key
  )
  VALUES (
    p_commitment_id,
    p_clerk_user_id,
    'check_sent',
    p_now,
    'sms_v2_accountability',
    v_payload,
    v_idempotency_key
  );

  IF p_include_contract_overlay_proposal THEN
    v_proposed_payload := jsonb_build_object(
      'contract_kind', v_contract_kind,
      'proposal_text', v_proposal_plain,
      'proposal_expires_at', v_proposal_expires,
      'day_key', v_day_key,
      'message_sid', v_message_sid,
      'proposal_ttl_hours', 48
    );

    INSERT INTO public.v2_commitment_event (
      commitment_id,
      clerk_user_id,
      event_type,
      occurred_at,
      source,
      payload_json,
      idempotency_key
    )
    VALUES (
      p_commitment_id,
      p_clerk_user_id,
      'contract_overlay_proposed',
      p_now,
      'sms_v2_accountability',
      v_proposed_payload,
      v_proposed_key
    );

    UPDATE public.v2_commitment
    SET
      adaptive_proposal_text = v_proposal_plain,
      adaptive_proposal_created_at = p_now,
      adaptive_proposal_expires_at = v_proposal_expires,
      updated_at = p_now
    WHERE id = p_commitment_id
      AND clerk_user_id = p_clerk_user_id
      AND status = 'active'
      AND adaptive_proposal_text IS NULL
      AND adaptive_ask_text IS NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      DELETE FROM public.v2_commitment_event
      WHERE idempotency_key = v_proposed_key
        AND event_type = 'contract_overlay_proposed'
        AND commitment_id = p_commitment_id
        AND clerk_user_id = p_clerk_user_id;
      DELETE FROM public.v2_commitment_event
      WHERE idempotency_key = v_idempotency_key
        AND event_type = 'check_sent'
        AND commitment_id = p_commitment_id
        AND clerk_user_id = p_clerk_user_id;
      IF v_snapshot_id IS NOT NULL THEN
        DELETE FROM public.v2_check_sent_outbound_intent_snapshot
        WHERE id = v_snapshot_id;
      END IF;
      RETURN QUERY SELECT 'state_conflict'::TEXT;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT 'applied'::TEXT;
END;
$$;

COMMENT ON FUNCTION public.v2_apply_check_sent_post_send_bookkeeping_mutation(
  UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ, BOOLEAN, TEXT, TEXT
) IS 'Transactional wrapper for V2 check_sent post-send: snapshot + check_sent; optional atomic contract_overlay_proposed + pending proposal columns for proposal-mode SMS. Supports repair when check_sent exists without proposal bundle.';


COMMIT;
