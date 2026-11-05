/**
 * Deletion-comment database contract: 2026-11-05-deletion-comment-v1.
 * The application calls these names and does not execute this script.
 * PROPOSAL — DO NOT RUN until Tyler executes it manually.
 * Does not alter the deletion-reason objects or account_deletion_requests.
 */

export const ACCOUNT_DELETION_COMMENT_SQL = String.raw`
-- PROPOSAL — DO NOT RUN.
-- Contract: 2026-11-05-deletion-comment-v1
-- No trigger. No change to account_deletion_requests.
-- No change to the deletion-reason tables or functions.
-- A temporary note is tied to the open deletion only until settlement.
-- The kept note has no member id, email, or deletion-request id.

BEGIN;

CREATE TABLE public.account_deletion_comment_pending (
  request_id uuid PRIMARY KEY
    REFERENCES public.account_deletion_requests (id) ON DELETE CASCADE,
  message text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  CONSTRAINT account_deletion_comment_pending_message_chk CHECK (
    char_length(message) BETWEEN 1 AND 2000
  )
);

COMMENT ON TABLE public.account_deletion_comment_pending IS
  'Temporary opted-in note for one open deletion. Removed when kept, when the job fails terminally, at the fixed 30-day expiry, or with the parent row.';

CREATE INDEX account_deletion_comment_pending_expires_at_idx
  ON public.account_deletion_comment_pending (expires_at);

CREATE TABLE public.account_deletion_comments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message text NOT NULL,
  retained_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_deletion_comments_message_chk CHECK (
    char_length(message) BETWEEN 1 AND 2000
  )
);

COMMENT ON TABLE public.account_deletion_comments IS
  'Notes a member chose to keep after deletion. No member id, email, account id, or deletion-request id.';

CREATE INDEX account_deletion_comments_retained_at_idx
  ON public.account_deletion_comments (retained_at DESC);

CREATE OR REPLACE FUNCTION public.record_account_deletion_comment(
  p_clerk_user_id text,
  p_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_status text;
  v_message text := trim(coalesce(p_message, ''));
BEGIN
  IF p_clerk_user_id IS NULL
     OR length(trim(p_clerk_user_id)) = 0
     OR char_length(v_message) < 1
     OR char_length(v_message) > 2000 THEN
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

  INSERT INTO public.account_deletion_comment_pending (request_id, message)
  VALUES (v_id, v_message)
  ON CONFLICT (request_id) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.record_account_deletion_comment(text, text) IS
  'Lock this member''s open deletion row and store the first opted-in note only while it is still open. Does not write account_deletion_requests. Refuses completed and failed_terminal rows.';

CREATE OR REPLACE FUNCTION public.settle_account_deletion_comments(
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
    SELECT p.request_id, p.message, p.expires_at
    FROM public.account_deletion_comment_pending AS p
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
      DELETE FROM public.account_deletion_comment_pending
      WHERE request_id = v_row.request_id;
      v_handled := v_handled + 1;
    ELSIF v_status = 'completed' THEN
      INSERT INTO public.account_deletion_comments (message)
      VALUES (v_row.message);

      DELETE FROM public.account_deletion_comment_pending
      WHERE request_id = v_row.request_id;
      v_handled := v_handled + 1;
    END IF;
  END LOOP;

  RETURN v_handled;
END;
$$;

COMMENT ON FUNCTION public.settle_account_deletion_comments(integer) IS
  'Keep and unlink at most 25 completed notes, or unlink expired, failed, and orphaned notes. An expired note is never kept. Does not lock or write account_deletion_requests.';

ALTER TABLE public.account_deletion_comment_pending ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_comments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.account_deletion_comment_pending FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.account_deletion_comments FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_account_deletion_comment(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_account_deletion_comments(integer) FROM PUBLIC, anon, authenticated;

GRANT SELECT, DELETE ON TABLE public.account_deletion_comment_pending TO service_role;
GRANT SELECT, INSERT ON TABLE public.account_deletion_comments TO service_role;
GRANT EXECUTE ON FUNCTION public.record_account_deletion_comment(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_account_deletion_comments(integer) TO service_role;

COMMIT;
`;

export const ACCOUNT_DELETION_COMMENT_VERIFICATION_SQL = String.raw`
-- PROPOSAL — DO NOT RUN until the contract script is applied. Reads only.

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'account_deletion_comment_pending',
    'account_deletion_comments'
  )
ORDER BY table_name, ordinal_position;

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'account_deletion_comments'
  AND column_name IN ('clerk_user_id', 'email', 'request_id');

SELECT
  proname,
  prosecdef AS security_definer,
  position('update public.account_deletion_requests' in lower(pg_get_functiondef(oid))) AS updates_parent
FROM pg_proc
JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
WHERE nspname = 'public'
  AND proname IN (
    'record_account_deletion_comment',
    'settle_account_deletion_comments'
  );
`;

export const ACCOUNT_DELETION_COMMENT_ROLLBACK_SQL = String.raw`
-- PROPOSAL — DO NOT RUN unless the comment contract was applied and must be removed.
BEGIN;

DROP FUNCTION IF EXISTS public.settle_account_deletion_comments(integer);
DROP FUNCTION IF EXISTS public.record_account_deletion_comment(text, text);
DROP TABLE IF EXISTS public.account_deletion_comment_pending;
DROP TABLE IF EXISTS public.account_deletion_comments;

COMMIT;
`;
