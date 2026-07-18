-- APP-041B2a: atomic SMS suppression for account deletion (no endpoint).
-- Additive: extend CAS with sms_result; add suppress_sms_for_account_deletion RPC.
-- Does NOT insert STOP evidence, phone hashes, or HMAC secrets.
-- Does NOT delete sms_inbound_messages (real STOP rows must remain).
--
-- Rollback (before production use):
--   DROP FUNCTION IF EXISTS public.suppress_sms_for_account_deletion(TEXT, UUID);
--   DROP FUNCTION IF EXISTS public.cas_account_deletion_request(UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TEXT, BOOLEAN);
--   -- then restore prior CAS signature from 20260718120000_account_deletion_requests.sql if needed

-- ---------------------------------------------------------------------------
-- Extend CAS to optionally persist sms_result (B2a). Replace prior signature.
-- p_set_sms_result=true requires a non-null valid sms_result (cannot clear to NULL).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cas_account_deletion_request(
  UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN
);
DROP FUNCTION IF EXISTS public.cas_account_deletion_request(
  UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TEXT, BOOLEAN
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
  p_set_sms_result BOOLEAN DEFAULT false
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

COMMENT ON FUNCTION public.cas_account_deletion_request(UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TEXT, BOOLEAN) IS
  'APP-041B2a: CAS with optional non-null sms_result. Active lease + server now(). Service-role only.';

REVOKE ALL ON FUNCTION public.cas_account_deletion_request(UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cas_account_deletion_request(UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TEXT, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.cas_account_deletion_request(UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TEXT, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cas_account_deletion_request(UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TEXT, BOOLEAN) TO service_role;

-- ---------------------------------------------------------------------------
-- Atomic local SMS unbind for account deletion (no phone returned, no STOP insert).
-- Cancels every nonterminal coach-job status that can still lead to a send.
-- Terminal statuses left alone: sent, cancelled.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.suppress_sms_for_account_deletion(
  p_clerk_user_id TEXT,
  p_deletion_request_id UUID
)
RETURNS TABLE (result TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_clerk TEXT := trim(coalesce(p_clerk_user_id, ''));
  v_req public.account_deletion_requests%ROWTYPE;
  v_identity_exists BOOLEAN := false;
BEGIN
  IF length(v_clerk) = 0 THEN
    RAISE EXCEPTION 'invalid_clerk_user_id'
      USING ERRCODE = '22023';
  END IF;
  IF p_deletion_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_deletion_request_id'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_req
  FROM public.account_deletion_requests AS r
  WHERE r.id = p_deletion_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_request_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_req.clerk_user_id IS DISTINCT FROM v_clerk THEN
    RAISE EXCEPTION 'account_deletion_request_user_mismatch'
      USING ERRCODE = '22023';
  END IF;

  IF v_req.orchestration_version IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'unsupported_orchestration_version'
      USING ERRCODE = '22023';
  END IF;

  IF v_req.status IS DISTINCT FROM 'suppressing_sms' THEN
    RAISE EXCEPTION 'account_deletion_request_not_suppressing_sms'
      USING ERRCODE = '22023';
  END IF;

  IF v_req.current_step IS DISTINCT FROM 'suppressing_sms' THEN
    RAISE EXCEPTION 'account_deletion_request_current_step_mismatch'
      USING ERRCODE = '22023';
  END IF;

  -- Lock live identity if present (PK is phone_number; lock via clerk_user_id unique).
  PERFORM 1
  FROM public.sms_identities AS i
  WHERE i.clerk_user_id = v_clerk
  FOR UPDATE;

  v_identity_exists := FOUND;

  DELETE FROM public.sms_audience
  WHERE clerk_user_id = v_clerk;

  -- Cancel every status that can still progress to a Twilio send.
  -- Proven statuses from sms-inbound-coach processor (no persisted "claimed").
  UPDATE public.sms_inbound_coach_jobs
  SET
    status = 'cancelled',
    last_error = 'account_deletion_sms_suppress',
    updated_at = now(),
    next_retry_at = 'infinity'::timestamptz
  WHERE clerk_user_id = v_clerk
    AND status NOT IN ('sent', 'cancelled');

  DELETE FROM public.sms_identities
  WHERE clerk_user_id = v_clerk;

  -- Durable unlink evidence in the same transaction as identity deletion.
  -- No phone / email / clerk id / Twilio id in the marker.
  IF v_identity_exists THEN
    UPDATE public.account_deletion_requests AS r
    SET
      steps = coalesce(r.steps, '{}'::jsonb) || jsonb_build_object(
        'sms_binding_removed',
        jsonb_build_object(
          'ok', true,
          'code', 'identity_removed',
          'at', to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )
      ),
      updated_at = now()
    WHERE r.id = p_deletion_request_id;

    RETURN QUERY SELECT 'removed'::TEXT;
  ELSE
    RETURN QUERY SELECT 'already_absent'::TEXT;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.suppress_sms_for_account_deletion(TEXT, UUID) IS
  'APP-041B2a: atomically remove sms_audience + cancel nonterminal coach jobs + delete sms_identities. '
  'No STOP insert. No phone returned. Service-role only.';

REVOKE ALL ON FUNCTION public.suppress_sms_for_account_deletion(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.suppress_sms_for_account_deletion(TEXT, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.suppress_sms_for_account_deletion(TEXT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.suppress_sms_for_account_deletion(TEXT, UUID) TO service_role;
