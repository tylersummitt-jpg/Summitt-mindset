# Truth Spine Certification Pack — SQL Guide (v1.1 current-code-aware)

Read-only certification pack for comparing **real SMS threads** to **real persisted truth** before scaling to 2,500+ users.

**File:** `supabase/manual/truth_spine_certification_pack.sql`

**Default window (post-fix):** 2026-06-17 00:00 America/New_York through 2026-06-20 00:00 America/New_York exclusive.

**Historical wider window example:** 2026-06-11 through 2026-06-18 (includes pre-fix rows — use `fix_era` to separate).

**Scope:** All users. No `clerk_user_id` filters. No hard-coded personas.

## Critical: old SQL is not current bug proof

- Rows **before** the known fix cutover are **historical certification fixtures**, not proof that current code is broken.
- Do **not** treat pre-fix `completion_without_user_yes` or `meta_process_written_as_outcome` as live bugs without checking `fix_era`.
- For **current-code certification**, run a **post-fix window first** (`window_start >= known_fix_cutover`).

### Before you run — edit bounds in each query

```sql
WITH bounds AS (
  SELECT
    timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
    timestamptz '2026-06-20 00:00:00 America/New_York' AS window_end,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_user_yes,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_meta_process,
    timestamptz '2026-06-17 00:00:00 America/New_York' AS known_fix_cutover_at_weekly_miss_count
),
```

Adjust cutover timestamps to match **actual prod deploy** after the 2026-06-16 user_yes / meta_process fixes.

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

## Shared classification (v1.1)

Queries Q1, Q2, Q3–Q8, Q12, Q13 use the same **`classified_inbound`** pattern:

- `candidate_family` — regex discovery aid only
- `persistence_decision` / `server_reconciled_persistence_decision` — from turn telemetry
- `expected_persistence_decision` — server-first, not regex-only
- `fix_era` — `pre_known_fix_window` | `post_known_fix_window` | `unknown_fix_era`
- `cert_diagnostic` — persistence-aware (see below)
- `is_known_historical_fixture` — pattern match for certified example strings

## Recommended run order

1. **`certification_scoreboard` (Q12)** — start here (post-fix mismatch rollup)
2. **`Q13_known_fixture_drilldown`** — known historical fixtures + post-fix verification
3. **`master_thread_truth_reconciliation` (Q1)** — film room (filter to current failures)
4. **`outcome_candidate_gap_rollup` (Q2)** — gap clusters by day / diagnostic
5. **`user_yes_certification` (Q3)** — completion candidates
6. **`user_no_certification` (Q4)** — miss + meta/process negative controls
7. **`user_partial_certification` (Q5)** — partial-shaped messages
8. **`plan_memory_certification` (Q6)** — plan expected no proof
9. **`blocker_certification` (Q7)** — blocker capture heuristics
10. **`goal_change_raise_lower_certification` (Q8)** — contract/overlay state
11. **`victory_room_projection_certification` (Q9)** — spine proof → VR display eligibility
12. **`next_sms_truth_usage_certification` (Q10)** — next SMS truth usage
13. **`no_send_truth_loss_certification` (Q11)** — truth persisted despite no-send

## How to run in Supabase

1. Open **SQL Editor** → New query.
2. Copy **one** query block from `truth_spine_certification_pack.sql` (from `-- QUERY N` through its final `;`).
3. Edit `bounds` if needed (window + cutovers).
4. Run. Export CSV for triage.

### Q1 filter for current failures only

```sql
-- append to Q1:
WHERE cert_diagnostic IN (
  'current_code_failure_candidate',
  'expected_write_but_missing',
  'false_outcome_written'
)
```

## cert_diagnostic glossary

| Diagnostic | Meaning |
| --- | --- |
| `historical_pre_fix_observation` | Pre-cutover known fixture — not a current bug |
| `current_code_failure_candidate` | Post-fix known fixture expected write missing |
| `expected_write_but_missing` | Post-fix telemetry expected write, spine missing |
| `false_outcome_written` | Meta/plan/future wrote user_yes/no/partial |
| `outcome_written_ok` | Expected write + spine row align |
| `server_no_outcome_expected` | Correct silence (no outcome row) |
| `expected_no_write_and_none_written` | No write expected, none written |
| `regex_weak_manual_review` | Weak regex family — review body, not auto-bug |
| `telemetry_missing` | No turn telemetry — cert uncertain |
| `cert_join_uncertain` | Join/telemetry ambiguous |

## What success means (post-fix window)

- **Zero** `current_code_failure_candidate` for known fixtures (distribution, 10k steps, onboarding dispute)
- **Zero** post-fix `false_outcome_written` for meta/process/plan/future negatives
- Completion fixtures: `outcome_written_ok` or appropriate `server_no_outcome_expected`
- VR Q9: `should_display_in_vr` only on proof-backed rows; meta/plan/future negative controls pass

## What failure means

| Signal | Action |
| --- | --- |
| `expected_write_but_missing` post-fix | Current code bug candidate — investigate persist gate |
| `false_outcome_written` post-fix | Urgent fake proof / fake miss risk |
| High `regex_weak_manual_review` | Interpreter/cert gap or novel English — not necessarily prod bug |
| Spine missing truth | Fix spine first — **do not patch Victory Room UI** |

## What to paste back

1. **Q12 full result** (all `fix_era` × `cert_diagnostic` rows)
2. **Q13** rows for known fixtures
3. **Q1** rows where `cert_diagnostic IN ('current_code_failure_candidate','expected_write_but_missing','false_outcome_written')` and `fix_era = 'post_known_fix_window'`
4. **Q3/Q4** fixture drilldowns if failures exist
5. **Q6** plan diagnostics
6. **Q9** VR projection failures (`false_outcome_written`, `likely_vr_missing_projection`)

## Schema-safe patterns

- `to_jsonb(m|j|s)` for drift-prone columns
- Join spine via `payload_json->>'message_sid'` or idempotency key suffix
- Turn telemetry: `event_type = 'sms_memory_signal'` AND `inbound_turn_telemetry = 'true'`

## Known limitations

- Regex `candidate_family` is a discovery aid — **mismatch uses server `expected_persistence_decision`**, not regex alone.
- `pending_plan_proof` is runtime-only.
- Turn telemetry is best-effort — some inbounds lack rows (`telemetry_missing`).
- Victory Room loader is not snapshotted — Q9 uses spine `proof_moment*` fields.

## Validation

```bash
npm test -- src/lib/truth-spine-certification-sql.test.ts
```

## Related packs

- `stage_1b_truth_spine_cousin_audit.sql`
- `sms_soak_debug_pack.sql`
- `victory_room_sms_bridge_debug_pack.sql`
