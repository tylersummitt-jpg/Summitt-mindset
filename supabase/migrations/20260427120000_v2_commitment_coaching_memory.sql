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
