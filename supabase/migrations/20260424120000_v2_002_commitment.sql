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
