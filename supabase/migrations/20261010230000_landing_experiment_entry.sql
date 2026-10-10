-- Landing-page experiments: one stable entry slug and two approved destinations.
-- Depends on public.operating_experiments from 20261010200000.
-- Existing rows stay NULL and are not landing experiments.
-- This does not insert the homepage vs Become Proud row and does not start a test.

ALTER TABLE public.operating_experiments
  ADD COLUMN entry_slug TEXT NULL,
  ADD COLUMN control_path TEXT NULL,
  ADD COLUMN challenger_path TEXT NULL;

ALTER TABLE public.operating_experiments
  ADD CONSTRAINT operating_experiments_landing_entry_chk CHECK (
    (
      entry_slug IS NULL
      AND control_path IS NULL
      AND challenger_path IS NULL
    )
    OR (
      entry_slug IS NOT NULL
      AND entry_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      AND char_length(entry_slug) BETWEEN 1 AND 40
      AND control_path IN (
        '/',
        '/leadership',
        '/become-proud',
        '/daily-coaching',
        '/life-worth-remembering'
      )
      AND challenger_path IN (
        '/',
        '/leadership',
        '/become-proud',
        '/daily-coaching',
        '/life-worth-remembering'
      )
      AND control_path IS DISTINCT FROM challenger_path
    )
  );

CREATE UNIQUE INDEX operating_experiments_entry_slug_uidx
  ON public.operating_experiments (entry_slug)
  WHERE entry_slug IS NOT NULL;

COMMENT ON COLUMN public.operating_experiments.entry_slug IS
  'Public entry at /go/{entry_slug}. NULL means this row is not a landing-page experiment.';
COMMENT ON COLUMN public.operating_experiments.control_path IS
  'Approved control destination. Locked with the definition once the experiment leaves planned.';
COMMENT ON COLUMN public.operating_experiments.challenger_path IS
  'Approved challenger destination. Locked with the definition once the experiment leaves planned.';

-- Same protection as 20261010200000, plus the three landing columns.
-- CREATE OR REPLACE keeps the existing owner and grants.

CREATE OR REPLACE FUNCTION public.operating_experiments_protect_definition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.id = OLD.id;
  NEW.created_at = OLD.created_at;
  NEW.updated_at = now();

  IF NOT (OLD.status = 'planned' AND NEW.status = 'planned') THEN
    IF NEW.name IS DISTINCT FROM OLD.name
      OR NEW.area IS DISTINCT FROM OLD.area
      OR NEW.hypothesis IS DISTINCT FROM OLD.hypothesis
      OR NEW.control_description IS DISTINCT FROM OLD.control_description
      OR NEW.challenger_description IS DISTINCT FROM OLD.challenger_description
      OR NEW.primary_outcome IS DISTINCT FROM OLD.primary_outcome
      OR NEW.decision_criteria IS DISTINCT FROM OLD.decision_criteria
      OR NEW.entry_slug IS DISTINCT FROM OLD.entry_slug
      OR NEW.control_path IS DISTINCT FROM OLD.control_path
      OR NEW.challenger_path IS DISTINCT FROM OLD.challenger_path
    THEN
      RAISE EXCEPTION 'operating_experiment_definition_locked'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF OLD.status = 'planned' AND NEW.status NOT IN ('planned', 'running') THEN
    RAISE EXCEPTION 'operating_experiment_invalid_transition'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'running' AND NEW.status NOT IN ('running', 'paused', 'completed') THEN
    RAISE EXCEPTION 'operating_experiment_invalid_transition'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'paused' AND NEW.status NOT IN ('paused', 'running', 'completed') THEN
    RAISE EXCEPTION 'operating_experiment_invalid_transition'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'completed' AND (
    NEW.status IS DISTINCT FROM OLD.status
    OR NEW.evidence IS DISTINCT FROM OLD.evidence
    OR NEW.conclusion IS DISTINCT FROM OLD.conclusion
    OR NEW.next_action IS DISTINCT FROM OLD.next_action
    OR NEW.limitations IS DISTINCT FROM OLD.limitations
    OR NEW.secondary_outcomes IS DISTINCT FROM OLD.secondary_outcomes
    OR NEW.start_on IS DISTINCT FROM OLD.start_on
    OR NEW.end_on IS DISTINCT FROM OLD.end_on
    OR NEW.decision_on IS DISTINCT FROM OLD.decision_on
  ) THEN
    RAISE EXCEPTION 'operating_experiment_completed_locked'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'completed' AND (
    NEW.evidence = 'not_yet_tested'
    OR NEW.conclusion IS NULL
    OR btrim(NEW.conclusion) = ''
    OR NEW.next_action IS NULL
    OR btrim(NEW.next_action) = ''
    OR NEW.decision_on IS NULL
  ) THEN
    RAISE EXCEPTION 'operating_experiment_decision_incomplete'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.operating_experiments_protect_definition() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.operating_experiments_protect_definition() FROM anon;
REVOKE ALL ON FUNCTION public.operating_experiments_protect_definition() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.operating_experiments_protect_definition() TO service_role;
