-- Local only. Git push does not run this file. Do not execute until reviewed.
-- One row claims the temporary one-address Instantly blocklist create test.
-- Applying this file does not call Instantly and does not change acquisition settings.
-- The row does not store an email address or a provider entry id.
-- Delete this table after the temporary create-test route is removed.

CREATE TABLE public.acquisition_blocklist_create_test (
  id TEXT PRIMARY KEY,
  outcome TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT acquisition_blocklist_create_test_id_chk CHECK (id = 'once'),
  CONSTRAINT acquisition_blocklist_create_test_outcome_chk CHECK (
    outcome IN ('claimed', 'created', 'denied', 'uncertain')
  )
);

ALTER TABLE public.acquisition_blocklist_create_test ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.acquisition_blocklist_create_test FROM anon, authenticated, PUBLIC, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.acquisition_blocklist_create_test TO service_role;

COMMENT ON TABLE public.acquisition_blocklist_create_test IS
  'Single-use claim for the temporary one-address Instantly blocklist create test. No email and no provider entry id are stored. A second insert cannot win the primary key.';
