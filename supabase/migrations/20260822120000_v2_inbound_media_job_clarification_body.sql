-- Victory Media D2b: durable clarification SMS body for photo-only retry.
-- Additive. Nullable. Does not change status/resolution CHECKs.
-- clarification_body holds the exact reserved question so Twilio retry
-- resends the SAME text. Distinct from classifier_target (acc/distinct/ambiguous).
-- Do NOT apply automatically — Tyler applies after audit.

ALTER TABLE public.v2_inbound_media_job
  ADD COLUMN clarification_body TEXT NULL;

COMMENT ON COLUMN public.v2_inbound_media_job.clarification_body IS
  'Exact D2b clarification SMS body reserved for this inbound photo. '
  'Set only when followup_idempotency_key is reserved. NULL until a question '
  'is reserved. Retry must reuse this text. Not a saved-photo claim and not '
  'classifier_target.';
