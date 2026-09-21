-- Slice 2: durable provenance for optional archival Victory detail.
-- Additive. No backfill. No index. No CHECK / display_body / schema_version change.
-- Tyler applies after audit.

ALTER TABLE public.v2_win
  ADD COLUMN IF NOT EXISTS display_body_is_archival_detail
  BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.v2_win.display_body_is_archival_detail IS
  'True only when display_body was written from model archival detail. Unedited AI/SMS cards may show that body. Default false keeps fallback/historical bodies hidden.';
