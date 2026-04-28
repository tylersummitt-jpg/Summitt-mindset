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
