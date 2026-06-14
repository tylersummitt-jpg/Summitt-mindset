# Victory Room ↔ SMS Bridge Debug SQL Guide

Read-only runbook for proving the SMS ↔ Victory Room bridge during soak/tuning. **No production code changes** — run queries in Supabase SQL editor only.

## File

[`supabase/manual/victory_room_sms_bridge_debug_pack.sql`](../../supabase/manual/victory_room_sms_bridge_debug_pack.sql)

Companion to [`sms_soak_debug_pack.sql`](../../supabase/manual/sms_soak_debug_pack.sql) (lane health / Daily C1 intent). Use this pack when the soak question is **proof, goal overlay, Victory language, or edit bridge** — not general no-send volume.

## Date bounds

Every query uses:

```sql
WITH bounds AS (
  SELECT
    ('2026-06-13 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_start,
    ('2026-06-15 00:00:00'::timestamp AT TIME ZONE 'America/New_York') AS day_end
)
```

Change `day_start` / `day_end` in **each** query before running. `day_end` is exclusive.

## Recommended workflow

**First run order:** Query **11** → **3** → **1** → **5**, then optional deep-dives (2, 4, 6–10).

1. Set bounds to your soak window (e.g. 48h after Daily C1 deploy).
2. Run **Query 11** (`bridge_health_rollup`) first — one row per local day summary.
3. Run **Query 3** — shrink overlay / effective ask vs Victory Room goal.
4. Run **Query 1** — proof spine map; counts should align with Query 11 `proof_moment_true`.
5. Run **Query 5** — unsupported proof/Victory claims.
6. If displayability suspected → **Query 2**.
7. If Victory Room / proof language suspected → **Query 4**.
8. If no-send + proof suspected → **Query 6**.
9. If identity/goal edit bridge suspected → **Query 7**.
10. If SMS goal change suspected → **Query 8**.
11. If anchor privacy suspected → **Query 9** (counts only — no names).
12. If persisted proof copy looks gamified → **Query 10**.

Export CSV → share with read-only audit → behavior fix only if SQL proves harm.

## v1.1 fixes

### Query 11 — day rollup

v1.0 joined `day_series` timestamptz to `date_trunc` timestamps, which produced all-zero rollups when Query 1 had proof rows. v1.1:

- `day_series` uses **local ET dates**: `(bounds AT TIME ZONE 'America/New_York')::date`
- All rollup CTEs bucket with `(occurred_at AT TIME ZONE 'America/New_York')::date`
- Joins use `o.day_et = d.day_et` (date ↔ date)

`proof_moment_true` on Query 11 should match proof rows visible in Query 1 for the same bounds.

### Query 3 — commitment resolution + recommit false positives

- **No** `sms_send_events.commitment_id` column reference — resolves via metadata COALESCE + active `v2_commitment` by `clerk_user_id`.
- **`pending_same_base_recommit_proposal`** — informational only when `recommit_same` or proposal text equals base goal while overlay is inactive.
- **`pending_overlay_not_displayed`** — only true for real pending shrink/replace/change semantics, not same-base recommit.

**Do not treat as P1** if Query 3 shows only `pending_same_base_recommit_proposal=true` and all of `overlay_active_sql`, `sms_effective_ask_differs_from_victory_goal`, `active_overlay_not_displayed` are false.

## v1.2 fixes

### Query 6 and Query 7 — commitment resolution

v1.1 left `e.commitment_id` / `s.commitment_id` on `sms_send_events`, which has **no** `commitment_id` column — Queries 6 and 7 would error if run. v1.2:

- Resolves commitment via metadata COALESCE (`commitment_id`, `daily_v3_lane`, `relationship_packet_observability`, `payload_json`) + active `v2_commitment` by `clerk_user_id`.
- Query 6 inbound branch also COALESCEs from inbound telemetry when present.
- Query 7 lateral “next daily SMS” join uses the same pattern for `next_commitment_goal` / `next_effective_ask_sql`.

**All 11 queries should now be runnable** in Supabase SQL editor. Query 6 and Query 7 remain **optional deep dives** after the first-run quartet (11 → 3 → 1 → 5).

## Queries

| # | Name | Purpose |
|---|------|---------|
| 1 | `sms_outcome_to_proof_moment_map` | Spine events that create or neighbor proof |
| 2 | `proof_moments_displayability_candidates` | `proof_moment=true` rows + VR displayability heuristics |
| 3 | `victory_room_current_goal_vs_sms_effective_ask` | Shrink overlay / effective ask vs VR `behavior_statement` |
| 4 | `sms_victory_room_language_claims` | SMS bodies with Victory/proof/streak/manual-add language |
| 5 | `sms_proof_claim_without_saved_proof` | Proof/Victory language without nearby spine proof |
| 6 | `no_send_wrote_proof_check` | No-send rows with linked proof (state-first policy) |
| 7 | `app_identity_goal_edit_to_sms_context` | App edits → next daily SMS context |
| 8 | `sms_goal_change_to_victory_room_state` | SMS contract/shrink/replace → canonical commitment |
| 9 | `important_people_privacy_bridge` | Anchor counts vs people rows (no `display_name`) |
| 10 | `victory_room_surface_copy_risk_search` | Gamified/banned language in persisted proof lines |
| 11 | `bridge_health_rollup` | Daily bridge health counts |

## How to interpret key fields

### `proof_moment = true`

Proof metadata on `v2_commitment_event.payload_json` — **not** a separate table. Victory Room loader reads:

- `proof_moment === true`
- `proof_meaning_line` or `user_visible_proof_line`

If Query 1 shows `proof_moment=true` but Query 2 says `missing_proof_line`, Victory Room will not show a card.

### Effective ask mismatch (Query 3)

| Field | Meaning |
|-------|---------|
| `base_behavior_statement` | Canonical goal — **what Victory Room TopCard shows** |
| `effective_coaching_ask_sql` | Active overlay when `adaptive_ask_text` not expired, else base |
| `sms_effective_ask_differs_from_victory_goal` | SMS may coach on a different bar than VR displays |
| `active_overlay_not_displayed` | Shrink overlay active; VR still shows base goal |
| `pending_same_base_recommit_proposal` | **Informational** — `recommit_same` or same-text proposal; not a bridge risk |
| `pending_overlay_not_displayed` | Real pending shrink/replace/change proposal differs from VR-visible base |

**Expected during shrink:** `active_overlay_not_displayed` or `sms_effective_ask_differs_from_victory_goal` true. **Not P1** if only `pending_same_base_recommit_proposal` is true.

### Proof language (Queries 4–5)

| `risk_label` / `risk_reason` | Severity |
|------------------------------|----------|
| `possible_manual_add_language` | **P0 candidate** — "add this", "may belong", "consider adding" |
| `possible_saved_claim` without permission | **P0 candidate** |
| `victory_room_without_permission` | **P1** |
| `proof_claim_without_permission` | **P1** |
| `possible_truthful_proof_reference` with linked proof | Soak OK — review copy |
| `needs_manual_review` | **P2** |

Inbound spine persist runs **before** V3 lane send. No-send + proof (Query 6) is often **correct** for `blocker_captured` and explicit outcomes (`correct_if_inbound_truth_before_send`).

### Edit bridge (Query 7)

Compare `edited_preview` to `next_profile_identity` / `next_commitment_goal` on the **first daily SMS after edit**. Mismatch flags:

- `sms_used_old_identity` / `sms_used_old_goal` → **P1**
- `unknown` → no daily SMS yet in window

## Severity guide

| Class | Examples from this pack |
|-------|-------------------------|
| **P0** | Query 5: saved/manual-add language with no proof + no permission |
| **P1** | Query 3: active overlay mismatch during shrink soak; Query 7: stale goal after app edit |
| **P2** | Query 10: benign wording; Query 2: missing category on old rows |
| **Soak** | Query 6: intentional no-send proof; Query 4: category language with linked proof; Query 3: `pending_same_base_recommit_proposal` only |

## Privacy

Query 9 **does not** select `important_people.display_name`. A commented optional block at the end of Query 9 may be uncommented locally for manual privacy audits only.

## Data gaps

- Victory Room UI copy ("trophy room", "no scoreboard") is **not in DB** — Query 10 notes code paths; UI audit is separate.
- `sms_send_events` and inbound jobs have no `commitment_id` column — pack resolves via metadata COALESCE + active `v2_commitment` by `clerk_user_id`.
- Pre-consolidation rows may lack `relationship_packet_observability` proof permission fields.
- Query 2 displayability heuristics approximate `loadVictoryRoomView` — not a full loader replay.
- Victory Room Recent Proof caps at 5 curated cards / 400 event window — proof may exist in spine but not appear on home.

## Do not

- Run INSERT/UPDATE/DELETE from this pack.
- Use results to mutate production state.
- Treat regex language hits as automatic guilt — always manual review.
