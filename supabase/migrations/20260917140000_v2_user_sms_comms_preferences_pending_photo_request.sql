-- Slice 1: already applied live. Repo history only.
-- Internal mechanical pending-photo target on the existing one-row-per-user
-- SMS prefs table. Nullable. No FK. No index. No trigger. No RLS change.

ALTER TABLE public.v2_user_sms_comms_preferences
  ADD COLUMN IF NOT EXISTS pending_photo_request_win_id UUID NULL,
  ADD COLUMN IF NOT EXISTS pending_photo_request_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_photo_request_sent_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.v2_user_sms_comms_preferences.pending_photo_request_win_id IS
  'Internal: exact Win id Coach asked a picture of. Not client-visible. No FK.';

COMMENT ON COLUMN public.v2_user_sms_comms_preferences.pending_photo_request_expires_at IS
  'Internal: pending photo-request TTL. Inactive when null or in the past.';

COMMENT ON COLUMN public.v2_user_sms_comms_preferences.last_photo_request_sent_at IS
  'Internal: last successful photo-request send. Future 168h cooldown clock. Do not clear when consuming pending target.';
