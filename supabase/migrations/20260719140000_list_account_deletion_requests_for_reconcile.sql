-- APP-041E3b: bounded ID-only discovery for future account-deletion reconciliation.
-- Read-only SELECT. Does NOT acquire leases, mutate rows, call providers, or schedule work.
-- failed_retryable backoff base: GREATEST(COALESCE(last_retry_at, updated_at), updated_at)
--   (later of retry-start and most recent row activity / failure timestamp).
-- Migration created for review; DO NOT apply until independently reviewed.
-- After apply, manually run: NOTIFY pgrst, 'reload schema';
-- Do NOT embed NOTIFY here (project migrations do not use that convention).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.list_account_deletion_requests_for_reconcile(INTEGER, INTEGER, TIMESTAMPTZ);

DROP FUNCTION IF EXISTS public.list_account_deletion_requests_for_reconcile(INTEGER, INTEGER, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.list_account_deletion_requests_for_reconcile(
  p_limit INTEGER DEFAULT 1,
  p_lease_ms INTEGER DEFAULT 120000,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (request_id UUID)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
  v_lease_ms INTEGER;
  v_now TIMESTAMPTZ := coalesce(p_now, now());
BEGIN
  -- Match acquire_account_deletion_lease bounds; invalid → no rows (fail closed).
  v_lease_ms := coalesce(p_lease_ms, 120000);
  IF v_lease_ms < 1000 OR v_lease_ms > 3600000 THEN
    RETURN;
  END IF;

  -- Limit: NULL → default 1; <1 → no rows; >10 → clamp to 10.
  IF p_limit IS NULL THEN
    v_limit := 1;
  ELSIF p_limit < 1 THEN
    RETURN;
  ELSIF p_limit > 10 THEN
    v_limit := 10;
  ELSE
    v_limit := p_limit;
  END IF;

  RETURN QUERY
  SELECT r.id AS request_id
  FROM public.account_deletion_requests AS r
  WHERE r.orchestration_version = 1
    AND (
      (
        r.status = r.current_step
        AND r.status IN (
          'requested',
          'suppressing_sms',
          'sms_suppressed',
          'canceling_subscription',
          'subscription_canceled',
          'purging_app_data',
          'app_data_purged',
          'deleting_clerk'
        )
      )
      OR (
        r.status = 'failed_retryable'
        AND r.current_step IN (
          'suppressing_sms',
          'canceling_subscription',
          'purging_app_data',
          'deleting_clerk'
        )
      )
    )
    -- Exact acquire lease-freshness (without same-owner refresh): free or expired.
    AND (
      r.lock_owner IS NULL
      OR r.locked_at IS NULL
      OR r.locked_at < (v_now - (v_lease_ms::double precision * INTERVAL '1 millisecond'))
    )
    AND (
      CASE
        WHEN r.status = 'failed_retryable' THEN
          -- Later of retry-start and most recent row activity (updated_at NOT NULL).
          GREATEST(COALESCE(r.last_retry_at, r.updated_at), r.updated_at)
          + CASE
              WHEN r.attempt_count < 3 THEN INTERVAL '5 minutes'
              WHEN r.attempt_count <= 5 THEN INTERVAL '15 minutes'
              WHEN r.attempt_count <= 9 THEN INTERVAL '30 minutes'
              ELSE INTERVAL '60 minutes'
            END
        ELSE r.updated_at
      END
    ) <= v_now
  ORDER BY
    CASE
      WHEN r.status = 'failed_retryable' THEN
        GREATEST(COALESCE(r.last_retry_at, r.updated_at), r.updated_at)
        + CASE
            WHEN r.attempt_count < 3 THEN INTERVAL '5 minutes'
            WHEN r.attempt_count <= 5 THEN INTERVAL '15 minutes'
            WHEN r.attempt_count <= 9 THEN INTERVAL '30 minutes'
            ELSE INTERVAL '60 minutes'
          END
      ELSE r.updated_at
    END ASC,
    r.updated_at ASC,
    r.id ASC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.list_account_deletion_requests_for_reconcile(INTEGER, INTEGER, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_account_deletion_requests_for_reconcile(INTEGER, INTEGER, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.list_account_deletion_requests_for_reconcile(INTEGER, INTEGER, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.list_account_deletion_requests_for_reconcile(INTEGER, INTEGER, TIMESTAMPTZ) TO service_role;
