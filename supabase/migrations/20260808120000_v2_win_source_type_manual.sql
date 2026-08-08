-- Item #3: allow manual Victory Room Wins.
-- Additive CHECK expansion only. No row backfill. No RLS/grants/index changes.
-- Do NOT apply automatically — Tyler applies after audit.

ALTER TABLE public.v2_win
  DROP CONSTRAINT IF EXISTS v2_win_source_type_chk;

ALTER TABLE public.v2_win
  ADD CONSTRAINT v2_win_source_type_chk CHECK (
    source_type IN ('sms_inbound', 'system_event', 'manual')
  );

COMMENT ON CONSTRAINT v2_win_source_type_chk ON public.v2_win IS
  'Win provenance: sms_inbound, system_event, or user-authored manual.';
