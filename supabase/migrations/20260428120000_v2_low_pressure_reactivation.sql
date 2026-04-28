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
