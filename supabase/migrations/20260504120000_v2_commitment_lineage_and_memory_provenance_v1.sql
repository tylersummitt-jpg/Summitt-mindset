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
