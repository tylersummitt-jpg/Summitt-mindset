-- One row per Meta ad account so a manual refresh and the scheduled import
-- cannot fetch at the same time, and a finished run waits five minutes.
-- Each claim receives its own lock token. Only that owner can release the lock.
-- Delivery is still written only by ad_lab_import_batch.
-- This does not alter ad_lab_ads, ad_lab_daily_delivery, or that function.
-- The Meta token never enters the database. No dynamic SQL.
-- search_path is pg_catalog only. Tables are schema-qualified.

CREATE TABLE public.ad_lab_import_guard (
  account_id TEXT PRIMARY KEY,
  lock_token UUID NULL,
  running_since TIMESTAMPTZ NULL,
  last_attempt_at TIMESTAMPTZ NULL,
  last_success_at TIMESTAMPTZ NULL,
  CONSTRAINT ad_lab_import_guard_account_chk CHECK (account_id ~ '^[0-9]{5,20}$')
);

COMMENT ON TABLE public.ad_lab_import_guard IS
  'Import lock and last success for one Meta ad account. '
  'Service role may read it. Only ad_lab_claim_import and ad_lab_finish_import write it.';

ALTER TABLE public.ad_lab_import_guard ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ad_lab_import_guard FROM anon;
REVOKE ALL ON TABLE public.ad_lab_import_guard FROM authenticated;
REVOKE ALL ON TABLE public.ad_lab_import_guard FROM PUBLIC;
REVOKE ALL ON TABLE public.ad_lab_import_guard FROM service_role;
GRANT SELECT ON TABLE public.ad_lab_import_guard TO service_role;

-- Returns busy, cooldown, or the new lock token.
-- A live run stays busy for 2 hours, including a run that takes longer than
-- 3 minutes. The server limit is 60 seconds, so a live run normally finishes
-- and clears its own lock. A crashed run stops blocking well before the next
-- scheduled import, which is about 10 hours later.
-- Five minutes matches the refresh cooldown in the app.

CREATE OR REPLACE FUNCTION public.ad_lab_claim_import(p_account_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_running timestamptz;
  v_attempt timestamptz;
  v_token uuid;
BEGIN
  IF p_account_id IS NULL OR p_account_id !~ '^[0-9]{5,20}$' THEN
    RAISE EXCEPTION 'ad_lab_import_invalid_account'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ad_lab_import_guard (account_id)
  VALUES (p_account_id)
  ON CONFLICT (account_id) DO NOTHING;

  SELECT running_since, last_attempt_at
    INTO v_running, v_attempt
  FROM public.ad_lab_import_guard
  WHERE account_id = p_account_id
  FOR UPDATE;

  IF v_running IS NOT NULL AND v_running > pg_catalog.now() - interval '2 hours' THEN
    RETURN 'busy';
  END IF;

  IF v_attempt IS NOT NULL AND v_attempt > pg_catalog.now() - interval '5 minutes' THEN
    RETURN 'cooldown';
  END IF;

  v_token := pg_catalog.gen_random_uuid();

  UPDATE public.ad_lab_import_guard
  SET
    running_since = pg_catalog.now(),
    lock_token = v_token
  WHERE account_id = p_account_id;

  RETURN v_token::text;
END;
$function$;

-- Updates the guard only when p_token is still the current owner.
-- A delayed finish from an older import does not clear a newer lock
-- and does not change that newer import's success timestamp.

CREATE OR REPLACE FUNCTION public.ad_lab_finish_import(
  p_account_id text,
  p_token uuid,
  p_succeeded boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_account_id IS NULL OR p_account_id !~ '^[0-9]{5,20}$' THEN
    RAISE EXCEPTION 'ad_lab_import_invalid_account'
      USING ERRCODE = '22023';
  END IF;

  IF p_token IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.ad_lab_import_guard
  SET
    running_since = NULL,
    lock_token = NULL,
    last_attempt_at = pg_catalog.now(),
    last_success_at = CASE
      WHEN p_succeeded THEN pg_catalog.now()
      ELSE last_success_at
    END
  WHERE account_id = p_account_id
    AND lock_token = p_token;
END;
$function$;

REVOKE ALL ON FUNCTION public.ad_lab_claim_import(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_lab_claim_import(text) TO service_role;

REVOKE ALL ON FUNCTION public.ad_lab_finish_import(text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_lab_finish_import(text, uuid, boolean) TO service_role;
