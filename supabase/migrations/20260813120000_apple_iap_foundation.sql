-- Apple IAP foundation (Phase 1): durable bindings, subscription evidence, ASSN dedupe.
-- Additive only. No production data backfill. No runtime routes in this migration.
-- Access: server-side service-role only (Clerk-authenticated Next.js routes later).
-- Direct anon/authenticated table access is intentionally revoked.
-- No client RLS policies are created.
--
-- Does not modify Stripe, account_deletion_requests, SMS, Victory Media,
-- commitment, season, or proof tables.
--
-- Rollback (before any production Apple rows exist):
--   DROP TABLE IF EXISTS public.apple_notification_events;
--   DROP TABLE IF EXISTS public.apple_subscriptions;
--   DROP TABLE IF EXISTS public.apple_account_bindings;

-- ---------------------------------------------------------------------------
-- 1) apple_account_bindings — server-owned StoreKit appAccountToken UUID
-- ---------------------------------------------------------------------------
-- Live row: clerk_user_id set, unbound_at NULL (one live binding per Clerk user).
-- Tombstone: clerk_user_id NULL, unbound_at set. app_account_token remains UNIQUE
-- forever so a deleted account's UUID is never recycled onto another Clerk user.

CREATE TABLE public.apple_account_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NULL,
  app_account_token UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unbound_at TIMESTAMPTZ NULL,

  CONSTRAINT apple_account_bindings_app_account_token_uq UNIQUE (app_account_token),
  CONSTRAINT apple_account_bindings_live_or_tombstone_chk CHECK (
    (unbound_at IS NULL AND clerk_user_id IS NOT NULL)
    OR (unbound_at IS NOT NULL AND clerk_user_id IS NULL)
  ),
  CONSTRAINT apple_account_bindings_clerk_user_id_nonempty_chk CHECK (
    clerk_user_id IS NULL OR length(trim(clerk_user_id)) > 0
  )
);

COMMENT ON TABLE public.apple_account_bindings IS
  'Server-created stable UUID for StoreKit appAccountToken. '
  'One live binding per Clerk user. Tombstoned rows keep the UUID forever. '
  'Service-role / server routes only. Correlation identity, not auth.';

COMMENT ON COLUMN public.apple_account_bindings.app_account_token IS
  'Globally unique UUID. Never reused after unbind.';

CREATE UNIQUE INDEX apple_account_bindings_live_clerk_user_id_uq
  ON public.apple_account_bindings (clerk_user_id)
  WHERE unbound_at IS NULL AND clerk_user_id IS NOT NULL;

ALTER TABLE public.apple_account_bindings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.apple_account_bindings FROM anon;
REVOKE ALL ON TABLE public.apple_account_bindings FROM authenticated;
REVOKE ALL ON TABLE public.apple_account_bindings FROM PUBLIC;
REVOKE ALL ON TABLE public.apple_account_bindings FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.apple_account_bindings TO service_role;

-- ---------------------------------------------------------------------------
-- 2) apple_subscriptions — durable Apple subscription evidence
-- ---------------------------------------------------------------------------
-- original_transaction_id is the durable Apple subscription identity (globally unique).
-- clerk_user_id is nullable so account deletion can detach billing evidence.
-- status is OUR normalized projection. Auto-renew-off while still in period stays
-- `active` (entitled until expires_at); use auto_renew_enabled for renew intent.
-- Runtime maps Apple → these statuses. Do not store raw untrusted Apple text.

CREATE TABLE public.apple_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_transaction_id TEXT NOT NULL,
  latest_transaction_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  clerk_user_id TEXT NULL,
  app_account_token UUID NOT NULL,
  product_id TEXT NOT NULL,
  status TEXT NOT NULL,
  expires_at TIMESTAMPTZ NULL,
  auto_renew_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  revoked_at TIMESTAMPTZ NULL,
  refunded_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT apple_subscriptions_original_transaction_id_uq UNIQUE (original_transaction_id),
  CONSTRAINT apple_subscriptions_original_transaction_id_nonempty_chk CHECK (
    length(trim(original_transaction_id)) > 0
  ),
  CONSTRAINT apple_subscriptions_latest_transaction_id_nonempty_chk CHECK (
    length(trim(latest_transaction_id)) > 0
  ),
  CONSTRAINT apple_subscriptions_environment_chk CHECK (
    environment IN ('sandbox', 'production')
  ),
  CONSTRAINT apple_subscriptions_status_chk CHECK (
    status IN (
      'active',
      'grace_period',
      'billing_retry',
      'expired',
      'revoked',
      'refunded'
    )
  ),
  CONSTRAINT apple_subscriptions_product_id_nonempty_chk CHECK (
    length(trim(product_id)) > 0
  ),
  CONSTRAINT apple_subscriptions_clerk_user_id_nonempty_chk CHECK (
    clerk_user_id IS NULL OR length(trim(clerk_user_id)) > 0
  )
);

COMMENT ON TABLE public.apple_subscriptions IS
  'Durable Apple IAP subscription evidence for verify, ASSN V2, restore, '
  'entitlement recompute, and deletion detach. Service-role / server routes only. '
  'original_transaction_id is globally unique and must not bind two live Clerk users.';

COMMENT ON COLUMN public.apple_subscriptions.status IS
  'Normalized projection: active (including auto-renew off until expiry), '
  'grace_period, billing_retry, expired, revoked, refunded. '
  'Auto-renew intent is auto_renew_enabled, not a canceled status.';

CREATE INDEX apple_subscriptions_clerk_user_id_idx
  ON public.apple_subscriptions (clerk_user_id);

ALTER TABLE public.apple_subscriptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.apple_subscriptions FROM anon;
REVOKE ALL ON TABLE public.apple_subscriptions FROM authenticated;
REVOKE ALL ON TABLE public.apple_subscriptions FROM PUBLIC;
REVOKE ALL ON TABLE public.apple_subscriptions FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.apple_subscriptions TO service_role;

-- ---------------------------------------------------------------------------
-- 3) apple_notification_events — App Store Server Notifications V2 idempotency
-- ---------------------------------------------------------------------------
-- Analogue of stripe_webhook_events: insert notification_uuid before processing.
-- Duplicate UUID (23505) means already claimed. processed_at set after success.
-- No signedPayload blob stored.

CREATE TABLE public.apple_notification_events (
  notification_uuid UUID PRIMARY KEY,
  notification_type TEXT NOT NULL,
  subtype TEXT NULL,
  original_transaction_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ NULL,

  CONSTRAINT apple_notification_events_notification_type_nonempty_chk CHECK (
    length(trim(notification_type)) > 0
  ),
  CONSTRAINT apple_notification_events_original_transaction_id_nonempty_chk CHECK (
    original_transaction_id IS NULL OR length(trim(original_transaction_id)) > 0
  )
);

COMMENT ON TABLE public.apple_notification_events IS
  'ASSN V2 notification UUID idempotency. Service-role / server routes only. '
  'Insert-before-process; duplicate UUID is a no-op ack.';

ALTER TABLE public.apple_notification_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.apple_notification_events FROM anon;
REVOKE ALL ON TABLE public.apple_notification_events FROM authenticated;
REVOKE ALL ON TABLE public.apple_notification_events FROM PUBLIC;
REVOKE ALL ON TABLE public.apple_notification_events FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.apple_notification_events TO service_role;
