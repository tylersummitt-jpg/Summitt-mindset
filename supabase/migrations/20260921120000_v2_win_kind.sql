-- Phase A: durable Victory Room win_kind (goal_win | proud_moment).
-- Additive. Nullable. No default. No NOT NULL. Tyler applies after audit.
-- Backfill uses write-time product mapping. SQL B (SET NOT NULL) is a later step.

ALTER TABLE public.v2_win
  ADD COLUMN IF NOT EXISTS win_kind TEXT NULL;

ALTER TABLE public.v2_win
  DROP CONSTRAINT IF EXISTS v2_win_win_kind_chk;

ALTER TABLE public.v2_win
  ADD CONSTRAINT v2_win_win_kind_chk CHECK (
    win_kind IN ('goal_win', 'proud_moment')
  );

COMMENT ON COLUMN public.v2_win.win_kind IS
  'Canonical Victory Room kind. Server-owned at insert. NULL only during Phase A rollout.';

-- Precedence: manual (even if relationship_type=goal) → acc_yes → SMS relationship.
UPDATE public.v2_win
SET win_kind = 'proud_moment'
WHERE source_type = 'manual'
  AND win_kind IS NULL;

UPDATE public.v2_win
SET win_kind = 'goal_win'
WHERE idempotency_key LIKE 'win_v1:acc_yes:%'
  AND win_kind IS NULL;

UPDATE public.v2_win
SET win_kind = 'goal_win'
WHERE source_type = 'sms_inbound'
  AND relationship_type IN ('goal', 'mixed')
  AND win_kind IS NULL;

UPDATE public.v2_win
SET win_kind = 'proud_moment'
WHERE source_type = 'sms_inbound'
  AND relationship_type IN ('identity', 'whole_life')
  AND win_kind IS NULL;
