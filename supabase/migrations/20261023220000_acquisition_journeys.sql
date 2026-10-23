-- One enrollment instance for an acquisition person.
-- The same person may enroll in the same campaign again.
-- Existing events and actions stay valid with a null journey id.
-- Git push does not run this file. This file does not send email.

CREATE TABLE public.acquisition_journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL,
  campaign_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT acquisition_journeys_id_person_uq
    UNIQUE (id, person_id),
  CONSTRAINT acquisition_journeys_person_fk
    FOREIGN KEY (person_id)
    REFERENCES public.acquisition_people (id)
    ON DELETE RESTRICT,
  CONSTRAINT acquisition_journeys_campaign_chk
    CHECK (campaign_id IS NULL OR char_length(campaign_id) BETWEEN 1 AND 80)
);

ALTER TABLE public.acquisition_events
  ADD COLUMN journey_id UUID NULL;

-- person_id is nullable. MATCH SIMPLE does not check a composite key when
-- either side is null, so this requires a person before a journey can be set.
ALTER TABLE public.acquisition_events
  ADD CONSTRAINT acquisition_events_journey_person_chk
  CHECK (journey_id IS NULL OR person_id IS NOT NULL);

ALTER TABLE public.acquisition_events
  ADD CONSTRAINT acquisition_events_journey_person_fk
  FOREIGN KEY (journey_id, person_id)
  REFERENCES public.acquisition_journeys (id, person_id)
  MATCH SIMPLE
  ON DELETE RESTRICT;

ALTER TABLE public.acquisition_actions
  ADD COLUMN journey_id UUID NULL;

ALTER TABLE public.acquisition_actions
  ADD CONSTRAINT acquisition_actions_journey_person_fk
  FOREIGN KEY (journey_id, person_id)
  REFERENCES public.acquisition_journeys (id, person_id)
  MATCH SIMPLE
  ON DELETE RESTRICT;

ALTER TABLE public.acquisition_journeys ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.acquisition_journeys FROM anon, authenticated, PUBLIC, service_role;

GRANT SELECT, INSERT ON TABLE public.acquisition_journeys TO service_role;

COMMENT ON TABLE public.acquisition_journeys IS
  'One enrollment instance. Existing events and actions do not require a journey.';
