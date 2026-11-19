-- Lets a later Stripe webhook attach one legitimate person to a subscription
-- event that was recorded before that person could be matched.
-- It does not add a table. It does not permit a second trial or payment row.
-- service_role can already insert these events. It could not update them.

GRANT UPDATE (person_id, campaign_id, journey_id, metadata)
  ON TABLE public.acquisition_events
  TO service_role;
