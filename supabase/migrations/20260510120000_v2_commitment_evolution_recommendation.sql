-- V1 Commitment Evolution Engine: auditable recommendation rows (dashboard-first).
-- One pending row per commitment (partial unique). Supersede preserves history.

CREATE TABLE public.v2_commitment_evolution_recommendation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  commitment_id UUID NOT NULL REFERENCES public.v2_commitment (id) ON DELETE CASCADE,
  engine_version TEXT NOT NULL DEFAULT 'v1',
  recommended_action TEXT NOT NULL,
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ NULL,
  superseded_at TIMESTAMPTZ NULL,
  CONSTRAINT v2_evolution_rec_action_chk CHECK (
    recommended_action IN (
      'keep_commitment',
      'adapt_commitment_temporary',
      'tighten_commitment',
      'reframe_commitment',
      'replace_commitment',
      'refresh_commitment_only'
    )
  ),
  CONSTRAINT v2_evolution_rec_status_chk CHECK (
    status IN ('pending', 'accepted', 'dismissed', 'superseded')
  )
);

CREATE INDEX idx_v2_evolution_rec_commitment_created
  ON public.v2_commitment_evolution_recommendation (commitment_id, created_at DESC);

CREATE INDEX idx_v2_evolution_rec_clerk_created
  ON public.v2_commitment_evolution_recommendation (clerk_user_id, created_at DESC);

CREATE UNIQUE INDEX uq_v2_evolution_rec_one_pending_per_commitment
  ON public.v2_commitment_evolution_recommendation (commitment_id)
  WHERE status = 'pending';

COMMENT ON TABLE public.v2_commitment_evolution_recommendation IS
  'V1 evolution engine: one pending recommendation per commitment; superseded rows retained for audit.';
