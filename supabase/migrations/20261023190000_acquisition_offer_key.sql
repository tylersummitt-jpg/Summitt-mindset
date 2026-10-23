-- Optional offer key for a future asset bundle.
-- Existing requested_asset values stay in place. This file does not send email.
-- Git push does not run this file. Do not execute until reviewed.

ALTER TABLE public.acquisition_people
  ADD COLUMN offer_key TEXT NULL;

ALTER TABLE public.acquisition_people
  ADD CONSTRAINT acquisition_people_offer_key_chk
  CHECK (offer_key IS NULL OR char_length(offer_key) BETWEEN 1 AND 64);

ALTER TABLE public.acquisition_settings
  ADD COLUMN offers JSONB NOT NULL DEFAULT '{}'::jsonb;
