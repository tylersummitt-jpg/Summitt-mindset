-- =============================================================================
-- DATA ONLY: normalize sms_audience.sms_time_preference
-- =============================================================================
-- Goal: align legacy values → "morning" | "evening" only (before Clerk sync).
--
-- RULES APPLIED (single transaction below):
--   early_morning → morning
--   midday        → evening
--   afternoon     → evening
--   NULL          → evening
--
-- PREREQUISITES:
--   1. Run ANALYSIS queries (see bottom of file) in read-only / staging first.
--   2. Backup: CREATE TABLE sms_audience_pref_backup AS
--        SELECT clerk_user_id, sms_time_preference, updated_at FROM sms_audience;
--   3. Apply this migration only after review. Reversible only if backup exists.
--
-- NOTE: This file does NOT touch Clerk. Run Clerk updates or syncSmsAudience
-- separately (see project ops docs).
-- =============================================================================

BEGIN;

UPDATE sms_audience
SET
  sms_time_preference = CASE
    WHEN sms_time_preference IS NULL THEN 'evening'
    WHEN sms_time_preference = 'early_morning' THEN 'morning'
    WHEN sms_time_preference = 'midday' THEN 'evening'
    WHEN sms_time_preference = 'afternoon' THEN 'evening'
    ELSE sms_time_preference
  END,
  updated_at = now()
WHERE
  sms_time_preference IS NULL
  OR sms_time_preference IN ('early_morning', 'midday', 'afternoon');

COMMIT;

-- =============================================================================
-- STEP 1 — ANALYSIS (run BEFORE the transaction above; do not ship as migration)
-- =============================================================================
--
-- 1) Count by preference:
--   SELECT sms_time_preference, COUNT(*) AS n
--   FROM sms_audience
--   GROUP BY sms_time_preference
--   ORDER BY n DESC;
--
-- 2) NULL rows:
--   SELECT clerk_user_id, phone_number, summitt_subscribed, sms_enabled
--   FROM sms_audience
--   WHERE sms_time_preference IS NULL;
--
-- 3) Values outside canonical set (after you intend only morning | evening):
--   SELECT sms_time_preference, COUNT(*) AS n
--   FROM sms_audience
--   WHERE sms_time_preference IS NOT NULL
--     AND sms_time_preference NOT IN (
--       'morning', 'evening', 'early_morning', 'midday', 'afternoon'
--     )
--   GROUP BY sms_time_preference
--   ORDER BY n DESC;
--
-- 4) Clerk: no SQL join from Supabase. Options:
--    a) Export Clerk users (Dashboard → Users → export, or Clerk API list users)
--       with public_metadata.smsTimePreference + clerk_user_id (user id).
--    b) Save as CSV and compare in spreadsheet on clerk_user_id:
--         audience.sms_time_preference vs clerk.smsTimePreference
--    c) Spot-check high-value users manually in Clerk Dashboard.
--
-- =============================================================================
-- STEP 4 — VERIFICATION (run AFTER migration + Clerk sync)
-- =============================================================================
--
-- Only morning | evening:
--   SELECT sms_time_preference, COUNT(*) AS n
--   FROM sms_audience
--   GROUP BY sms_time_preference
--   ORDER BY n DESC;
--   -- Expect only 'morning' and 'evening' rows.
--
-- No NULL:
--   SELECT COUNT(*) AS null_rows FROM sms_audience
--   WHERE sms_time_preference IS NULL;
--   -- Expect 0.
--
-- Unexpected values (should return 0 rows):
--   SELECT clerk_user_id, sms_time_preference
--   FROM sms_audience
--   WHERE sms_time_preference IS NOT NULL
--     AND sms_time_preference NOT IN ('morning', 'evening');
--
-- =============================================================================
-- ROLLBACK (only if backup table exists — example)
-- =============================================================================
--
-- BEGIN;
-- UPDATE sms_audience sa
-- SET
--   sms_time_preference = b.sms_time_preference,
--   updated_at = now()
-- FROM sms_audience_pref_backup b
-- WHERE sa.clerk_user_id = b.clerk_user_id;
-- COMMIT;
