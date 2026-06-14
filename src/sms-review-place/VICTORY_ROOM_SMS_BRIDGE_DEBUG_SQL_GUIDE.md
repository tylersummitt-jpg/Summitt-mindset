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

1. Set bounds to your soak window (e.g. 48h after Daily C1 deploy).
2. Run **Query 11** (`bridge_health_rollup`) first — one row per day summary.
3. If proof volume looks wrong → **Query 1** + **Query 2**.
4. If shrink/overlay suspected → **Query 3** + **Query 8**.
5. If Victory Room / proof language suspected → **Query 4** + **Query 5**.
6. If no-send + proof suspected → **Query 6**.
7. If identity/goal edit bridge suspected → **Query 7**.
8. If anchor privacy suspected → **Query 9** (counts only — no names).
9. If persisted proof copy looks gamified → **Query 10**.

Export CSV → share with read-only audit → behavior fix only if SQL proves harm.

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

**Expected during shrink:** overlay active + mismatch flags true. **P1** if users are confused; not necessarily a write bug.

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
| **Soak** | Query 6: intentional no-send proof; Query 4: category language with linked proof |

## Privacy

Query 9 **does not** select `important_people.display_name`. A commented optional block at the end of Query 9 may be uncommented locally for manual privacy audits only.

## Data gaps

- Victory Room UI copy ("trophy room", "no scoreboard") is **not in DB** — Query 10 notes code paths; UI audit is separate.
- Inbound jobs have no `commitment_id` column — pack resolves active `v2_commitment` by `clerk_user_id`.
- Pre-consolidation rows may lack `relationship_packet_observability` proof permission fields.
- Query 2 displayability heuristics approximate `loadVictoryRoomView` — not a full loader replay.
- Victory Room Recent Proof caps at 5 curated cards / 400 event window — proof may exist in spine but not appear on home.

## Do not

- Run INSERT/UPDATE/DELETE from this pack.
- Use results to mutate production state.
- Treat regex language hits as automatic guilt — always manual review.
