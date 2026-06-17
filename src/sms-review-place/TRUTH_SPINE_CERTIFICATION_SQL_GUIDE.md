# Truth Spine Certification Pack — SQL Guide

Read-only certification pack for comparing **real SMS threads** to **real persisted truth** before scaling to 2,500+ users.

**File:** `supabase/manual/truth_spine_certification_pack.sql`

**Window (default):** 2026-06-11 00:00 America/New_York through 2026-06-18 00:00 America/New_York exclusive.

**Scope:** All users. No `clerk_user_id` filters. No hard-coded personas.

## What this certifies

| Layer | Source tables |
| --- | --- |
| Inbound user SMS | `sms_inbound_messages`, `sms_inbound_coach_jobs` |
| Coach reply / no-send | `sms_inbound_coach_jobs`, turn telemetry on `v2_commitment_event` |
| Meaning + persistence | `v2_commitment_event` (`sms_memory_signal` + `inbound_turn_telemetry`) |
| Accountability outcomes | `v2_commitment_event` (`user_yes`, `user_no`, `user_partial`) |
| Blockers / contracts | `v2_commitment_event`, `v2_commitment` pending/overlay columns |
| Plans / open loops | `v2_commitment_sms_thread_memory`, telemetry open-loop counts |
| Next outbound | `sms_send_events`, `sms_weekly_send_events`, `v2_commitment_event` `check_sent` |
| Victory Room projection | `v2_commitment_event` `proof_moment*` fields (loader reads spine live) |

## Recommended run order

1. **`certification_scoreboard`** — start here (rollup mismatch rates)
2. **`master_thread_truth_reconciliation`** — film room: one row per inbound SMS
3. **`outcome_candidate_gap_rollup`** — where gaps cluster by day/family/diagnostic
4. **`user_yes_certification`** — completion candidates only
5. **`user_no_certification`** — miss vs meta/process disputes
6. **`user_partial_certification`** — partial-shaped messages (observe before coding)
7. **`plan_memory_certification`** — plan memory + next-daily usage heuristic
8. **`blocker_certification`** — blocker capture + next-daily reference heuristic
9. **`goal_change_raise_lower_certification`** — contract/goal change state events
10. **`victory_room_projection_certification`** — proof displayability
11. **`next_sms_truth_usage_certification`** — did the next SMS use truth?
12. **`no_send_truth_loss_certification`** — truth persisted despite no-send?

## How to run in Supabase

1. Open **SQL Editor** → New query.
2. Copy **one** query block from `truth_spine_certification_pack.sql` (from `-- QUERY N` through its final `;`).
3. Run. Export CSV for triage.
4. To change the window, edit the `bounds` CTE in that query:
   ```sql
   WITH bounds AS (
     SELECT
       timestamptz '2026-06-11 00:00:00 America/New_York' AS window_start,
       timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
   ),
   ```

## Schema-safe patterns

This pack uses `to_jsonb(alias)` for tables that may have column drift across environments:

- **sms_inbound_messages** — body/timestamp via JSON paths (not `m.created_at`)
- **sms_inbound_coach_jobs** — status, reply, timestamps via `to_jsonb(j)`
- **sms_send_events / sms_weekly_send_events** — body via metadata JSON paths (not `s.sms_body`)
- **v2_commitment** — effective ask via adaptive overlay COALESCE (not `c.effective_ask`)

Join key: `message_sid` ↔ `payload_json->>'message_sid'` ↔ idempotency key suffix.

## Interpreting diagnostics

| Diagnostic | Meaning |
| --- | --- |
| `outcome_written_ok` | Candidate family + persistence + spine row align |
| `no_outcome_expected` | Meta/plan/support where `no_outcome_write` is correct |
| `completion_without_user_yes` | Completion candidate but no `user_yes` row |
| `miss_without_user_no` | Miss candidate but no `user_no` row |
| `meta_process_written_as_outcome` | Onboarding/coach dispute wrote `user_no` |
| `truth_persisted_despite_no_send` | Good: durable truth without visible reply |
| `truth_lost_due_to_no_send` | Bad: important truth + no spine row |
| `manual_review` | Heuristic uncertain — read body previews |

## Known limitations

- **`pending_plan_proof`** is runtime-only — not in DB; plan certification uses thread memory + telemetry heuristics.
- **Next-daily plan/blocker reference** columns are substring heuristics, not proof of strategy-card hydration.
- **Previous coach ask** uses latest `check_sent` / daily outbound / thread memory before inbound — may miss mid-thread context.
- **Regex candidate detectors** produce false positives; triage `inbound_body_preview` before product changes.
- **Victory Room** loader is not snapshotted per page view — certification uses spine `proof_moment*` fields the loader would read.
- **Turn telemetry** inserts are best-effort — some inbounds lack `inbound_turn_telemetry` rows.
- Tables `sms_inbound_messages`, `sms_send_events`, `sms_weekly_send_events` may exist in prod without repo migrations.

## Validation

```bash
npm test -- src/lib/truth-spine-certification-sql.test.ts
```

## Related packs

- `stage_1b_truth_spine_cousin_audit.sql` — cousin health rollup (lighter)
- `sms_soak_debug_pack.sql` — lane/no-send observability
- `victory_room_sms_bridge_debug_pack.sql` — proof displayability deep dive
