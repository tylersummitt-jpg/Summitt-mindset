-- Drop the one-action-per-person constraint only after both partial indexes exist.
-- Git push does not run this file. This file does not insert, claim, or send.
-- Confirm the live constraint name before applying. The repository definition is unnamed,
-- so PostgreSQL's expected name is acquisition_actions_person_id_action_type_key.
-- Do not apply this until acquisition_actions_legacy_person_type_uq
-- and acquisition_actions_journey_type_uq are present.

ALTER TABLE public.acquisition_actions
  DROP CONSTRAINT acquisition_actions_person_id_action_type_key;
