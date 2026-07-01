-- =============================================================================
-- TYLER TEXT OVERVIEW — POST-MIGRATION VERIFICATION (SELECT / INSPECTION ONLY)
-- =============================================================================
-- Run AFTER manually applying in Supabase SQL Editor:
--   supabase/migrations/20260701120000_tyler_text_overview.sql
--
-- No DDL. No DML. No INSERT test rows.
-- Healthy: summary row shows expected_checks = passed_checks (or all critical pass).
-- =============================================================================


-- =============================================================================
-- CHECK 01 — tables exist
-- Healthy: both tables present with expected row count = 1 each.
-- =============================================================================
SELECT
  'TTO_VERIFY_01_tables_exist' AS check_id,
  t.table_name,
  CASE WHEN t.table_name IS NOT NULL THEN 'pass' ELSE 'fail' END AS result
FROM (
  VALUES
    ('sms_daily_draft_generations'::text),
    ('sms_daily_drafts'::text)
) AS expected(table_name)
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public'
 AND t.table_name = expected.table_name
ORDER BY expected.table_name;


-- =============================================================================
-- CHECK 02 — required columns exist (generations)
-- Healthy: every expected column returns result = pass.
-- =============================================================================
WITH expected AS (
  SELECT unnest(ARRAY[
    'id', 'clerk_user_id', 'draft_for_day_key', 'generation_number', 'generated_at',
    'generation_reason', 'commitment_id', 'machine_draft_body', 'machine_should_send',
    'machine_no_send_reason', 'writer_openai_messages', 'writer_prompt_path',
    'writer_notebook_snapshot', 'notebook_hash', 'notebook_verdict', 'notebook_verdict_reason',
    'notebook_source_candidate_count', 'notebook_exact_source_message_count',
    'notebook_thread_message_count', 'notebook_filtered_out_reason_top', 'route_kind',
    'generation_metadata', 'last_inbound_at_at_generation', 'last_outbound_at_at_generation',
    'timezone_snapshot', 'send_pref_snapshot', 'machine_body_hash',
    'superseded_by_generation_id', 'superseded_at', 'created_at'
  ]::text[]) AS column_name
)
SELECT
  'TTO_VERIFY_02_generations_columns' AS check_id,
  e.column_name,
  CASE WHEN c.column_name IS NOT NULL THEN 'pass' ELSE 'fail' END AS result
FROM expected e
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = 'sms_daily_draft_generations'
 AND c.column_name = e.column_name
ORDER BY e.column_name;


-- =============================================================================
-- CHECK 03 — required columns exist (drafts)
-- Healthy: every expected column returns result = pass.
-- =============================================================================
WITH expected AS (
  SELECT unnest(ARRAY[
    'id', 'clerk_user_id', 'draft_for_day_key', 'current_generation_id',
    'current_body_to_send', 'current_body_source', 'edited_by_tyler', 'edited_at',
    'edit_distance_chars', 'machine_body_hash', 'current_body_hash', 'status',
    'created_at', 'updated_at', 'sent_at', 'source_sms_send_event_id',
    'twilio_message_sid', 'final_body_sent'
  ]::text[]) AS column_name
)
SELECT
  'TTO_VERIFY_03_drafts_columns' AS check_id,
  e.column_name,
  CASE WHEN c.column_name IS NOT NULL THEN 'pass' ELSE 'fail' END AS result
FROM expected e
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = 'sms_daily_drafts'
 AND c.column_name = e.column_name
ORDER BY e.column_name;


-- =============================================================================
-- CHECK 04 — required constraints / uniques / FKs
-- Healthy: each constraint_name found with result = pass.
-- =============================================================================
WITH expected AS (
  SELECT unnest(ARRAY[
    'sms_daily_draft_generations_user_day_gen_unique',
    'sms_daily_drafts_user_day_unique',
    'sms_daily_draft_generations_generation_reason_check',
    'sms_daily_draft_generations_notebook_verdict_check',
    'sms_daily_drafts_current_body_source_check',
    'sms_daily_drafts_status_check'
  ]::text[]) AS constraint_name
)
SELECT
  'TTO_VERIFY_04_named_constraints' AS check_id,
  e.constraint_name,
  CASE WHEN tc.constraint_name IS NOT NULL THEN 'pass' ELSE 'fail' END AS result
FROM expected e
LEFT JOIN information_schema.table_constraints tc
  ON tc.table_schema = 'public'
 AND tc.constraint_name = e.constraint_name
ORDER BY e.constraint_name;


-- =============================================================================
-- CHECK 05 — foreign keys (best-effort by referenced table)
-- Healthy: current_generation_id -> generations; superseded self-FK present.
-- =============================================================================
SELECT
  'TTO_VERIFY_05_foreign_keys' AS check_id,
  tc.constraint_name,
  kcu.table_name,
  kcu.column_name,
  ccu.table_name AS references_table,
  ccu.column_name AS references_column,
  'pass' AS result
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_schema = kcu.constraint_schema
 AND tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_schema = tc.constraint_schema
 AND ccu.constraint_name = tc.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.constraint_type = 'FOREIGN KEY'
  AND kcu.table_name IN ('sms_daily_draft_generations', 'sms_daily_drafts')
ORDER BY kcu.table_name, kcu.column_name;


-- =============================================================================
-- CHECK 06 — indexes exist
-- Healthy: all four named indexes present.
-- =============================================================================
WITH expected AS (
  SELECT unnest(ARRAY[
    'idx_sms_daily_draft_generations_user_day_generated',
    'idx_sms_daily_draft_generations_day_reason',
    'idx_sms_daily_drafts_current_generation',
    'idx_sms_daily_drafts_day_status',
    'idx_sms_daily_drafts_source_send_event'
  ]::text[]) AS index_name
)
SELECT
  'TTO_VERIFY_06_indexes' AS check_id,
  e.index_name,
  CASE WHEN i.indexname IS NOT NULL THEN 'pass' ELSE 'fail' END AS result
FROM expected e
LEFT JOIN pg_indexes i
  ON i.schemaname = 'public'
 AND i.indexname = e.index_name
ORDER BY e.index_name;


-- =============================================================================
-- CHECK 07 — RLS enabled
-- Healthy: relrowsecurity = true for both tables.
-- =============================================================================
SELECT
  'TTO_VERIFY_07_rls_enabled' AS check_id,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  CASE WHEN c.relrowsecurity THEN 'pass' ELSE 'fail' END AS result
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('sms_daily_draft_generations', 'sms_daily_drafts')
ORDER BY c.relname;


-- =============================================================================
-- CHECK 08 — grants / revokes (best-effort)
-- Healthy: anon/authenticated/PUBLIC should NOT have SELECT/INSERT/UPDATE/DELETE.
-- Note: service_role / postgres may still have access — that is expected for server runtime.
-- =============================================================================
SELECT
  'TTO_VERIFY_08_table_privileges' AS check_id,
  table_name,
  grantee,
  string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges,
  CASE
    WHEN grantee IN ('anon', 'authenticated', 'PUBLIC')
     AND bool_or(privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
    THEN 'fail'
    WHEN grantee IN ('anon', 'authenticated', 'PUBLIC')
    THEN 'pass'
    ELSE 'info'
  END AS result
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND table_name IN ('sms_daily_draft_generations', 'sms_daily_drafts')
GROUP BY table_name, grantee
ORDER BY table_name, grantee;


-- =============================================================================
-- CHECK 09 — generation_reason check values (inspection)
-- Healthy: check constraint definition includes all MVP reasons.
-- =============================================================================
SELECT
  'TTO_VERIFY_09_generation_reason_check' AS check_id,
  con.conname AS constraint_name,
  pg_get_constraintdef(con.oid) AS constraint_definition,
  CASE
    WHEN pg_get_constraintdef(con.oid) LIKE '%noon_batch%'
     AND pg_get_constraintdef(con.oid) LIKE '%evening_sweep%'
     AND pg_get_constraintdef(con.oid) LIKE '%pre_send_stale_refresh%'
    THEN 'pass'
    ELSE 'review'
  END AS result
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
  AND rel.relname = 'sms_daily_draft_generations'
  AND con.conname = 'sms_daily_draft_generations_generation_reason_check';


-- =============================================================================
-- CHECK 10 — final summary (pass/fail-ish counts)
-- Healthy: failed_checks = 0 before enabling TYLER_TEXT_OVERVIEW_ENABLED=true.
-- =============================================================================
WITH checks AS (
  SELECT result FROM (
    SELECT CASE WHEN COUNT(*) = 2 THEN 'pass' ELSE 'fail' END AS result
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('sms_daily_draft_generations', 'sms_daily_drafts')
  ) t

  UNION ALL

  SELECT CASE WHEN COUNT(*) = 30 THEN 'pass' ELSE 'fail' END
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'sms_daily_draft_generations'

  UNION ALL

  SELECT CASE WHEN COUNT(*) = 18 THEN 'pass' ELSE 'fail' END
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'sms_daily_drafts'

  UNION ALL

  SELECT CASE WHEN COUNT(*) = 2 THEN 'pass' ELSE 'fail' END
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('sms_daily_draft_generations', 'sms_daily_drafts')
    AND c.relrowsecurity = true

  UNION ALL

  SELECT CASE WHEN COUNT(*) = 5 THEN 'pass' ELSE 'fail' END
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname IN (
      'idx_sms_daily_draft_generations_user_day_generated',
      'idx_sms_daily_draft_generations_day_reason',
      'idx_sms_daily_drafts_current_generation',
      'idx_sms_daily_drafts_day_status',
      'idx_sms_daily_drafts_source_send_event'
    )
)
SELECT
  'TTO_VERIFY_10_summary' AS check_id,
  COUNT(*) FILTER (WHERE result = 'pass') AS passed_checks,
  COUNT(*) FILTER (WHERE result = 'fail') AS failed_checks,
  COUNT(*) AS expected_checks,
  CASE WHEN COUNT(*) FILTER (WHERE result = 'fail') = 0 THEN 'READY_FOR_ENV_ENABLE' ELSE 'FIX_BEFORE_ENV_ENABLE' END AS recommendation
FROM checks;
