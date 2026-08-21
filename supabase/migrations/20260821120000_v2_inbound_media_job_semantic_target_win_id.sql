-- Victory Media D0: durable semantic target Win on inbound MMS jobs.
-- Additive. Nullable. Service-role table unchanged.
-- semantic_target_win_id = semantic layer selected this existing Win as the
-- intended attach target. It is NOT attached_win_id (canonical success).
-- Do NOT apply automatically — Tyler applies after audit.

ALTER TABLE public.v2_inbound_media_job
  ADD COLUMN semantic_target_win_id UUID NULL
    REFERENCES public.v2_win (id)
    ON DELETE SET NULL;

COMMENT ON COLUMN public.v2_inbound_media_job.semantic_target_win_id IS
  'Semantic layer explicitly selected this existing Win as the intended target '
  'for this inbound photo. Distinct from attached_win_id, which is set only '
  'after canonical attachment succeeds. NULL means C1 same-MessageSid correlation.';
