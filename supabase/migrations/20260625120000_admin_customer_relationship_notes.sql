-- Tyler-only admin CRM / manual fulfillment notes. Never customer-facing.

CREATE TABLE admin_customer_relationship_notes (
  clerk_user_id TEXT PRIMARY KEY,
  tyler_notes TEXT NOT NULL DEFAULT '',
  sent_quotes_book BOOLEAN NOT NULL DEFAULT false,
  sent_quotes_book_at TIMESTAMPTZ NULL,
  other_items_sent TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL
);

CREATE INDEX idx_admin_customer_relationship_notes_updated
  ON admin_customer_relationship_notes (updated_at DESC);

COMMENT ON TABLE admin_customer_relationship_notes IS
  'Tyler-only admin CRM and manual fulfillment (quotes book, other items). '
  'Not customer-facing. Access via Tyler-gated server routes only.';

ALTER TABLE admin_customer_relationship_notes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE admin_customer_relationship_notes FROM anon;
REVOKE ALL ON TABLE admin_customer_relationship_notes FROM authenticated;
REVOKE ALL ON TABLE admin_customer_relationship_notes FROM PUBLIC;
