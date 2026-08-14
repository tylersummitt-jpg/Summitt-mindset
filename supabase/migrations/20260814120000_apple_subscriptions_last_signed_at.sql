-- Apple IAP Phase 7A: monotonic ASSN ordering timestamp.
-- Additive only. Nullable because existing rows have no historical signedDate.
-- No backfill. No index (UNIQUE original_transaction_id already locates the row
-- for the expected conditional update).
-- No RLS/grant/policy changes. No destructive SQL. No status-string changes.
-- Do NOT apply automatically — Tyler applies after audit.

ALTER TABLE public.apple_subscriptions
  ADD COLUMN IF NOT EXISTS last_signed_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.apple_subscriptions.last_signed_at IS
  'Latest authoritative Apple notification signedDate applied to this row. '
  'Rejects older out-of-order App Store Server Notifications. NULL means unknown.';
