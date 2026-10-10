-- Shared Distribution and Retention experiment registry.
-- Definitions are durable. This migration does not store exposures,
-- assignments, or calculated winners. A later build can reference id.

CREATE TABLE public.operating_experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  control_description TEXT NOT NULL,
  challenger_description TEXT NOT NULL,
  primary_outcome TEXT NOT NULL,
  decision_criteria TEXT NOT NULL,
  secondary_outcomes TEXT NULL,
  start_on DATE NULL,
  end_on DATE NULL,
  decision_on DATE NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  evidence TEXT NOT NULL DEFAULT 'not_yet_tested',
  conclusion TEXT NULL,
  next_action TEXT NULL,
  limitations TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL,
  CONSTRAINT operating_experiments_name_chk CHECK (
    char_length(btrim(name)) > 0 AND char_length(name) <= 120
  ),
  CONSTRAINT operating_experiments_area_chk CHECK (
    area IN ('distribution', 'retention')
  ),
  CONSTRAINT operating_experiments_status_chk CHECK (
    status IN ('planned', 'running', 'paused', 'completed')
  ),
  CONSTRAINT operating_experiments_evidence_chk CHECK (
    evidence IN (
      'not_yet_tested',
      'not_enough_mature_data',
      'directional',
      'proven',
      'disproven',
      'tracking_untrustworthy'
    )
  ),
  CONSTRAINT operating_experiments_text_len_chk CHECK (
    char_length(hypothesis) <= 2000
    AND char_length(control_description) <= 2000
    AND char_length(challenger_description) <= 2000
    AND char_length(primary_outcome) <= 500
    AND char_length(decision_criteria) <= 2000
    AND (secondary_outcomes IS NULL OR char_length(secondary_outcomes) <= 2000)
    AND (conclusion IS NULL OR char_length(conclusion) <= 2000)
    AND (next_action IS NULL OR char_length(next_action) <= 2000)
    AND (limitations IS NULL OR char_length(limitations) <= 2000)
  )
);

CREATE TABLE public.operating_experiment_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID NOT NULL REFERENCES public.operating_experiments (id) ON DELETE RESTRICT,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL,
  CONSTRAINT operating_experiment_amendments_note_chk CHECK (
    char_length(btrim(note)) > 0 AND char_length(note) <= 2000
  )
);

CREATE INDEX operating_experiments_area_status_idx
  ON public.operating_experiments (area, status, updated_at DESC);

CREATE INDEX operating_experiment_amendments_experiment_idx
  ON public.operating_experiment_amendments (experiment_id, created_at);

COMMENT ON TABLE public.operating_experiments IS
  'One experiment registry for Distribution and Retention. '
  'Service role only, after requireTylerAdmin. '
  'No exposure counts and no automatic winner. '
  'Future assignment and outcome tables should reference id.';

COMMENT ON TABLE public.operating_experiment_amendments IS
  'Documented changes after an experiment leaves planned. '
  'These notes do not rewrite hypothesis, variants, or the primary outcome.';

ALTER TABLE public.operating_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operating_experiment_amendments ENABLE ROW LEVEL SECURITY;

-- A definition can change only while the row stays planned.
-- Leaving planned, or any later update, cannot rewrite the name, area,
-- hypothesis, variants, primary outcome, or decision criteria.
-- Completing cannot be saved as "not yet tested."
-- Nothing in this trigger declares a winner.

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

CREATE TRIGGER operating_experiments_protect_definition
  BEFORE UPDATE ON public.operating_experiments
  FOR EACH ROW
  EXECUTE PROCEDURE public.operating_experiments_protect_definition();

REVOKE ALL ON TABLE public.operating_experiments FROM anon;
REVOKE ALL ON TABLE public.operating_experiments FROM authenticated;
REVOKE ALL ON TABLE public.operating_experiments FROM PUBLIC;
REVOKE ALL ON TABLE public.operating_experiments FROM service_role;

REVOKE ALL ON TABLE public.operating_experiment_amendments FROM anon;
REVOKE ALL ON TABLE public.operating_experiment_amendments FROM authenticated;
REVOKE ALL ON TABLE public.operating_experiment_amendments FROM PUBLIC;
REVOKE ALL ON TABLE public.operating_experiment_amendments FROM service_role;

-- The application keeps experiment rows and amendment notes.
-- service_role may read and change them. It may not delete them.

GRANT SELECT, INSERT, UPDATE ON TABLE public.operating_experiments TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.operating_experiment_amendments TO service_role;

REVOKE ALL ON FUNCTION public.operating_experiments_protect_definition() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.operating_experiments_protect_definition() FROM anon;
REVOKE ALL ON FUNCTION public.operating_experiments_protect_definition() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.operating_experiments_protect_definition() TO service_role;
