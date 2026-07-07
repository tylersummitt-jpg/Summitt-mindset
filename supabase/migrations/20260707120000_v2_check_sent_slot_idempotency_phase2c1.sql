-- Phase 2C-1: slot-scoped check_sent idempotency (morning + evening_checkin per day).
-- Legacy day-only keys remain valid dedup targets for morning.

CREATE OR REPLACE FUNCTION v2_apply_check_sent_post_send_bookkeeping_mutation(
  p_commitment_id UUID,
  p_clerk_user_id TEXT,
  p_day_key TEXT,
  p_message_sid TEXT,
  p_template_id INTEGER,
  p_template_family TEXT,
  p_body_preview TEXT,
  p_effective_ask_text TEXT,
  p_prompt_kind TEXT,
  p_expected_reply_semantics TEXT,
  p_check_payload_json JSONB DEFAULT '{}'::jsonb,
  p_now TIMESTAMPTZ DEFAULT now(),
  p_include_contract_overlay_proposal BOOLEAN DEFAULT FALSE,
  p_proposal_text TEXT DEFAULT NULL,
  p_contract_kind TEXT DEFAULT NULL
)
RETURNS TABLE (
  result TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_row v2_commitment%ROWTYPE;
  v_day_key TEXT;
  v_message_sid TEXT;
  v_template_family TEXT;
  v_prompt_kind TEXT;
  v_expected_reply_semantics TEXT;
  v_send_slot TEXT;
  v_idempotency_key TEXT;
  v_legacy_idempotency_key TEXT;
  v_proposed_key TEXT;
  v_payload JSONB;
  v_has_check BOOLEAN;
  v_has_proposed BOOLEAN;
  v_proposal_plain TEXT;
  v_contract_kind TEXT;
  v_proposal_expires TIMESTAMPTZ;
  v_proposed_payload JSONB;
  v_updated INT;
BEGIN
  v_day_key := trim(coalesce(p_day_key, ''));
  v_message_sid := trim(coalesce(p_message_sid, ''));
  v_template_family := lower(trim(coalesce(p_template_family, '')));
  v_prompt_kind := lower(trim(coalesce(p_prompt_kind, '')));
  v_expected_reply_semantics := lower(trim(coalesce(p_expected_reply_semantics, '')));

  IF v_day_key = '' OR v_message_sid = '' THEN
    RETURN QUERY SELECT 'error'::TEXT;
    RETURN;
  END IF;
  IF p_template_id IS NULL OR p_template_id <= 0 THEN
    RETURN QUERY SELECT 'error'::TEXT;
    RETURN;
  END IF;
  IF v_template_family NOT IN ('standard', 'recovery') THEN
    RETURN QUERY SELECT 'error'::TEXT;
    RETURN;
  END IF;
  IF v_prompt_kind NOT IN ('standard_accountability', 'contract_overlay_proposal') THEN
    RETURN QUERY SELECT 'error'::TEXT;
    RETURN;
  END IF;
  IF v_expected_reply_semantics NOT IN ('yes_no_partial', 'proposal_yes_no') THEN
    RETURN QUERY SELECT 'error'::TEXT;
    RETURN;
  END IF;
  IF p_check_payload_json IS NULL OR jsonb_typeof(p_check_payload_json) <> 'object' THEN
    RETURN QUERY SELECT 'error'::TEXT;
    RETURN;
  END IF;

  IF p_include_contract_overlay_proposal THEN
    IF v_prompt_kind <> 'contract_overlay_proposal' THEN
      RETURN QUERY SELECT 'error'::TEXT;
      RETURN;
    END IF;
    v_proposal_plain := trim(coalesce(p_proposal_text, ''));
    v_contract_kind := lower(trim(coalesce(p_contract_kind, '')));
    IF v_proposal_plain = '' OR v_contract_kind NOT IN ('shrink_ask', 'recommit_same') THEN
      RETURN QUERY SELECT 'error'::TEXT;
      RETURN;
    END IF;
  END IF;

  SELECT *
  INTO v_row
  FROM v2_commitment
  WHERE id = p_commitment_id
    AND clerk_user_id = p_clerk_user_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT;
    RETURN;
  END IF;

  v_send_slot := lower(trim(coalesce(p_check_payload_json->>'send_slot', 'morning')));
  IF v_send_slot NOT IN ('morning', 'evening_checkin') THEN
    v_send_slot := 'morning';
  END IF;

  v_idempotency_key := format('v2_check_sent:%s:%s:%s', p_commitment_id::TEXT, v_day_key, v_send_slot);
  v_legacy_idempotency_key := format('v2_check_sent:%s:%s', p_commitment_id::TEXT, v_day_key);
  v_proposed_key := format('v2_contract_overlay_proposed:%s:%s', p_commitment_id::TEXT, v_day_key);

  IF v_send_slot = 'morning' THEN
    SELECT EXISTS (
      SELECT 1 FROM v2_commitment_event
      WHERE event_type = 'check_sent'
        AND idempotency_key IN (v_idempotency_key, v_legacy_idempotency_key)
    ) INTO v_has_check;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM v2_commitment_event
      WHERE idempotency_key = v_idempotency_key
        AND event_type = 'check_sent'
    ) INTO v_has_check;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM v2_commitment_event
    WHERE idempotency_key = v_proposed_key
      AND event_type = 'contract_overlay_proposed'
  ) INTO v_has_proposed;

  v_proposal_expires := p_now + interval '48 hours';

  v_payload := p_check_payload_json
    || jsonb_build_object(
      'day_key', v_day_key,
      'send_slot', v_send_slot,
      'template_id', p_template_id,
      'template_family', v_template_family,
      'channel', 'sms',
      'message_sid', v_message_sid,
      'body_preview', left(coalesce(p_body_preview, ''), 160),
      'effective_ask_text', left(coalesce(p_effective_ask_text, ''), 240),
      'prompt_kind', v_prompt_kind,
      'expected_reply_semantics', v_expected_reply_semantics
    );

  -- Idempotent / repair when check_sent already exists (legacy split-brain or duplicate caller).
  IF v_has_check THEN
    IF NOT p_include_contract_overlay_proposal THEN
      RETURN QUERY SELECT 'already_applied'::TEXT;
      RETURN;
    END IF;
    IF v_prompt_kind <> 'contract_overlay_proposal' THEN
      RETURN QUERY SELECT 'already_applied'::TEXT;
      RETURN;
    END IF;

    IF v_has_proposed THEN
      IF trim(coalesce(v_row.adaptive_proposal_text, '')) = v_proposal_plain THEN
        RETURN QUERY SELECT 'already_applied'::TEXT;
      ELSE
        RETURN QUERY SELECT 'state_conflict'::TEXT;
      END IF;
      RETURN;
    END IF;

    IF trim(coalesce(v_row.adaptive_ask_text, '')) <> '' THEN
      RETURN QUERY SELECT 'state_conflict'::TEXT;
      RETURN;
    END IF;
    IF v_row.adaptive_proposal_text IS NOT NULL
       AND trim(coalesce(v_row.adaptive_proposal_text, '')) <> v_proposal_plain THEN
      RETURN QUERY SELECT 'state_conflict'::TEXT;
      RETURN;
    END IF;

    v_proposed_payload := jsonb_build_object(
      'contract_kind', v_contract_kind,
      'proposal_text', v_proposal_plain,
      'proposal_expires_at', v_proposal_expires,
      'day_key', v_day_key,
      'message_sid', v_message_sid,
      'proposal_ttl_hours', 48
    );

    BEGIN
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
        'contract_overlay_proposed',
        p_now,
        'sms_v2_accountability',
        v_proposed_payload,
        v_proposed_key
      );

      UPDATE v2_commitment
      SET
        adaptive_proposal_text = v_proposal_plain,
        adaptive_proposal_created_at = p_now,
        adaptive_proposal_expires_at = v_proposal_expires,
        updated_at = p_now
      WHERE id = p_commitment_id
        AND clerk_user_id = p_clerk_user_id
        AND status = 'active'
        AND (
          (adaptive_proposal_text IS NULL AND adaptive_ask_text IS NULL)
          OR trim(coalesce(adaptive_proposal_text, '')) = v_proposal_plain
        );

      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 0 THEN
        RAISE EXCEPTION 'v2_check_sent_prop_repair_conflict';
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM = 'v2_check_sent_prop_repair_conflict' THEN
          RETURN QUERY SELECT 'state_conflict'::TEXT;
          RETURN;
        END IF;
        RAISE;
    END;

    RETURN QUERY SELECT 'applied'::TEXT;
    RETURN;
  END IF;

  -- Fresh path: snapshot + check_sent (+ proposal bundle when requested).
  IF p_include_contract_overlay_proposal THEN
    IF v_row.adaptive_proposal_text IS NOT NULL OR v_row.adaptive_ask_text IS NOT NULL THEN
      RETURN QUERY SELECT 'state_conflict'::TEXT;
      RETURN;
    END IF;

    v_proposed_payload := jsonb_build_object(
      'contract_kind', v_contract_kind,
      'proposal_text', v_proposal_plain,
      'proposal_expires_at', v_proposal_expires,
      'day_key', v_day_key,
      'message_sid', v_message_sid,
      'proposal_ttl_hours', 48
    );

    BEGIN
      INSERT INTO v2_check_sent_outbound_intent_snapshot (
        commitment_id,
        clerk_user_id,
        day_key,
        message_sid,
        template_id,
        template_family,
        body_preview,
        effective_ask_text,
        prompt_kind,
        expected_reply_semantics,
        check_payload_json,
        idempotency_key,
        source_wrapped_at
      )
      VALUES (
        p_commitment_id,
        p_clerk_user_id,
        v_day_key,
        v_message_sid,
        p_template_id,
        v_template_family,
        left(coalesce(p_body_preview, ''), 160),
        left(coalesce(p_effective_ask_text, ''), 240),
        v_prompt_kind,
        v_expected_reply_semantics,
        v_payload,
        v_idempotency_key,
        p_now
      )
      ON CONFLICT (idempotency_key) DO NOTHING;

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
        'check_sent',
        p_now,
        'sms_v2_accountability',
        v_payload,
        v_idempotency_key
      );

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
        'contract_overlay_proposed',
        p_now,
        'sms_v2_accountability',
        v_proposed_payload,
        v_proposed_key
      );

      UPDATE v2_commitment
      SET
        adaptive_proposal_text = v_proposal_plain,
        adaptive_proposal_created_at = p_now,
        adaptive_proposal_expires_at = v_proposal_expires,
        updated_at = p_now
      WHERE id = p_commitment_id
        AND clerk_user_id = p_clerk_user_id
        AND status = 'active'
        AND adaptive_proposal_text IS NULL
        AND adaptive_ask_text IS NULL;

      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 0 THEN
        RAISE EXCEPTION 'v2_check_sent_prop_fresh_conflict';
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM = 'v2_check_sent_prop_fresh_conflict' THEN
          RETURN QUERY SELECT 'state_conflict'::TEXT;
          RETURN;
        END IF;
        RAISE;
    END;

    RETURN QUERY SELECT 'applied'::TEXT;
    RETURN;
  END IF;

  INSERT INTO v2_check_sent_outbound_intent_snapshot (
    commitment_id,
    clerk_user_id,
    day_key,
    message_sid,
    template_id,
    template_family,
    body_preview,
    effective_ask_text,
    prompt_kind,
    expected_reply_semantics,
    check_payload_json,
    idempotency_key,
    source_wrapped_at
  )
  VALUES (
    p_commitment_id,
    p_clerk_user_id,
    v_day_key,
    v_message_sid,
    p_template_id,
    v_template_family,
    left(coalesce(p_body_preview, ''), 160),
    left(coalesce(p_effective_ask_text, ''), 240),
    v_prompt_kind,
    v_expected_reply_semantics,
    v_payload,
    v_idempotency_key,
    p_now
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

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
    'check_sent',
    p_now,
    'sms_v2_accountability',
    v_payload,
    v_idempotency_key
  );

  RETURN QUERY SELECT 'applied'::TEXT;
END;
$$;

COMMENT ON FUNCTION v2_apply_check_sent_post_send_bookkeeping_mutation(
  UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ, BOOLEAN, TEXT, TEXT
) IS 'Transactional wrapper for V2 check_sent post-send: snapshot + check_sent; optional atomic contract_overlay_proposed + pending proposal columns. Phase 2C-1: idempotency per commitment/day/send_slot; legacy day-only key dedupes morning.';
