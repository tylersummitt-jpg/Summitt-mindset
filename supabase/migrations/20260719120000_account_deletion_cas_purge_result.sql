-- APP-041C2: extend CAS to optionally persist purge_result (mirrors B3a stripe_result).
-- Additive only. Does NOT purge app data, expose HTTP, or delete Clerk/Stripe.
--
-- Rollback (before production use):
--   DROP FUNCTION IF EXISTS public.cas_account_deletion_request(UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN);
--   -- then restore prior CAS signature from 20260718140000_account_deletion_cas_stripe_result.sql

-- Current in-repo B3a signature (18 params):
--   UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB,
--   TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN
-- New signature adds p_purge_result + p_set_purge_result (20 params).

DROP FUNCTION IF EXISTS public.cas_account_deletion_request(
  UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN
);
DROP FUNCTION IF EXISTS public.cas_account_deletion_request(
  UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN
);

CREATE OR REPLACE FUNCTION public.cas_account_deletion_request(
  p_request_id UUID,
  p_expected_status TEXT,
  p_expected_orchestration_version INTEGER,
  p_lock_owner TEXT,
  p_lease_ms INTEGER,
  p_new_status TEXT,
  p_new_current_step TEXT,
  p_steps JSONB,
  p_last_error_code TEXT DEFAULT NULL,
  p_last_error_detail TEXT DEFAULT NULL,
  p_last_retry_at TIMESTAMPTZ DEFAULT NULL,
  p_completed_at TIMESTAMPTZ DEFAULT NULL,
  p_clear_errors BOOLEAN DEFAULT false,
  p_release_lock BOOLEAN DEFAULT false,
  p_sms_result TEXT DEFAULT NULL,
  p_set_sms_result BOOLEAN DEFAULT false,
  p_stripe_result TEXT DEFAULT NULL,
  p_set_stripe_result BOOLEAN DEFAULT false,
  p_purge_result TEXT DEFAULT NULL,
  p_set_purge_result BOOLEAN DEFAULT false
)
RETURNS SETOF public.account_deletion_requests
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_owner TEXT := trim(coalesce(p_lock_owner, ''));
  v_lease_ms INTEGER := coalesce(p_lease_ms, 120000);
BEGIN
  IF p_request_id IS NULL
     OR length(v_owner) = 0
     OR p_expected_status IS NULL
     OR p_new_status IS NULL
     OR p_new_current_step IS NULL
     OR p_steps IS NULL
     OR p_expected_orchestration_version IS NULL THEN
    RETURN;
  END IF;
  IF v_lease_ms < 1000 OR v_lease_ms > 3600000 THEN
    RETURN;
  END IF;
  IF p_set_sms_result THEN
    IF p_sms_result IS NULL
       OR p_sms_result NOT IN ('pending', 'ok', 'skipped', 'already_done', 'failed') THEN
      RETURN;
    END IF;
  END IF;
  IF p_set_stripe_result THEN
    IF p_stripe_result IS NULL
       OR p_stripe_result NOT IN ('pending', 'ok', 'skipped', 'already_done', 'failed') THEN
      RETURN;
    END IF;
  END IF;
  IF p_set_purge_result THEN
    IF p_purge_result IS NULL
       OR p_purge_result NOT IN ('pending', 'ok', 'skipped', 'already_done', 'failed') THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  UPDATE public.account_deletion_requests AS r
  SET
    status = p_new_status,
    current_step = p_new_current_step,
    steps = p_steps,
    updated_at = now(),
    last_error_code = CASE
      WHEN p_clear_errors THEN NULL
      ELSE coalesce(p_last_error_code, r.last_error_code)
    END,
    last_error_detail = CASE
      WHEN p_clear_errors THEN NULL
      ELSE coalesce(p_last_error_detail, r.last_error_detail)
    END,
    last_retry_at = coalesce(p_last_retry_at, r.last_retry_at),
    completed_at = coalesce(p_completed_at, r.completed_at),
    lock_owner = CASE WHEN p_release_lock THEN NULL ELSE r.lock_owner END,
    locked_at = CASE WHEN p_release_lock THEN NULL ELSE r.locked_at END,
    sms_result = CASE
      WHEN p_set_sms_result THEN p_sms_result
      ELSE r.sms_result
    END,
    stripe_result = CASE
      WHEN p_set_stripe_result THEN p_stripe_result
      ELSE r.stripe_result
    END,
    purge_result = CASE
      WHEN p_set_purge_result THEN p_purge_result
      ELSE r.purge_result
    END
  WHERE r.id = p_request_id
    AND r.status = p_expected_status
    AND r.orchestration_version = p_expected_orchestration_version
    AND r.lock_owner = v_owner
    AND r.locked_at IS NOT NULL
    AND r.locked_at >= (now() - (v_lease_ms::double precision * INTERVAL '1 millisecond'))
  RETURNING r.*;
END;
$$;

COMMENT ON FUNCTION public.cas_account_deletion_request(UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN) IS
  'APP-041C2: CAS with optional non-null sms_result, stripe_result, and purge_result. Active lease + server now(). Service-role only.';

REVOKE ALL ON FUNCTION public.cas_account_deletion_request(UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cas_account_deletion_request(UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.cas_account_deletion_request(UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cas_account_deletion_request(UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN) TO service_role;
