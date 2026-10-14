-- Personal video links. One row per recording.
-- Service role only. No recipient, email, Clerk id, or send status.
-- Git push does not run this file. Do not execute until reviewed.

CREATE TABLE public.personal_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_token TEXT NOT NULL UNIQUE,
  vimeo_video_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'uploading',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT personal_videos_token_chk CHECK (
    public_token ~ '^[A-Za-z0-9_-]{32,80}$'
  ),
  CONSTRAINT personal_videos_vimeo_chk CHECK (
    vimeo_video_id ~ '^[0-9]{6,20}$'
  ),
  CONSTRAINT personal_videos_status_chk CHECK (
    status IN ('uploading', 'processing', 'ready', 'failed')
  )
);

CREATE INDEX personal_videos_created_idx
  ON public.personal_videos (created_at DESC);

ALTER TABLE public.personal_videos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.personal_videos FROM anon, authenticated, PUBLIC, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.personal_videos TO service_role;

COMMENT ON TABLE public.personal_videos IS
  'Unguessable Summitt page token for one Vimeo video. Public playback is allowed only when status is ready.';
