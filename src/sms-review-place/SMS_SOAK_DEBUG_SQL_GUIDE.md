# SMS Soak Debug SQL Guide

Read-only daily runbook for Phase 4 soak/tuning. **No production code changes** — run queries in Supabase SQL editor only.

## File

[`supabase/manual/sms_soak_debug_pack.sql`](../../supabase/manual/sms_soak_debug_pack.sql)

## Daily workflow

1. Open the SQL pack and set `day_start` / `day_end` in each query's `bounds` CTE (America/New_York).
2. Run **Query 1** first — lane/route/no-send rollup.
3. If something looks off, run **Queries 2–6** for timeline, bodies, no-sends, inbound pairing, and per-user scoreboard.
4. Use **Queries 7–10** only when a specific guard/repair/outcome/packet issue appears.

Export CSV from Supabase → share with ChatGPT review → Cursor read-only root-cause audit → tiny hallway fix only if warranted.

## Core queries (6)

| # | Name | Purpose |
|---|------|---------|
| 1 | `sms_day_health_rollup` | One row per lane × route × strategy card × no-send reason |
| 2 | `sms_day_unified_timeline` | Chronological all-user timeline |
| 3 | `sms_day_visible_bodies` | User-visible SMS copy with FVG/guard/Twilio context |
| 4 | `sms_day_no_send_details` | Skips/blocks with repair and stale/memory metadata |
| 5 | `sms_day_inbound_pairing` | Inbound text → job → reply/no-send |
| 6 | `sms_day_user_scoreboard` | One row per user with counts and last-known state |

## Optional deep-dives (4)

| # | Name | When to run |
|---|------|-------------|
| 7 | `state_sensitive_routes` | Contract, pending, refresh, guided-shrink routes |
| 8 | `repair_helper_diagnostics` | Stale-ask, memory-repeat, thread-freshness, post-validate, FVG |
| 9 | `suspected_false_outcome_events` | Heuristic bad user_yes/no/partial vs inbound text |
| 10 | `packet_strategy_context_health` | Packet truncation, thread inclusion, proof permissions |

## JSON paths (canonical)

Strategy card fields — COALESCE across:

- `metadata.relationship_packet_observability.strategy_card_*`
- `metadata.strategy_card_*` (top-level)
- `metadata.daily_v3_lane.*` / `weekly_lane_metadata.*` / `inbound_v3_lane.*`
- `metadata.extras.*` when present

No-send / guard:

- `metadata.daily_v3_lane.no_send_reason`
- `metadata.final_voice_gate.*`
- `metadata.voice_send_decision.*`
- `metadata.unified_final_product_law_guard.*`

Visible send semantics (daily):

- `visible_sent` / `twilio_send_attempted` in `voice_send_decision` or top-level metadata
- Also infer from `status IN ('sent','delivered','queued','accepted','sending')`, `message_sid`, or `note = 'sent_to_twilio'`

## Replaces old process

Previously ~15 separate exports from `sms_relationship_packet_observability.sql` plus ad-hoc slices (FVG, no-send, stale-ask, memory-repeat, dashboard rollup, legacy fallback, shadow disagreements, etc.).

This pack consolidates into **6 standard daily queries + 4 optional deep-dives**, with consistent `bounds` CTEs and COALESCE paths.

Still available for specialized audits (not duplicated here):

- `supabase/manual/sms_relationship_packet_observability.sql` — packet/repair/FVG detail sections
- `supabase/manual/lane_post_validate_repair_audit.sql`
- `supabase/manual/memory_repeat_strategy_mismatch_audit.sql`
- `supabase/manual/meaning_interpreter_shadow_reports.sql`

## Data gaps

- **Shadow disagreements** — use `meaning_interpreter_shadow_reports.sql` (Query G in old pack).
- **Legacy fallback volume** — partial coverage in Query 1 route filters; full legacy slice still in old observability file section F.
- **Onboarding / transactional SMS** — not in this pack (different tables/paths).
- **Pre-consolidation rows** — older rows may lack nested `relationship_packet_observability`; COALESCE falls back to lane blobs but some fields may be null.
- **Query 9 suspects** — regex heuristics only; not ground truth.

## Safety

- SELECT-only. No migrations, views, or schema changes.
- All-users; no Brooke or user-specific filters.
- No Twilio/send/persistence/runtime changes.
