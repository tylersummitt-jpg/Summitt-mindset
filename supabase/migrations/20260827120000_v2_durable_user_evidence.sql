-- Durable exact user-stated historical evidence (Commit 2).
-- Additive. Service-role-only. One row per inbound MessageSid.
-- Table/grants/trigger are repository source history for the production-installed table.
-- Do not run this file against production; production is already installed and verified.

CREATE TABLE public.v2_durable_user_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  source_message_sid TEXT NOT NULL,
  exact_user_evidence TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  hidden_at TIMESTAMPTZ NULL,
  hidden_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT v2_durable_user_evidence_status_chk CHECK (
    status IN ('active', 'hidden')
  ),
  CONSTRAINT v2_durable_user_evidence_exact_len_chk CHECK (
    char_length(exact_user_evidence) > 0 AND char_length(exact_user_evidence) <= 400
  ),
  CONSTRAINT v2_durable_user_evidence_sid_chk CHECK (
    length(trim(source_message_sid)) > 0
  ),
  CONSTRAINT v2_durable_user_evidence_clerk_chk CHECK (
    length(trim(clerk_user_id)) > 0
  ),
  CONSTRAINT v2_durable_user_evidence_hidden_reason_len_chk CHECK (
    hidden_reason IS NULL OR char_length(hidden_reason) <= 240
  )
);

CREATE UNIQUE INDEX uq_v2_durable_user_evidence_source_message_sid
  ON public.v2_durable_user_evidence (source_message_sid);

CREATE INDEX idx_v2_durable_user_evidence_clerk_status_occurred
  ON public.v2_durable_user_evidence (clerk_user_id, status, occurred_at ASC);

COMMENT ON TABLE public.v2_durable_user_evidence IS
  'Rare exact user-stated relationship truths. Sol owns English meaning; server owns substring grounding, SID, timestamp, and load caps.';

ALTER TABLE public.v2_durable_user_evidence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.v2_durable_user_evidence FROM PUBLIC;
REVOKE ALL ON TABLE public.v2_durable_user_evidence FROM anon;
REVOKE ALL ON TABLE public.v2_durable_user_evidence FROM authenticated;

GRANT ALL PRIVILEGES
ON TABLE public.v2_durable_user_evidence
TO service_role;

GRANT SELECT
ON TABLE public.v2_durable_user_evidence
TO readonly_user;

CREATE OR REPLACE FUNCTION public.set_v2_durable_user_evidence_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_v2_durable_user_evidence_updated_at
  BEFORE UPDATE ON public.v2_durable_user_evidence
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_v2_durable_user_evidence_updated_at();

-- ---------------------------------------------------------------------------
-- Account deletion (repository contract only — do not REPLACE the live RPC here).
--
-- Production public.purge_app_data_for_account_deletion was patched from the
-- live production function definition and verified. A historical CREATE OR
-- REPLACE copied from 20260810140000_v2_win_media.sql would clobber newer
-- production purge behavior if this file were ever applied.
--
-- Production-verified snippet, V2 user-level content, immediately before v2_win:
--   DELETE FROM public.v2_durable_user_evidence WHERE clerk_user_id = v_clerk;
--   GET DIAGNOSTICS v_n = ROW_COUNT;
--   v_counts := v_counts || jsonb_build_object('durable_user_evidence', v_n);
--   v_total := v_total + v_n;
--
-- Then production continues with:
--   DELETE FROM public.v2_win WHERE clerk_user_id = v_clerk;
-- ---------------------------------------------------------------------------
