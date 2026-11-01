-- One saved retention report. Service role only.
-- Git push does not run this file. Do not execute until reviewed.
-- No indexes. This table is one row.

CREATE TABLE public.retention_report (
  id integer PRIMARY KEY,
  report jsonb,
  calculated_at timestamptz,
  schema_version integer NOT NULL DEFAULT 1,
  state text NOT NULL DEFAULT 'idle',
  run_token uuid,
  started_at timestamptz,
  error text,
  CONSTRAINT retention_report_one_row CHECK (id = 1),
  CONSTRAINT retention_report_state_chk CHECK (state IN ('idle', 'running', 'failed')),
  CONSTRAINT retention_report_error_len CHECK (error IS NULL OR char_length(error) <= 240)
);

INSERT INTO public.retention_report (id, state, schema_version)
VALUES (1, 'idle', 1);

ALTER TABLE public.retention_report ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.retention_report FROM anon, authenticated, PUBLIC, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.retention_report TO service_role;

COMMENT ON TABLE public.retention_report IS
  'The latest finished retention cohort report. A failed generation does not replace report.';
