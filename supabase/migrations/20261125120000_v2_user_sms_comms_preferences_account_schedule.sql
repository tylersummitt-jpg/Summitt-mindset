-- Account Daily Texts preferences.
-- Additive columns on the existing preference row. No backfill.
-- weekly_schedule NULL = the member has not saved an Account schedule.
-- A JSON object with seven null days = scheduled proactive texts are explicitly off.
-- pause_indefinite does not clear pause_until. Existing rows default to false.

ALTER TABLE public.v2_user_sms_comms_preferences
  ADD COLUMN weekly_schedule jsonb,
  ADD COLUMN schedule_timezone text,
  ADD COLUMN pause_indefinite boolean NOT NULL DEFAULT false;

-- No subqueries: PostgreSQL rejects them inside CHECK.
-- Equality with a seven-key object rejects unknown keys.
-- CASE keeps a missing or non-numeric value FALSE, not SQL NULL.
ALTER TABLE public.v2_user_sms_comms_preferences
  ADD CONSTRAINT v2_user_sms_comms_preferences_weekly_schedule_shape
  CHECK (
    weekly_schedule IS NULL
    OR (
      jsonb_typeof(weekly_schedule) = 'object'
      AND weekly_schedule = jsonb_build_object(
        'monday', weekly_schedule->'monday',
        'tuesday', weekly_schedule->'tuesday',
        'wednesday', weekly_schedule->'wednesday',
        'thursday', weekly_schedule->'thursday',
        'friday', weekly_schedule->'friday',
        'saturday', weekly_schedule->'saturday',
        'sunday', weekly_schedule->'sunday'
      )
      AND CASE jsonb_typeof(weekly_schedule->'monday')
        WHEN 'null' THEN true
        WHEN 'number' THEN CASE
          WHEN (weekly_schedule->>'monday') ~ '^(0|[1-9][0-9]{0,3})$'
          THEN (weekly_schedule->>'monday')::integer BETWEEN 0 AND 1439
          ELSE false
        END
        ELSE false
      END
      AND CASE jsonb_typeof(weekly_schedule->'tuesday')
        WHEN 'null' THEN true
        WHEN 'number' THEN CASE
          WHEN (weekly_schedule->>'tuesday') ~ '^(0|[1-9][0-9]{0,3})$'
          THEN (weekly_schedule->>'tuesday')::integer BETWEEN 0 AND 1439
          ELSE false
        END
        ELSE false
      END
      AND CASE jsonb_typeof(weekly_schedule->'wednesday')
        WHEN 'null' THEN true
        WHEN 'number' THEN CASE
          WHEN (weekly_schedule->>'wednesday') ~ '^(0|[1-9][0-9]{0,3})$'
          THEN (weekly_schedule->>'wednesday')::integer BETWEEN 0 AND 1439
          ELSE false
        END
        ELSE false
      END
      AND CASE jsonb_typeof(weekly_schedule->'thursday')
        WHEN 'null' THEN true
        WHEN 'number' THEN CASE
          WHEN (weekly_schedule->>'thursday') ~ '^(0|[1-9][0-9]{0,3})$'
          THEN (weekly_schedule->>'thursday')::integer BETWEEN 0 AND 1439
          ELSE false
        END
        ELSE false
      END
      AND CASE jsonb_typeof(weekly_schedule->'friday')
        WHEN 'null' THEN true
        WHEN 'number' THEN CASE
          WHEN (weekly_schedule->>'friday') ~ '^(0|[1-9][0-9]{0,3})$'
          THEN (weekly_schedule->>'friday')::integer BETWEEN 0 AND 1439
          ELSE false
        END
        ELSE false
      END
      AND CASE jsonb_typeof(weekly_schedule->'saturday')
        WHEN 'null' THEN true
        WHEN 'number' THEN CASE
          WHEN (weekly_schedule->>'saturday') ~ '^(0|[1-9][0-9]{0,3})$'
          THEN (weekly_schedule->>'saturday')::integer BETWEEN 0 AND 1439
          ELSE false
        END
        ELSE false
      END
      AND CASE jsonb_typeof(weekly_schedule->'sunday')
        WHEN 'null' THEN true
        WHEN 'number' THEN CASE
          WHEN (weekly_schedule->>'sunday') ~ '^(0|[1-9][0-9]{0,3})$'
          THEN (weekly_schedule->>'sunday')::integer BETWEEN 0 AND 1439
          ELSE false
        END
        ELSE false
      END
    )
  );

ALTER TABLE public.v2_user_sms_comms_preferences
  ADD CONSTRAINT v2_user_sms_comms_preferences_schedule_timezone_shape
  CHECK (
    schedule_timezone IS NULL
    OR (
      char_length(schedule_timezone) BETWEEN 1 AND 80
      AND schedule_timezone ~ '^[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+)*$'
    )
  );
