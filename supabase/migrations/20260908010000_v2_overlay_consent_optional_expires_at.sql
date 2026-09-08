-- Slice 7C: optional explicit overlay expiry for Sol-owned temporary Goal Change.
-- Additive parameter with DEFAULT NULL. Omitters keep legacy now()+7 days.
-- No table changes. Existing guided/adaptive/recommit callers omit the new argument.

DROP FUNCTION IF EXISTS public.v2_apply_overlay_consent_mutation(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION public.v2_apply_overlay_consent_mutation(
  p_commitment_id UUID,
  p_clerk_user_id TEXT,
  p_inbound_message_sid TEXT,
  p_decision TEXT,
  p_proposal_text TEXT,
  p_contract_kind TEXT,
  p_expected_proposal_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_expected_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT now(),
  p_overlay_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  result TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_row v2_commitment%ROWTYPE;
  v_decision TEXT;
  v_proposal_text TEXT;
  v_event_type TEXT;
  v_event_idempotency_key TEXT;
  v_overlay_expires TIMESTAMPTZ;
BEGIN
  v_decision := lower(trim(coalesce(p_decision, '')));
  IF v_decision NOT IN ('accept', 'decline') THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  v_proposal_text := trim(coalesce(p_proposal_text, ''));
  IF v_proposal_text = '' THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT *
  INTO v_row
  FROM v2_commitment
  WHERE id = p_commitment_id
    AND clerk_user_id = p_clerk_user_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  v_event_type := CASE WHEN v_decision = 'accept' THEN 'contract_overlay_activated' ELSE 'contract_overlay_declined' END;
  v_event_idempotency_key := format(
    'v2_contract_overlay_%s:%s:%s',
    CASE WHEN v_decision = 'accept' THEN 'activated' ELSE 'declined' END,
    p_commitment_id::TEXT,
    trim(coalesce(p_inbound_message_sid, ''))
  );

  IF EXISTS (
    SELECT 1
    FROM v2_commitment_event
    WHERE idempotency_key = v_event_idempotency_key
  ) THEN
    RETURN QUERY SELECT 'already_applied'::TEXT, v_row.updated_at;
    RETURN;
  END IF;

  IF trim(coalesce(v_row.adaptive_proposal_text, '')) = '' THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at;
    RETURN;
  END IF;
  IF trim(v_row.adaptive_proposal_text) <> v_proposal_text THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at;
    RETURN;
  END IF;
  IF v_row.adaptive_ask_text IS NOT NULL THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at;
    RETURN;
  END IF;
  IF p_expected_proposal_expires_at IS NOT NULL
     AND v_row.adaptive_proposal_expires_at IS DISTINCT FROM p_expected_proposal_expires_at THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at;
    RETURN;
  END IF;
  IF p_expected_updated_at IS NOT NULL
     AND v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, v_row.updated_at;
    RETURN;
  END IF;

  IF v_decision = 'accept' THEN
    v_overlay_expires := COALESCE(p_overlay_expires_at, p_now + interval '7 days');
    UPDATE v2_commitment
    SET adaptive_ask_text = v_proposal_text,
        adaptive_ask_active_from = p_now,
        adaptive_ask_expires_at = v_overlay_expires,
        adaptive_proposal_text = NULL,
        adaptive_proposal_created_at = NULL,
        adaptive_proposal_expires_at = NULL,
        updated_at = p_now
    WHERE id = p_commitment_id
    RETURNING v2_commitment.updated_at INTO v_row.updated_at;
  ELSE
    UPDATE v2_commitment
    SET adaptive_proposal_text = NULL,
        adaptive_proposal_created_at = NULL,
        adaptive_proposal_expires_at = NULL,
        updated_at = p_now
    WHERE id = p_commitment_id
    RETURNING v2_commitment.updated_at INTO v_row.updated_at;
  END IF;

  INSERT INTO v2_commitment_event (
    commitment_id,
    clerk_user_id,
    event_type,
    occurred_at,
    source,
    payload_json,
    idempotency_key
  )
  VALUES (
    p_commitment_id,
    p_clerk_user_id,
    v_event_type,
    p_now,
    'sms_v2_accountability',
    CASE
      WHEN v_decision = 'accept' THEN
        jsonb_build_object(
          'contract_kind', p_contract_kind,
          'adaptive_ask_text', v_proposal_text,
          'adaptive_ask_expires_at', v_overlay_expires,
          'overlay_duration_days', CASE WHEN p_overlay_expires_at IS NULL THEN 7 ELSE NULL END,
          'consent_inbound_message_sid', trim(coalesce(p_inbound_message_sid, ''))
        )
      ELSE
        jsonb_build_object(
          'contract_kind', p_contract_kind,
          'declined_proposal_text', v_proposal_text,
          'consent_inbound_message_sid', trim(coalesce(p_inbound_message_sid, ''))
        )
    END,
    v_event_idempotency_key
  );

  RETURN QUERY SELECT 'applied'::TEXT, v_row.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.v2_apply_overlay_consent_mutation(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.v2_apply_overlay_consent_mutation(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
) FROM anon;
REVOKE ALL ON FUNCTION public.v2_apply_overlay_consent_mutation(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.v2_apply_overlay_consent_mutation(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
) TO service_role;

COMMENT ON FUNCTION public.v2_apply_overlay_consent_mutation(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
) IS 'Transactional overlay consent. p_overlay_expires_at DEFAULT NULL preserves legacy now()+7 days when omitted.';
