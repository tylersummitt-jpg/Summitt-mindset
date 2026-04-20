-- Coach Leadership Kit shipping addresses (PII — server-side access only)
-- Upsert keyed by clerk_user_id

create table if not exists public.coach_shipping_addresses (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null,
  email text not null,
  full_name text not null,
  address_line_1 text not null,
  address_line_2 text,
  city text not null,
  state text not null,
  postal_code text not null,
  country text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  shipped_at timestamptz,
  notes text,
  constraint coach_shipping_addresses_clerk_user_id_key unique (clerk_user_id)
);

create index if not exists coach_shipping_addresses_created_at_idx
  on public.coach_shipping_addresses (created_at desc);

comment on table public.coach_shipping_addresses is 'Shipping addresses for coach Leadership Kit fulfillment; PII — do not expose via anon client.';
