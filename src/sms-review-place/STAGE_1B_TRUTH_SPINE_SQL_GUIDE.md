# Stage 1b Truth Spine Cousin Audit — SQL Guide

Read-only observability pack for auditing truth-spine cousins before any miss/partial code changes.

**File:** `supabase/manual/stage_1b_truth_spine_cousin_audit.sql`

**Window (default):** 2026-06-11 00:00 America/New_York through 2026-06-17 00:00 America/New_York exclusive.

**Scope:** All users. No user-specific filters.

## Recommended run order

1. `truth_spine_health_rollup` — start here (one row per day)
2. `reported_completion_no_write_post_fix_monitor` — post-fix completion gap monitor
3. `daily_outcome_spine_health_by_user` — per-user/day spine volume
4. `explicit_miss_candidates_without_user_no`
5. `explicit_partial_candidates_without_user_partial`
6. `sent_inbound_reply_without_truth_spine_row`
7. `victory_room_displayability_from_truth_spine`
8. `plan_answer_to_prior_question_telemetry`
9. `blocker_captured_health`
10. `contract_raise_lower_change_health`

## Schema-safe v1.1 notes

Supabase environments may not have every column the app types assume. This pack uses `to_jsonb(table_alias)` for:

- **sms_send_events** — body preview via JSON paths only (no direct `s.body` / `s.sms_body`)
- **sms_inbound_messages** — timestamp and body via JSON paths (no direct `m.created_at`)
- **v2_commitment** — effective ask via `approximate_effective_ask_sql` (no direct `c.effective_ask`)

`sms_inbound_coach_jobs` joins still use `message_sid` as the durable join key; job fields prefer `to_jsonb(j)` where timestamps/status may vary.

## Interpreting results

| Query | Healthy signal | Investigate when |
| --- | --- | --- |
| Rollup | `reported_completion_no_write` trends down post-fix | Gap counters rise day-over-day |
| Miss/partial candidates | Zero or explainable noise rows | Material volume with `no_outcome_write` |
| Plan telemetry | `no_outcome_write` expected | Plans never appear in next-daily heuristics |
| Blocker health | `blocker_captured` rows with proof lines | Blockers never referenced in next daily |
| Contract health | Overlay/refresh events with payload asks | Handoffs without matching spine events |
| VR displayability | `likely_displayable = true` on spine rows | Outcomes without proof lines |

## Limits

- Next-daily plan/blocker columns are **heuristic** (metadata + body substring), not proof of `pending_plan_proof` hydration.
- Regex miss/partial detectors produce false positives on life-context classifier noise — triage body preview before coding.
- `approximate_effective_ask_sql` may differ from runtime effective ask when adaptive overlay timing is ambiguous.

## Validation

```bash
npm test -- src/lib/stage-1b-truth-spine-sql.test.ts
```
