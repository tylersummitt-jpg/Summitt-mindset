-- Read-only drift detection for season lifecycle alignment (ops / manual review).
-- Does NOT repair automatically.

-- Active season pointing at a non-active commitment
SELECT s.id AS season_id,
       s.clerk_user_id,
       s.commitment_id,
       s.status AS season_status,
       c.status AS commitment_status
FROM user_accountability_season s
JOIN v2_commitment c ON c.id = s.commitment_id
WHERE s.status = 'active'
  AND c.status IS DISTINCT FROM 'active';

-- Active season commitment_id != user's active commitment id
SELECT s.id AS season_id,
       s.clerk_user_id,
       s.commitment_id AS season_commitment_id,
       ac.id AS active_commitment_id
FROM user_accountability_season s
JOIN v2_commitment ac
  ON ac.clerk_user_id = s.clerk_user_id
 AND ac.status = 'active'
WHERE s.status = 'active'
  AND s.commitment_id IS DISTINCT FROM ac.id;

-- Active commitment with no active season
SELECT c.id AS commitment_id,
       c.clerk_user_id,
       c.behavior_statement
FROM v2_commitment c
LEFT JOIN user_accountability_season s
  ON s.clerk_user_id = c.clerk_user_id
 AND s.status = 'active'
WHERE c.status = 'active'
  AND s.id IS NULL;

-- Snapshot drift: active season goal_snapshot behavior != live commitment bar
SELECT s.id AS season_id,
       s.clerk_user_id,
       s.commitment_id,
       s.goal_snapshot->>'behavior_statement' AS snapshot_behavior,
       c.behavior_statement AS live_behavior
FROM user_accountability_season s
JOIN v2_commitment c ON c.id = s.commitment_id
WHERE s.status = 'active'
  AND trim(coalesce(s.goal_snapshot->>'behavior_statement', '')) IS DISTINCT FROM
      trim(coalesce(c.behavior_statement, ''));

-- Completed season missing ended_at
SELECT id,
       clerk_user_id,
       commitment_id,
       season_name,
       status,
       started_at
FROM user_accountability_season
WHERE status IN ('completed', 'archived')
  AND ended_at IS NULL;
