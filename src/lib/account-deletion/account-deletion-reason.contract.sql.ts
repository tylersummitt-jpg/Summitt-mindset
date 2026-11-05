/**
 * Authoritative deletion-reason database contract: 2026-11-05-deletion-reason-v1.
 * The application calls these names and does not execute this script.
 * PROPOSAL — DO NOT RUN against production until ChatGPT and Tyler approve it.
 */

export const ACCOUNT_DELETION_REASON_SQL = String.raw`
-- PROPOSAL — DO NOT RUN.
-- Contract: 2026-11-05-deletion-reason-v1
-- No trigger. No change to account_deletion_requests.
-- No aggregated flag. No comment. No Clerk id on the new tables.
-- A completed reason is counted and unlinked in one function transaction.

BEGIN;

CREATE TABLE public.account_deletion_reason_pending (
  request_id uuid PRIMARY KEY
    REFERENCES public.account_deletion_requests (id) ON DELETE CASCADE,
  reason_code text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  CONSTRAINT account_deletion_reason_pending_code_chk CHECK (
    reason_code IN (
      'not_using',
      'no_results',
      'too_expensive',
      'coach_pat_texts',
      'hard_to_use',
      'no_longer_need',
      'something_else',
      'prefer_not_to_say',
      'skipped'
    )
  )
);

COMMENT ON TABLE public.account_deletion_reason_pending IS
  'Temporary reason for one open deletion. Removed when counted, when the job fails terminally, at the fixed 30-day expiry, or with the parent row.';

CREATE INDEX account_deletion_reason_pending_expires_at_idx
  ON public.account_deletion_reason_pending (expires_at);

CREATE TABLE public.account_deletion_reason_counts (
  reason_code text PRIMARY KEY,
  completed_count integer NOT NULL,
  CONSTRAINT account_deletion_reason_counts_code_chk CHECK (
    reason_code IN (
      'not_using',
      'no_results',
      'too_expensive',
      'coach_pat_texts',
      'hard_to_use',
      'no_longer_need',
      'something_else',
      'prefer_not_to_say',
      'skipped'
    )
  ),
  CONSTRAINT account_deletion_reason_counts_count_chk CHECK (completed_count >= 0)
);

COMMENT ON TABLE public.account_deletion_reason_counts IS
  'Anonymous totals. No member id, comment, request id, or event time.';

CREATE OR REPLACE FUNCTION public.record_account_deletion_reason(
  p_clerk_user_id text,
  p_reason_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_status text;
BEGIN
  IF p_clerk_user_id IS NULL
     OR length(trim(p_clerk_user_id)) = 0
     OR p_reason_code NOT IN (
       'not_using',
       'no_results',
       'too_expensive',
       'coach_pat_texts',
       'hard_to_use',
       'no_longer_need',
       'something_else',
       'prefer_not_to_say',
       'skipped'
     ) THEN
    RETURN;
  END IF;

  SELECT id, status
    INTO v_id, v_status
  FROM public.account_deletion_requests
  WHERE clerk_user_id = trim(p_clerk_user_id)
    AND status <> 'completed'
  FOR UPDATE;

  IF NOT FOUND OR v_status = 'failed_terminal' THEN
    RETURN;
  END IF;

  INSERT INTO public.account_deletion_reason_pending (request_id, reason_code)
  VALUES (v_id, p_reason_code)
  ON CONFLICT (request_id) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.record_account_deletion_reason(text, text) IS
  'Lock this member''s open deletion row and store the first reason only while it is still open. Does not write account_deletion_requests. Refuses completed and failed_terminal rows.';

CREATE OR REPLACE FUNCTION public.settle_account_deletion_reasons(
  p_limit integer DEFAULT 25
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_status text;
  v_handled integer := 0;
  v_limit integer := coalesce(p_limit, 25);
BEGIN
  IF v_limit < 1 OR v_limit > 25 THEN
    v_limit := 25;
  END IF;

  BEGIN
    PERFORM set_config('statement_timeout', '2000', true);
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  FOR v_row IN
    SELECT p.request_id, p.reason_code, p.expires_at
    FROM public.account_deletion_reason_pending AS p
    LEFT JOIN public.account_deletion_requests AS r
      ON r.id = p.request_id
    WHERE p.expires_at <= now()
       OR r.id IS NULL
       OR r.status IN ('completed', 'failed_terminal')
    ORDER BY p.expires_at
    LIMIT v_limit
    FOR UPDATE OF p SKIP LOCKED
  LOOP
    SELECT status
      INTO v_status
    FROM public.account_deletion_requests
    WHERE id = v_row.request_id;

    IF v_row.expires_at <= now()
       OR v_status IS NULL
       OR v_status = 'failed_terminal' THEN
      DELETE FROM public.account_deletion_reason_pending
      WHERE request_id = v_row.request_id;
      v_handled := v_handled + 1;
    ELSIF v_status = 'completed' THEN
      INSERT INTO public.account_deletion_reason_counts (reason_code, completed_count)
      VALUES (v_row.reason_code, 1)
      ON CONFLICT (reason_code) DO UPDATE
        SET completed_count = public.account_deletion_reason_counts.completed_count + 1;

      DELETE FROM public.account_deletion_reason_pending
      WHERE request_id = v_row.request_id;
      v_handled := v_handled + 1;
    END IF;
  END LOOP;

  RETURN v_handled;
END;
$$;

COMMENT ON FUNCTION public.settle_account_deletion_reasons(integer) IS
  'Count and unlink at most 25 completed reasons, or unlink expired, failed, and orphaned rows. An expired reason is never counted. Does not lock or write account_deletion_requests.';

CREATE VIEW public.account_deletion_reason_report
WITH (security_invoker = true) AS
WITH reasons AS (
  SELECT *
  FROM (
    VALUES
      ('not_using'),
      ('no_results'),
      ('too_expensive'),
      ('coach_pat_texts'),
      ('hard_to_use'),
      ('no_longer_need'),
      ('something_else'),
      ('prefer_not_to_say'),
      ('skipped')
  ) AS codes (reason_code)
),
joined AS (
  SELECT
    reasons.reason_code,
    coalesce(counts.completed_count, 0)::bigint AS reason_count
  FROM reasons
  LEFT JOIN public.account_deletion_reason_counts AS counts
    ON counts.reason_code = reasons.reason_code
),
totals AS (
  SELECT
    coalesce(sum(reason_count), 0)::bigint AS recorded_total,
    coalesce(bool_or(reason_count BETWEEN 1 AND 4), false) AS any_small
  FROM joined
),
completed AS (
  SELECT count(*)::bigint AS completed_total
  FROM public.account_deletion_requests
  WHERE status = 'completed'
),
decision AS (
  SELECT
    completed.completed_total,
    totals.recorded_total,
    (completed.completed_total - totals.recorded_total) AS missing_total,
    (
      totals.any_small
      OR totals.recorded_total BETWEEN 1 AND 4
      OR (completed.completed_total - totals.recorded_total) BETWEEN 1 AND 4
      OR totals.recorded_total > completed.completed_total
    ) AS breakdown_withheld
  FROM totals
  CROSS JOIN completed
)
SELECT
  joined.reason_code,
  decision.completed_total,
  CASE
    WHEN decision.breakdown_withheld THEN NULL
    ELSE decision.recorded_total
  END AS recorded_total,
  CASE
    WHEN decision.breakdown_withheld THEN NULL
    ELSE decision.missing_total
  END AS missing_total,
  CASE
    WHEN decision.breakdown_withheld THEN NULL
    ELSE joined.reason_count
  END AS reason_count,
  decision.breakdown_withheld
FROM joined
CROSS JOIN decision;

COMMENT ON VIEW public.account_deletion_reason_report IS
  'Completed deletions always. The whole reason breakdown is null when showing any part would expose a count of 1 to 4. Null means withheld, not zero.';

ALTER TABLE public.account_deletion_reason_pending ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_reason_counts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.account_deletion_reason_pending FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.account_deletion_reason_counts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.account_deletion_reason_report FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_account_deletion_reason(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_account_deletion_reasons(integer) FROM PUBLIC, anon, authenticated;

GRANT SELECT, DELETE ON TABLE public.account_deletion_reason_pending TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.account_deletion_reason_counts TO service_role;
GRANT SELECT ON TABLE public.account_deletion_reason_report TO service_role;
GRANT EXECUTE ON FUNCTION public.record_account_deletion_reason(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_account_deletion_reasons(integer) TO service_role;

COMMIT;
`;

export const ACCOUNT_DELETION_REASON_VERIFICATION_SQL = String.raw`
-- PROPOSAL — DO NOT RUN until the contract script is applied. Reads only.

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'account_deletion_reason_pending',
    'account_deletion_reason_counts'
  )
ORDER BY table_name, ordinal_position;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'account_deletion_requests'
  AND column_name IN ('id', 'status');

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'account_deletion_reason_pending';

SELECT tgname, relname
FROM pg_trigger
JOIN pg_class ON pg_class.oid = pg_trigger.tgrelid
JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
WHERE nspname = 'public'
  AND relname IN (
    'account_deletion_requests',
    'account_deletion_reason_pending',
    'account_deletion_reason_counts'
  )
  AND NOT tgisinternal;

SELECT
  proname,
  prosecdef AS security_definer,
  position('update public.account_deletion_requests' in lower(pg_get_functiondef(oid))) AS updates_parent,
  position('for update' in lower(pg_get_functiondef(oid))) AS locks_a_row
FROM pg_proc
JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
WHERE nspname = 'public'
  AND proname IN (
    'record_account_deletion_reason',
    'settle_account_deletion_reasons'
  );

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'account_deletion_reason_pending'
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY grantee, privilege_type;
`;

export const ACCOUNT_DELETION_REASON_ROLLBACK_SQL = String.raw`
-- PROPOSAL — DO NOT RUN unless the contract script was applied and must be removed.
BEGIN;

DROP FUNCTION IF EXISTS public.settle_account_deletion_reasons(integer);
DROP FUNCTION IF EXISTS public.record_account_deletion_reason(text, text);
DROP VIEW IF EXISTS public.account_deletion_reason_report;
DROP TABLE IF EXISTS public.account_deletion_reason_pending;
DROP TABLE IF EXISTS public.account_deletion_reason_counts;

COMMIT;
`;
