-- Explicit completion for Stripe webhook claims.
-- created_at remains the original insert time.
-- claimed_at is the current worker lease.
-- completed_at is set only when the new handler finishes an event.
-- legacy_unverified marks rows recorded before that distinction.
-- Those rows stay in the table for dedupe. completed_at stays null.
-- They are not replayed, and they are not recorded as verified completions.

alter table public.stripe_webhook_events
  add column if not exists claimed_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists legacy_unverified boolean;

-- Every row present when this statement runs was stored by the previous handler.
-- Preserve event_id and created_at. Do not set completed_at. Do not delete rows.
update public.stripe_webhook_events
set
  legacy_unverified = true,
  claimed_at = coalesce(claimed_at, created_at)
where legacy_unverified is null;

alter table public.stripe_webhook_events
  alter column legacy_unverified set default false;

alter table public.stripe_webhook_events
  alter column legacy_unverified set not null;

alter table public.stripe_webhook_events
  alter column claimed_at set default now();

alter table public.stripe_webhook_events
  alter column claimed_at set not null;
