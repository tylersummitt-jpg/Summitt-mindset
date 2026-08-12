-- Victory Media: atomic Replace Photo RPC.
-- Additive. Service-role-only EXECUTE. Do NOT apply automatically — Tyler applies after review.
-- Storage object physical deletion remains an application post-commit concern.

CREATE OR REPLACE FUNCTION public.v2_replace_win_media(
  p_clerk_user_id TEXT,
  p_win_id UUID,
  p_expected_media_id UUID,
  p_new_media_id UUID,
  p_storage_master_path TEXT,
  p_storage_card_path TEXT,
  p_byte_size INTEGER,
  p_width INTEGER,
  p_height INTEGER,
  p_card_byte_size INTEGER,
  p_card_width INTEGER,
  p_card_height INTEGER,
  p_mime_type TEXT,
  p_user_selected_at TIMESTAMPTZ,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  result TEXT,
  old_media_id UUID,
  old_storage_master_path TEXT,
  old_storage_card_path TEXT,
  old_source_type TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_clerk TEXT := trim(coalesce(p_clerk_user_id, ''));
  v_master TEXT := trim(coalesce(p_storage_master_path, ''));
  v_card TEXT := trim(coalesce(p_storage_card_path, ''));
  v_mime TEXT := lower(trim(coalesce(p_mime_type, '')));
  v_win public.v2_win%ROWTYPE;
  v_old public.v2_win_media%ROWTYPE;
  v_sid TEXT;
  v_ordinal SMALLINT;
  v_job_n BIGINT := 0;
BEGIN
  IF p_win_id IS NULL
     OR length(v_clerk) = 0
     OR p_expected_media_id IS NULL
     OR p_new_media_id IS NULL
     OR length(v_master) = 0
     OR length(v_card) = 0
     OR p_byte_size IS NULL
     OR p_width IS NULL
     OR p_height IS NULL
     OR p_card_byte_size IS NULL
     OR p_card_width IS NULL
     OR p_card_height IS NULL
     OR length(v_mime) = 0
     OR p_user_selected_at IS NULL
     OR p_now IS NULL THEN
    RAISE EXCEPTION 'v2_replace_win_media_invalid_input'
      USING ERRCODE = '22023';
  END IF;

  IF v_mime IS DISTINCT FROM 'image/jpeg' THEN
    RAISE EXCEPTION 'v2_replace_win_media_invalid_mime'
      USING ERRCODE = '22023';
  END IF;

  IF p_byte_size <= 0
     OR p_width <= 0
     OR p_height <= 0
     OR p_card_byte_size <= 0
     OR p_card_width <= 0
     OR p_card_height <= 0 THEN
    RAISE EXCEPTION 'v2_replace_win_media_invalid_dimensions'
      USING ERRCODE = '22023';
  END IF;

  IF p_new_media_id = p_expected_media_id THEN
    RAISE EXCEPTION 'v2_replace_win_media_same_media_id'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_win
  FROM public.v2_win
  WHERE id = p_win_id
    AND clerk_user_id = v_clerk
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      'not_found'::TEXT,
      NULL::UUID,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT;
    RETURN;
  END IF;

  SELECT *
  INTO v_old
  FROM public.v2_win_media
  WHERE win_id = p_win_id
    AND clerk_user_id = v_clerk
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      'no_media'::TEXT,
      NULL::UUID,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT;
    RETURN;
  END IF;

  -- Idempotent replay: this uploadId already became the canonical media row.
  -- Do NOT return current paths as old_* cleanup targets.
  IF v_old.id = p_new_media_id THEN
    RETURN QUERY SELECT
      'existing'::TEXT,
      NULL::UUID,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT;
    RETURN;
  END IF;

  IF v_old.id IS DISTINCT FROM p_expected_media_id THEN
    RETURN QUERY SELECT
      'stale_conflict'::TEXT,
      v_old.id,
      v_old.storage_master_path,
      v_old.storage_card_path,
      v_old.source_type;
    RETURN;
  END IF;

  IF v_old.source_type = 'inbound_mms' THEN
    v_sid := trim(coalesce(v_old.source_message_sid, ''));
    v_ordinal := v_old.source_media_ordinal;
    IF length(v_sid) = 0 OR v_ordinal IS NULL OR v_ordinal < 0 THEN
      RAISE EXCEPTION 'v2_replace_win_media_mms_provenance_invalid'
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.v2_inbound_media_job
    SET
      status = 'tombstoned',
      tombstoned_at = p_now,
      resolution = 'removed'
    WHERE clerk_user_id = v_clerk
      AND message_sid = v_sid
      AND media_ordinal = v_ordinal;
    GET DIAGNOSTICS v_job_n = ROW_COUNT;
    IF v_job_n = 0 THEN
      RAISE EXCEPTION 'v2_replace_win_media_mms_tombstone_missing'
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_old.source_type IS DISTINCT FROM 'web_upload' THEN
    RAISE EXCEPTION 'v2_replace_win_media_unsupported_source'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.v2_win_media
  WHERE id = v_old.id
    AND win_id = p_win_id
    AND clerk_user_id = v_clerk;
  GET DIAGNOSTICS v_job_n = ROW_COUNT;
  IF v_job_n = 0 THEN
    RAISE EXCEPTION 'v2_replace_win_media_delete_missed'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.v2_win_media (
    id,
    win_id,
    clerk_user_id,
    source_type,
    source_message_sid,
    source_media_ordinal,
    twilio_media_sid,
    storage_master_path,
    storage_card_path,
    mime_type,
    byte_size,
    width,
    height,
    card_byte_size,
    card_width,
    card_height,
    user_selected_at,
    created_at,
    updated_at
  )
  VALUES (
    p_new_media_id,
    p_win_id,
    v_clerk,
    'web_upload',
    NULL,
    NULL,
    NULL,
    v_master,
    v_card,
    'image/jpeg',
    p_byte_size,
    p_width,
    p_height,
    p_card_byte_size,
    p_card_width,
    p_card_height,
    p_user_selected_at,
    p_now,
    p_now
  );

  RETURN QUERY SELECT
    'replaced'::TEXT,
    v_old.id,
    v_old.storage_master_path,
    v_old.storage_card_path,
    v_old.source_type;
END;
$$;

COMMENT ON FUNCTION public.v2_replace_win_media(
  TEXT, UUID, UUID, UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) IS
  'Atomic Replace Photo: expectedMediaId concurrency, MMS tombstone in-txn, delete+insert one media row. Service-role only. Storage cleanup is post-commit app concern.';

REVOKE ALL ON FUNCTION public.v2_replace_win_media(
  TEXT, UUID, UUID, UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.v2_replace_win_media(
  TEXT, UUID, UUID, UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) FROM anon;
REVOKE ALL ON FUNCTION public.v2_replace_win_media(
  TEXT, UUID, UUID, UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.v2_replace_win_media(
  TEXT, UUID, UUID, UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) TO service_role;
