-- APP-041B1: durable account-deletion request state (foundation only).
-- Additive empty table + lease/CAS RPCs. No production data backfill.
-- No SMS/Stripe/Clerk mutations. No endpoint in APP-041B1.
-- Access: server-side service-role only (Clerk-authenticated Next.js routes later).
-- Direct anon/authenticated table/RPC access is intentionally revoked.
-- No client RLS policies are created.
--
-- Rollback (before any production use):
--   DROP FUNCTION IF EXISTS public.cas_account_deletion_request(UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN);
--   DROP FUNCTION IF EXISTS public.acquire_account_deletion_lease(UUID, TEXT, INTEGER);
--   DROP TABLE IF EXISTS public.account_deletion_requests;

CREATE TABLE account_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  orchestration_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'requested',
  current_step TEXT NOT NULL DEFAULT 'requested',
  steps JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  locked_at TIMESTAMPTZ NULL,
  lock_owner TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  last_retry_at TIMESTAMPTZ NULL,
  last_error_code TEXT NULL,
  last_error_detail TEXT NULL,
  sms_result TEXT NULL,
  stripe_result TEXT NULL,
  purge_result TEXT NULL,
  clerk_result TEXT NULL,
  idempotency_key TEXT NOT NULL,

  CONSTRAINT account_deletion_requests_orchestration_version_chk
    CHECK (orchestration_version >= 1),
  CONSTRAINT account_deletion_requests_attempt_count_chk
    CHECK (attempt_count >= 0),
  CONSTRAINT account_deletion_requests_status_chk CHECK (
    status IN (
      'requested',
      'suppressing_sms',
      'sms_suppressed',
      'canceling_subscription',
      'subscription_canceled',
      'purging_app_data',
      'app_data_purged',
      'deleting_clerk',
      'completed',
      'failed_retryable',
      'failed_terminal'
    )
  ),
  CONSTRAINT account_deletion_requests_current_step_chk CHECK (
    current_step IN (
      'requested',
      'suppressing_sms',
      'sms_suppressed',
      'canceling_subscription',
      'subscription_canceled',
      'purging_app_data',
      'app_data_purged',
      'deleting_clerk',
      'completed',
      'failed_retryable',
      'failed_terminal'
    )
  ),
  CONSTRAINT account_deletion_requests_sms_result_chk CHECK (
    sms_result IS NULL
    OR sms_result IN ('pending', 'ok', 'skipped', 'already_done', 'failed')
  ),
  CONSTRAINT account_deletion_requests_stripe_result_chk CHECK (
    stripe_result IS NULL
    OR stripe_result IN ('pending', 'ok', 'skipped', 'already_done', 'failed')
  ),
  CONSTRAINT account_deletion_requests_purge_result_chk CHECK (
    purge_result IS NULL
    OR purge_result IN ('pending', 'ok', 'skipped', 'already_done', 'failed')
  ),
  CONSTRAINT account_deletion_requests_clerk_result_chk CHECK (
    clerk_result IS NULL
    OR clerk_result IN ('pending', 'ok', 'skipped', 'already_done', 'failed')
  ),
  CONSTRAINT account_deletion_requests_idempotency_key_nonempty CHECK (
    length(trim(idempotency_key)) > 0
  ),
  CONSTRAINT account_deletion_requests_clerk_user_id_nonempty CHECK (
    length(trim(clerk_user_id)) > 0
  )
);

COMMENT ON TABLE account_deletion_requests IS
  'APP-041 durable account-deletion orchestration state. '
  'Service-role / server routes only. No endpoint in APP-041B1. '
  'One unresolved request per clerk_user_id (status <> completed). '
  'Idempotency: unique (clerk_user_id, idempotency_key) is permanent — '
  'same key after completed returns that historical row; a new deletion needs a new key. '
  'Do not store raw phone, email, tokens, or journal/SMS bodies.';

-- One unresolved request per user (failed_retryable and failed_terminal remain blocking).
CREATE UNIQUE INDEX account_deletion_requests_one_unresolved_per_user
  ON account_deletion_requests (clerk_user_id)
  WHERE status <> 'completed';

-- Idempotency scoped to the owning user (keys must not cross users).
CREATE UNIQUE INDEX account_deletion_requests_user_idempotency
  ON account_deletion_requests (clerk_user_id, idempotency_key);

-- Future reconciliation scans.
CREATE INDEX account_deletion_requests_status_updated_at
  ON account_deletion_requests (status, updated_at);

ALTER TABLE account_deletion_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE account_deletion_requests FROM anon;
REVOKE ALL ON TABLE account_deletion_requests FROM authenticated;
REVOKE ALL ON TABLE account_deletion_requests FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Atomic lease acquisition using database now() (not caller wall clock).
-- Two concurrent workers: only one UPDATE can win the row; the other returns 0 rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acquire_account_deletion_lease(
  p_request_id UUID,
  p_lock_owner TEXT,
  p_lease_ms INTEGER DEFAULT 120000
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
  IF p_request_id IS NULL OR length(v_owner) = 0 THEN
    RETURN;
  END IF;
  -- Bound lease duration to avoid absurd / overflow intervals.
  IF v_lease_ms < 1000 OR v_lease_ms > 3600000 THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.account_deletion_requests AS r
  SET
    lock_owner = v_owner,
    locked_at = now(),
    attempt_count = r.attempt_count + 1,
    updated_at = now()
  WHERE r.id = p_request_id
    AND r.orchestration_version = 1
    AND r.status NOT IN ('completed', 'failed_terminal')
    AND (
      r.lock_owner IS NULL
      OR r.locked_at IS NULL
      OR r.lock_owner = v_owner
      OR r.locked_at < (now() - (v_lease_ms::double precision * INTERVAL '1 millisecond'))
    )
  RETURNING r.*;
END;
$$;

COMMENT ON FUNCTION public.acquire_account_deletion_lease(UUID, TEXT, INTEGER) IS
  'APP-041B1: atomic lease acquire/refresh using server now(). Service-role only.';

-- ---------------------------------------------------------------------------
-- Compare-and-set update that requires an active lease (server now() freshness).
-- ---------------------------------------------------------------------------
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
  p_release_lock BOOLEAN DEFAULT false
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
    locked_at = CASE WHEN p_release_lock THEN NULL ELSE r.locked_at END
  WHERE r.id = p_request_id
    AND r.status = p_expected_status
    AND r.orchestration_version = p_expected_orchestration_version
    AND r.lock_owner = v_owner
    AND r.locked_at IS NOT NULL
    AND r.locked_at >= (now() - (v_lease_ms::double precision * INTERVAL '1 millisecond'))
  RETURNING r.*;
END;
$$;

COMMENT ON FUNCTION public.cas_account_deletion_request(UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN) IS
  'APP-041B1: CAS status/step update requiring active lease (server now()). Service-role only.';

REVOKE ALL ON FUNCTION public.acquire_account_deletion_lease(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acquire_account_deletion_lease(UUID, TEXT, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.acquire_account_deletion_lease(UUID, TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_account_deletion_lease(UUID, TEXT, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.cas_account_deletion_request(UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cas_account_deletion_request(UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.cas_account_deletion_request(UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cas_account_deletion_request(UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN) TO service_role;
