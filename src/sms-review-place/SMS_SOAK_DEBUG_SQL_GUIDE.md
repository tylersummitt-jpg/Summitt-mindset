# SMS Soak Debug SQL Guide

Read-only post-deploy soak runbook for Summitt Mindset SMS. **No production code changes** — run queries in Supabase SQL editor only.

## Files

| File | Version | Use |
|------|---------|-----|
| [`supabase/manual/sms_soak_debug_pack_v1_3.sql`](../../supabase/manual/sms_soak_debug_pack_v1_3.sql) | **v1.3 (recommended)** | Full 15-query pack + Q16 Slice 1/2 scorecard |
| [`supabase/manual/sms_soak_debug_pack.sql`](../../supabase/manual/sms_soak_debug_pack.sql) | v1.2 | Legacy 10-query consolidated pack |

## Before you run

1. Wait until **Vercel is green** after Slice 1 + Slice 2 deploy.
2. Let the system collect **24–48 hours** of post-deploy `sms_send_events` rows.
3. Open `sms_soak_debug_pack_v1_3.sql` and change the `bounds` CTE in each query:
   - **Queries 2–16:** post-deploy window (default `2026-06-17` → `2026-06-20` ET, exclusive end)
   - **Query 1:** wider thread window (default `2026-06-10` → `2026-06-20` ET)
4. Run **one query at a time** in Supabase SQL editor.
5. Export CSV for any query with rows. If no rows: note **"Query X: no rows."**

## Recommended analysis order

```text
Q16  post_deploy_slice1_slice2_scorecard   ← start here
Q2   sms_health_rollup
Q3   eligible_no_send_details
Q4   visible_sms_bodies
Q6   memory_repeat_diagnostics
Q7   stale_thread_freshness_diagnostics
Q8   zero_question_compliance
Q12  inbound_pairing_and_ghosting
Q14  user_level_no_send_scoreboard
Q15  route_side_room_legacy_fallback_audit
Then as needed: Q1, Q5, Q9, Q10, Q11, Q13
```

## Query list (v1.3)

| # | Export name | Purpose |
|---|-------------|---------|
| 1 | `Q1_weekly_thread_timeline_all_users.csv` | Full user threads (daily, weekly, inbound) |
| 2 | `Q2_sms_health_rollup.csv` | Health rollup with **eligible denominator** |
| 3 | `Q3_eligible_no_send_details.csv` | Eligible no-sends with candidate/repair bodies |
| 4 | `Q4_visible_sms_bodies.csv` | Visible daily/weekly/inbound bodies |
| 5 | `Q5_daily_c1_intent_and_no_send_rollup.csv` | C1 intent × send/no-send |
| 6 | `Q6_memory_repeat_diagnostics.csv` | Memory anti-repeat + **Slice 2 skip** |
| 7 | `Q7_stale_thread_freshness_diagnostics.csv` | Stale ask + thread freshness |
| 8 | `Q8_zero_question_compliance.csv` | Zero-question visible violations |
| 9 | `Q9_hidden_question_cousin_scan.csv` | Hidden question commands (all visible) |
| 10 | `Q10_robot_language_scan.csv` | Recommit/menu/robot language |
| 11 | `Q11_weekly_sms_audit.csv` | Weekly miss-count / recommit audit |
| 12 | `Q12_inbound_pairing_and_ghosting.csv` | Inbound → reply ghosting |
| 13 | `Q13_final_guard_product_law_blocks.csv` | Final guard / product-law blocks |
| 14 | `Q14_user_level_no_send_scoreboard.csv` | Per-user no-send scoreboard |
| 15 | `Q15_route_side_room_legacy_fallback_audit.csv` | Side-room / legacy / fallback |
| 16 | `Q16_post_deploy_slice1_slice2_scorecard.csv` | **Compact post-deploy dashboard** |

## What “eligible coaching no-send” means

A row is **eligible** when it is **not** a legitimate skip:

- not fully on V2
- no active commitment
- STOP / unsubscribed
- compliance / safety / crisis
- duplicate, tapback, invalid phone
- outside send window
- intentionally suppressed active inbound thread

**Eligible no-send** = eligible row that is **not** `visible_sent`.

Stale/memory/thread/final-guard no-sends **count** — those are the fixable product-system failures we measure.

**Excluded** from eligible denominator (not counted as coaching failure).

## Visible send classification (daily)

A row is **visible_sent** when:

- `body_preview` is non-empty (expanded coalesce including `daily_v3_lane`, `v3_brain`, `accepted` paths), **and**
- `status` matches `sent|delivered|queued|success|accepted|sending` **or** `message_sid` is set **or** `metadata.note = 'sent_to_twilio'`, **and**
- no blocking `no_send_reason` / `skip_source`

`status='accepted'` with body counts as visible unless a clear no-send reason says otherwise.

## Success / failure thresholds

| Metric | Target | Meaning |
|--------|--------|---------|
| Eligible no-send rate | **~1%** | Target zone |
| Eligible no-send rate | **<5%** | Acceptable intermediate |
| Eligible no-send rate | **<15%** | Improving but not done |
| Eligible no-send rate | **≥15%** | Still high — keep measuring |
| Memory/thread share of eligible no-sends | **>10–15%** | Thread freshness hardening |
| `thread_freshness_stale_blocked` top reason | dominant | Thread freshness slice |
| Zero-question visible violations (Q8) | **>0** | Zero-question validator or card alignment |
| `memory_repeat_repair_skipped_zero_question_mode` | present + total no-send falling | Slice 2 working |
| `memory_repeat_repair_skipped` + no-send still high | — | Writer/card/thread still needs work |

### Baseline (pre-patch)

June 16–17 soak showed roughly **52%** and **73%** eligible no-send. Compare post-deploy using the **same eligible definition** and window length.

## Decision tree → next code slice

| SQL signal | Next slice |
|------------|------------|
| Q16 `next_recommended_slice` = `thread_freshness_zero_question_hardening` | Thread freshness zero-question hardening |
| Q8 violations > 0 | Zero-question validator or Strategy Card alignment |
| High `stale_ask_blocks`, low memory/thread repair | Strategy Card JSON / demoted-rule cleanup |
| Large `pending_resolution_blocks` | Pending_resolution verbatim slice |
| Q12 meaningful inbound no-replies / contradiction | Inbound contradiction / ghosting |
| Eligible no-send <5%, Slice 2 skip telemetry present | **Keep soaking** before next code |
| SQL cannot see accepted sends or skip telemetry | SQL observability patch only |

## Slice 1 telemetry (prompt / card)

Measured via COALESCE across `relationship_packet_observability`, `daily_v3_lane`, `v3_brain`:

- `daily_zero_question_mode_active`
- `strategy_card_zero_question_required`
- `strategy_card_high_repeat_risk`
- `strategy_card_daily_conversation_intent`

**Q5, Q8, Q16** are primary Slice 1 reads.

## Slice 2 telemetry (memory repair skip)

Measured via:

- `memory_repeat_repair_skipped_zero_question_mode`
- `memory_repeat_repair_skipped_reason` (`repair_disabled_zero_question_mode`)
- `memory_repeat_no_send_reason` (`repair_disabled_zero_question_mode`)
- `repeat_repair_attempted` (lane only, expect `false`)

**Q6, Q3, Q16** are primary Slice 2 reads.

## Body coalesce paths (v1.3)

**Visible daily body:** top-level `sms_body` / `body` / `final_body` / `body_preview`, then `metadata.*`, `voice_send_decision`, `final_voice_gate`, `daily_v3_lane`, `v3_brain`.

**Candidate:** `daily_v3_lane.v3_candidate_body`, `v3_brain.v3_candidate_body`.

**Memory repaired:** `daily_v3_lane.memory_repeat_repaired_body_preview`, `v3_brain`, observability.

**Thread freshness repaired:** `daily_v3_lane.thread_freshness_repaired_body_preview`, `v3_brain`.

All queries include `raw_json` for manual inspection.

## Still available (specialized)

- `supabase/manual/sms_relationship_packet_observability.sql`
- `supabase/manual/memory_repeat_strategy_mismatch_audit.sql`
- `supabase/manual/lane_post_validate_repair_audit.sql`
- `supabase/manual/truth_spine_certification_pack.sql` (truth spine, not daily soak)

## Data gaps / limitations

- Pre-consolidation rows may lack nested `relationship_packet_observability`; COALESCE falls back to `daily_v3_lane`.
- `repeat_repair_attempted` and `v3_candidate_body` are **lane-only** (not whitelisted to observability).
- Regex scans (Q8–Q10) are heuristics, not ground truth.
- `sms_inbound_coach_jobs` has no `metadata` column; inbound pairing uses job columns + LATERAL nearest job.
- Q16 `next_recommended_slice` is advisory — confirm with Q2–Q8 before coding.

## Workflow

Export CSVs → share with review → read-only root-cause audit → **one hallway fix** only if SQL warrants it. Do not weaken guards or force-send to improve rates.
