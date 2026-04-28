-- Retention / reporting: additive truth columns + COMMENT ON (no drops, no renames).
-- Pairs with app dual-write in retention-metrics cron.

-- ---------------------------------------------------------------------------
-- retention_signals: parallel V2-spine / basis fields; legacy columns preserved.
-- ---------------------------------------------------------------------------
ALTER TABLE retention_signals
  ADD COLUMN IF NOT EXISTS retention_staleness_basis TEXT,
  ADD COLUMN IF NOT EXISTS last_v2_spine_activity_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hours_since_v2_spine INTEGER;

COMMENT ON TABLE retention_signals IS
  'Per-subscriber retention snapshot. Cron upserts: legacy-titled columns remain for backward '
  'compatibility; retention_staleness_basis, last_v2_spine_activity_at, and hours_since_v2_spine '
  'document the current V2/legacy model explicitly.';

COMMENT ON COLUMN retention_signals.hours_since_last_completion IS
  'Legacy column name. Whole hours of staleness for the user at compute time. For V2 users this '
  'uses the latest v2_commitment_event (or Clerk lastCompletedAt when no spine rows yet), same '
  'as the cron logic. Not a literal "completion" in the V2 system; see retention_staleness_basis.';

COMMENT ON COLUMN retention_signals.days_since_last_completion IS
  'Legacy column name. FLOOR(hours_since_last_completion / 24) from the same staleness hours.';

COMMENT ON COLUMN retention_signals.last_completed_at IS
  'Clerk public_metadata lastCompletedAt (cache). For V2 users it may lag or seed cold start; it '
  'is not the v2 commitment spine.';

COMMENT ON COLUMN retention_signals.retention_staleness_basis IS
  'v2_spine: staleness from latest v2_commitment_event. v2_clerk_cache_fallback: no spine rows, '
  'staleness from Clerk lastCompletedAt. legacy_clerk: non–fully-V2 user, staleness from Clerk.';

COMMENT ON COLUMN retention_signals.last_v2_spine_activity_at IS
  'MAX(v2_commitment_event created_at) for this user when any spine rows exist; NULL otherwise.';

COMMENT ON COLUMN retention_signals.hours_since_v2_spine IS
  'Whole hours since last v2 spine event when a row exists; NULL when the user has no '
  'v2_commitment_event rows.';

-- ---------------------------------------------------------------------------
-- retention_daily_rollups: split “touch” counts; legacy column names preserved.
-- ---------------------------------------------------------------------------
ALTER TABLE retention_daily_rollups
  ADD COLUMN IF NOT EXISTS v2_spine_touches_today INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS legacy_daily_completion_touches_today INTEGER NOT NULL DEFAULT 0;

COMMENT ON TABLE retention_daily_rollups IS
  'Per UTC day_key and staleness_mode bucket. completions_count is a legacy name for mixed '
  '"activity today"; v2_spine_touches_today and legacy_daily_completion_touches_today are additive.';

COMMENT ON COLUMN retention_daily_rollups.completions_count IS
  'Legacy name: users in this bucket with any qualifying touch for the day. V2: v2_commitment_event '
  'activity that UTC day; legacy: daily_completion_events for that day. See split columns.';

COMMENT ON COLUMN retention_daily_rollups.v2_spine_touches_today IS
  'Count of users in this bucket with at least one v2_commitment_event on day_key (UTC).';

COMMENT ON COLUMN retention_daily_rollups.legacy_daily_completion_touches_today IS
  'Count of users in this bucket (not on the fully-V2 path used by the cron) with '
  'daily_completion_events for day_key.';
