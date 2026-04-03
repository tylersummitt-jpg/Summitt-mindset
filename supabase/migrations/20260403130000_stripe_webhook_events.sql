create table stripe_webhook_events (
  event_id text primary key,
  created_at timestamp with time zone not null default now()
);
