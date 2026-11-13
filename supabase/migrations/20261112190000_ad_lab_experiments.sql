-- Summitt Ad Lab experiments, ad snapshots, and creative notes.
-- Does not recreate ad_lab_ads, ad_lab_daily_delivery, or ad_lab_import_batch.
-- Writes to those delivery tables stay on ad_lab_import_batch only.

CREATE TABLE IF NOT EXISTS public.ad_lab_creative_notes (
  account_id text NOT NULL,
  meta_ad_id text NOT NULL,
  hook text NOT NULL DEFAULT '',
  angle text NOT NULL DEFAULT '',
  audience text NOT NULL DEFAULT '',
  emotion text NOT NULL DEFAULT '',
  person_featured text NOT NULL DEFAULT '',
  offer text NOT NULL DEFAULT '',
  concept text NOT NULL DEFAULT '',
  hypothesis text NOT NULL DEFAULT '',
  variable_changed text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_lab_creative_notes_pkey PRIMARY KEY (account_id, meta_ad_id),
  CONSTRAINT ad_lab_creative_notes_ad_fk
    FOREIGN KEY (account_id, meta_ad_id)
    REFERENCES public.ad_lab_ads (account_id, meta_ad_id)
    ON DELETE RESTRICT,
  CONSTRAINT ad_lab_creative_notes_ad_id_chk CHECK (meta_ad_id ~ '^[0-9]{5,20}$'),
  CONSTRAINT ad_lab_creative_notes_hook_chk CHECK (char_length(hook) <= 500),
  CONSTRAINT ad_lab_creative_notes_angle_chk CHECK (char_length(angle) <= 500),
  CONSTRAINT ad_lab_creative_notes_audience_chk CHECK (char_length(audience) <= 500),
  CONSTRAINT ad_lab_creative_notes_emotion_chk CHECK (char_length(emotion) <= 500),
  CONSTRAINT ad_lab_creative_notes_person_chk CHECK (char_length(person_featured) <= 500),
  CONSTRAINT ad_lab_creative_notes_offer_chk CHECK (char_length(offer) <= 500),
  CONSTRAINT ad_lab_creative_notes_concept_chk CHECK (char_length(concept) <= 500),
  CONSTRAINT ad_lab_creative_notes_hypothesis_chk CHECK (char_length(hypothesis) <= 500),
  CONSTRAINT ad_lab_creative_notes_variable_chk CHECK (char_length(variable_changed) <= 500),
  CONSTRAINT ad_lab_creative_notes_notes_chk CHECK (char_length(notes) <= 2000)
);

CREATE TABLE IF NOT EXISTS public.ad_lab_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL,
  name text NOT NULL,
  question text NOT NULL DEFAULT '',
  hypothesis text NOT NULL DEFAULT '',
  success_metric text NOT NULL DEFAULT 'verified_trials',
  status text NOT NULL DEFAULT 'draft',
  starts_on date,
  review_on date,
  planned_days integer,
  budget_cents integer,
  stop_spend_cents integer,
  stop_clicks integer,
  stop_trials integer,
  variable_tested text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  outcome text NOT NULL DEFAULT '',
  winner_meta_ad_id text,
  what_worked text NOT NULL DEFAULT '',
  what_didnt text NOT NULL DEFAULT '',
  decision text NOT NULL DEFAULT '',
  next_test text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_lab_experiments_account_chk CHECK (account_id ~ '^[0-9]{5,20}$'),
  CONSTRAINT ad_lab_experiments_name_chk CHECK (char_length(name) BETWEEN 1 AND 160),
  CONSTRAINT ad_lab_experiments_question_chk CHECK (char_length(question) <= 1000),
  CONSTRAINT ad_lab_experiments_hypothesis_chk CHECK (char_length(hypothesis) <= 1000),
  CONSTRAINT ad_lab_experiments_metric_chk CHECK (
    success_metric IN ('outbound_ctr', 'verified_trials', 'paying_subscribers', 'cost_per_trial')
  ),
  CONSTRAINT ad_lab_experiments_status_chk CHECK (
    status IN ('draft', 'active', 'completed', 'archived')
  ),
  CONSTRAINT ad_lab_experiments_days_chk CHECK (planned_days IS NULL OR planned_days BETWEEN 1 AND 365),
  CONSTRAINT ad_lab_experiments_budget_chk CHECK (budget_cents IS NULL OR budget_cents >= 0),
  CONSTRAINT ad_lab_experiments_stop_spend_chk CHECK (stop_spend_cents IS NULL OR stop_spend_cents >= 0),
  CONSTRAINT ad_lab_experiments_stop_clicks_chk CHECK (stop_clicks IS NULL OR stop_clicks >= 0),
  CONSTRAINT ad_lab_experiments_stop_trials_chk CHECK (stop_trials IS NULL OR stop_trials >= 0),
  CONSTRAINT ad_lab_experiments_variable_chk CHECK (char_length(variable_tested) <= 500),
  CONSTRAINT ad_lab_experiments_notes_chk CHECK (char_length(notes) <= 2000),
  CONSTRAINT ad_lab_experiments_outcome_chk CHECK (char_length(outcome) <= 500),
  CONSTRAINT ad_lab_experiments_winner_chk CHECK (
    winner_meta_ad_id IS NULL OR winner_meta_ad_id ~ '^[0-9]{5,20}$'
  ),
  CONSTRAINT ad_lab_experiments_worked_chk CHECK (char_length(what_worked) <= 2000),
  CONSTRAINT ad_lab_experiments_didnt_chk CHECK (char_length(what_didnt) <= 2000),
  CONSTRAINT ad_lab_experiments_decision_chk CHECK (char_length(decision) <= 2000),
  CONSTRAINT ad_lab_experiments_next_chk CHECK (char_length(next_test) <= 2000)
);

CREATE INDEX IF NOT EXISTS ad_lab_experiments_account_status_idx
  ON public.ad_lab_experiments (account_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ad_lab_experiment_ads (
  experiment_id uuid NOT NULL,
  account_id text NOT NULL,
  meta_ad_id text NOT NULL,
  role text NOT NULL DEFAULT 'included',
  ad_name_snapshot text NOT NULL,
  campaign_name_snapshot text,
  CONSTRAINT ad_lab_experiment_ads_pkey PRIMARY KEY (experiment_id, meta_ad_id),
  CONSTRAINT ad_lab_experiment_ads_experiment_fk
    FOREIGN KEY (experiment_id)
    REFERENCES public.ad_lab_experiments (id)
    ON DELETE CASCADE,
  CONSTRAINT ad_lab_experiment_ads_ad_fk
    FOREIGN KEY (account_id, meta_ad_id)
    REFERENCES public.ad_lab_ads (account_id, meta_ad_id)
    ON DELETE RESTRICT,
  CONSTRAINT ad_lab_experiment_ads_role_chk CHECK (role IN ('included', 'control', 'challenger')),
  CONSTRAINT ad_lab_experiment_ads_name_chk CHECK (char_length(ad_name_snapshot) BETWEEN 1 AND 400),
  CONSTRAINT ad_lab_experiment_ads_campaign_chk CHECK (
    campaign_name_snapshot IS NULL OR char_length(campaign_name_snapshot) <= 400
  )
);

CREATE INDEX IF NOT EXISTS ad_lab_experiment_ads_account_ad_idx
  ON public.ad_lab_experiment_ads (account_id, meta_ad_id);

ALTER TABLE public.ad_lab_creative_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_lab_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_lab_experiment_ads ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ad_lab_creative_notes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ad_lab_experiments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ad_lab_experiment_ads FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ad_lab_creative_notes TO service_role;
GRANT SELECT ON TABLE public.ad_lab_experiments TO service_role;
GRANT SELECT ON TABLE public.ad_lab_experiment_ads TO service_role;

CREATE OR REPLACE FUNCTION public.ad_lab_save_experiment(
  p_account_id text,
  p_experiment jsonb,
  p_ads jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_id uuid;
  v_name text;
  v_status text;
  v_metric text;
  v_found uuid;
BEGIN
  IF p_account_id IS NULL OR p_account_id !~ '^[0-9]{5,20}$' THEN
    RAISE EXCEPTION 'invalid account';
  END IF;
  IF pg_catalog.jsonb_typeof(p_experiment) IS DISTINCT FROM 'object'
     OR pg_catalog.jsonb_typeof(p_ads) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid payload';
  END IF;
  IF pg_catalog.jsonb_array_length(p_ads) > 50 THEN
    RAISE EXCEPTION 'too many ads';
  END IF;

  v_name := left(btrim(COALESCE(p_experiment->>'name', '')), 160);
  IF char_length(v_name) < 1 THEN
    RAISE EXCEPTION 'name required';
  END IF;
  v_status := COALESCE(p_experiment->>'status', 'draft');
  IF v_status NOT IN ('draft', 'active', 'completed', 'archived') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;
  v_metric := COALESCE(p_experiment->>'success_metric', 'verified_trials');
  IF v_metric NOT IN ('outbound_ctr', 'verified_trials', 'paying_subscribers', 'cost_per_trial') THEN
    RAISE EXCEPTION 'invalid metric';
  END IF;

  IF v_status IN ('active', 'completed') AND pg_catalog.jsonb_array_length(p_ads) < 2 THEN
    RAISE EXCEPTION 'comparison needs ads';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_ads) AS submitted(meta_ad_id text)
    GROUP BY submitted.meta_ad_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate ad';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_ads) AS submitted(
      meta_ad_id text,
      role text,
      ad_name_snapshot text,
      campaign_name_snapshot text
    )
    WHERE submitted.meta_ad_id IS NULL
      OR submitted.meta_ad_id !~ '^[0-9]{5,20}$'
      OR submitted.role IS NULL
      OR submitted.role NOT IN ('included', 'control', 'challenger')
      OR submitted.ad_name_snapshot IS NULL
      OR char_length(btrim(submitted.ad_name_snapshot)) NOT BETWEEN 1 AND 400
      OR char_length(btrim(COALESCE(submitted.campaign_name_snapshot, ''))) > 400
      OR NOT EXISTS (
        SELECT 1
        FROM public.ad_lab_ads stored
        WHERE stored.account_id = p_account_id
          AND stored.meta_ad_id = submitted.meta_ad_id
      )
  ) THEN
    RAISE EXCEPTION 'invalid ad';
  END IF;

  IF NULLIF(btrim(COALESCE(p_experiment->>'winner_meta_ad_id', '')), '') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_catalog.jsonb_to_recordset(p_ads) AS submitted(meta_ad_id text)
       WHERE submitted.meta_ad_id = btrim(p_experiment->>'winner_meta_ad_id')
     ) THEN
    RAISE EXCEPTION 'winner not in experiment';
  END IF;

  BEGIN
    v_id := NULLIF(p_experiment->>'id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'invalid id';
  END;

  IF v_id IS NULL THEN
    INSERT INTO public.ad_lab_experiments (
      account_id, name, question, hypothesis, success_metric, status,
      starts_on, review_on, planned_days, budget_cents, stop_spend_cents,
      stop_clicks, stop_trials, variable_tested, notes, outcome,
      winner_meta_ad_id, what_worked, what_didnt, decision, next_test, updated_at
    ) VALUES (
      p_account_id,
      v_name,
      left(COALESCE(p_experiment->>'question', ''), 1000),
      left(COALESCE(p_experiment->>'hypothesis', ''), 1000),
      v_metric,
      v_status,
      NULLIF(p_experiment->>'starts_on', '')::date,
      NULLIF(p_experiment->>'review_on', '')::date,
      NULLIF(p_experiment->>'planned_days', '')::integer,
      NULLIF(p_experiment->>'budget_cents', '')::integer,
      NULLIF(p_experiment->>'stop_spend_cents', '')::integer,
      NULLIF(p_experiment->>'stop_clicks', '')::integer,
      NULLIF(p_experiment->>'stop_trials', '')::integer,
      left(COALESCE(p_experiment->>'variable_tested', ''), 500),
      left(COALESCE(p_experiment->>'notes', ''), 2000),
      left(COALESCE(p_experiment->>'outcome', ''), 500),
      NULLIF(left(btrim(COALESCE(p_experiment->>'winner_meta_ad_id', '')), 20), ''),
      left(COALESCE(p_experiment->>'what_worked', ''), 2000),
      left(COALESCE(p_experiment->>'what_didnt', ''), 2000),
      left(COALESCE(p_experiment->>'decision', ''), 2000),
      left(COALESCE(p_experiment->>'next_test', ''), 2000),
      pg_catalog.now()
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.ad_lab_experiments SET
      name = v_name,
      question = left(COALESCE(p_experiment->>'question', ''), 1000),
      hypothesis = left(COALESCE(p_experiment->>'hypothesis', ''), 1000),
      success_metric = v_metric,
      status = v_status,
      starts_on = NULLIF(p_experiment->>'starts_on', '')::date,
      review_on = NULLIF(p_experiment->>'review_on', '')::date,
      planned_days = NULLIF(p_experiment->>'planned_days', '')::integer,
      budget_cents = NULLIF(p_experiment->>'budget_cents', '')::integer,
      stop_spend_cents = NULLIF(p_experiment->>'stop_spend_cents', '')::integer,
      stop_clicks = NULLIF(p_experiment->>'stop_clicks', '')::integer,
      stop_trials = NULLIF(p_experiment->>'stop_trials', '')::integer,
      variable_tested = left(COALESCE(p_experiment->>'variable_tested', ''), 500),
      notes = left(COALESCE(p_experiment->>'notes', ''), 2000),
      outcome = left(COALESCE(p_experiment->>'outcome', ''), 500),
      winner_meta_ad_id = NULLIF(left(btrim(COALESCE(p_experiment->>'winner_meta_ad_id', '')), 20), ''),
      what_worked = left(COALESCE(p_experiment->>'what_worked', ''), 2000),
      what_didnt = left(COALESCE(p_experiment->>'what_didnt', ''), 2000),
      decision = left(COALESCE(p_experiment->>'decision', ''), 2000),
      next_test = left(COALESCE(p_experiment->>'next_test', ''), 2000),
      updated_at = pg_catalog.now()
    WHERE id = v_id AND account_id = p_account_id
    RETURNING id INTO v_found;
    IF v_found IS NULL THEN
      RAISE EXCEPTION 'not found';
    END IF;
    DELETE FROM public.ad_lab_experiment_ads WHERE experiment_id = v_id;
  END IF;

  INSERT INTO public.ad_lab_experiment_ads (
    experiment_id, account_id, meta_ad_id, role, ad_name_snapshot, campaign_name_snapshot
  )
  SELECT DISTINCT ON (x.meta_ad_id)
    v_id,
    p_account_id,
    x.meta_ad_id,
    x.role,
    btrim(x.ad_name_snapshot),
    NULLIF(btrim(COALESCE(x.campaign_name_snapshot, '')), '')
  FROM pg_catalog.jsonb_to_recordset(p_ads) AS x(
    meta_ad_id text,
    role text,
    ad_name_snapshot text,
    campaign_name_snapshot text
  )
  ORDER BY x.meta_ad_id;

  IF (
    SELECT count(*)
    FROM public.ad_lab_experiment_ads saved
    WHERE saved.experiment_id = v_id
  ) IS DISTINCT FROM pg_catalog.jsonb_array_length(p_ads) THEN
    RAISE EXCEPTION 'ad count mismatch';
  END IF;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.ad_lab_save_experiment(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_lab_save_experiment(text, jsonb, jsonb) TO service_role;

COMMENT ON TABLE public.ad_lab_creative_notes IS
  'Optional admin annotations. These never overwrite Meta ad names or delivery.';
COMMENT ON TABLE public.ad_lab_experiments IS
  'Admin-only advertising experiments. History stays when a Meta ad is later renamed.';
COMMENT ON TABLE public.ad_lab_experiment_ads IS
  'Ads in an experiment, with the name and campaign copied at save time.';
