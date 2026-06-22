# SMS Daily Command Center — SQL Guide (v2.8)

v2.8 adds **weekly SMS body observability**: SQL fallbacks for `metadata.north_star_gate.final_body` and related weekly paths so Q02/Q11/Q14 show Pat Pause bodies users actually received; Q01 `weekly_body_missing_with_sid_count` and Q13 `weekly_body_missing_with_sid` flag rows with SID but no extractable body. Forward weekly sends also log `metadata.sms_body` (Twilio-visible body with compliance footer).

v2.7 adds **Query 14 — Relationship Thread Review**: a chronological user/coach thread lens (`user said → coach said → …`) for manual relationship-quality review. It unions inbound messages, inbound job user text, coach inbound replies, daily outbound, and weekly outbound with writer-aligned visible-row rules. Use Q14 when judging whether Coach understood the actual relationship thread — not for system health scorecards.

v2.6 adds **thread coverage + freshness extraction** sanity for DailySmsWritingBriefV1: empty brief thread with prior visible sends, thread over cap (>25), oldest/newest reversed telemetry, visible repeated CTA risk patterns, and freshness preview missed visible CTA — on `metadata.relationship_packet_observability` for sent rows.

v2.5 adds **timing + durable memory** observability for DailySmsWritingBriefV1: `daily_local_daypart`, timing guidance counts/flags, timing anchor confidence, and durable memory item/people/blocker counts (no names) — on `metadata.relationship_packet_observability` for sent rows.

v2.4 hardens **DailySmsWritingBriefV1** observability: `daily_writing_brief_build_status` / `daily_writing_brief_skip_reason` (why brief vs legacy), compact `daily_suggested_move` summary, thread window floor/extension counts and oldest/newest timestamps, pipe-separated `daily_freshness_avoid_phrases_preview`, and compact open-loop flags — all on `metadata.relationship_packet_observability` for sent rows.

v2.3 adds **DailySmsWritingBriefV1** sent-row telemetry: `writer_prompt_path`, `daily_writing_brief_used`, proof calibration, freshness/thread counts, unsupported praise / repeated CTA seatbelt fields — readable from `metadata.relationship_packet_observability` on successful sends (not only `daily_v3_lane` no-sends).

Read-only daily observability for Summitt Mindset SMS. **No production code changes** — run queries in Supabase SQL Editor only.

**Pack file:** [`supabase/manual/sms_daily_command_center_pack_v2.sql`](../../supabase/manual/sms_daily_command_center_pack_v2.sql)

This replaces the old **29-query** daily process:
- SMS Soak Debug Pack v1.3 (16 queries)
- Truth Spine Certification Pack v1.1 (13 queries)

Use this **14-query** pack for normal daily review. Keep the old packs for deep certification or historical forensics.

### Which query for what?

| Lens | Queries | Use when |
|------|---------|----------|
| **System health / telemetry** | Q01, Q02, Q03, Q05, Q13 | Eligible sends, no-sends, copy-risk flags, **weekly_body_missing_with_sid**, denominator sanity, brief telemetry |
| **Human relationship review** | **Q14** | Did user/coach actually alternate in a real thread? Did daily send reflect prior user context? |

**Q14 is read-only manual review.** Do not use it to mutate data, change routes, or drive automated product behavior.

---

## One-time setup (Supabase)

1. Open **Supabase → SQL Editor**.
2. Open `sms_daily_command_center_pack_v2.sql` in this repo.
3. For each query block (from `-- QUERY 01` through its final `;`), create a **private saved query** with the name below.
4. You only do this once.

| # | Save as | Default window |
|---|---------|----------------|
| 01 | `SM_AUDIT_01_Command_Center` | Last 24 hours |
| 02 | `SM_AUDIT_02_Thread_Timeline` | Last **9 days** |
| 03 | `SM_AUDIT_03_Eligible_No_Send` | Last 24 hours |
| 04 | `SM_AUDIT_04_Memory_Thread_Freshness` | Last 24 hours |
| 05 | `SM_AUDIT_05_Language_Scan` | Last 24 hours |
| 06 | `SM_AUDIT_06_Inbound_Pairing` | Last 24 hours |
| 07 | `SM_AUDIT_07_Truth_Spine_Cert` | Last 24 hours |
| 08 | `SM_AUDIT_08_NoSend_Truth_Loss` | Last 24 hours |
| 09 | `SM_AUDIT_09_Plans_Blockers_Goals` | Last 24 hours |
| 10 | `SM_AUDIT_10_Victory_Room` | Last 24 hours |
| 11 | `SM_AUDIT_11_Weekly_Pending` | Last 24 hours |
| 12 | `SM_AUDIT_12_Final_Guard_SideRoom` | Last 24 hours |
| 13 | `SM_AUDIT_13_Denominator_Sanity` | Last 24 hours |
| 14 | `SM_AUDIT_14_Relationship_Thread_Review` | Last **9 days** |

---

## Daily workflow (after a 24-hour soak)

1. Wait until **Vercel is green** after any deploy you are measuring.
2. Run saved queries **01 → 14** in order (or at minimum **01**, then drill into anything flagged).
3. For each query:
   - If it returns rows → export CSV or copy results.
   - If it returns **no rows** → write `Query N: no rows.` in your notes.
4. Paste/upload results to ChatGPT for interpretation.
5. **Do not** run the old 29-query process unless you specifically need deep certification.

### Manual date override

Each query has a `bounds` CTE at the top. Default:

```sql
now() - interval '24 hours' AS window_start,
now() AS window_end
```

Query **02** and **14** use `9 days` instead of `24 hours`.

To audit a fixed deploy window, replace with:

```sql
timestamptz '2026-06-17 00:00:00 America/New_York' AS window_start,
timestamptz '2026-06-18 00:00:00 America/New_York' AS window_end
```

---

## What each query tells you

| Query | What it answers | Points to code area |
|-------|-----------------|---------------------|
| **01 Command Center** | Eligible sends vs no-sends, rate, zero-question violations, memory/thread blocks, coach-body duplicate blocks, truth mismatches, VR failures, robot/time-of-day risks, `next_recommended_slice` | Daily lane, Strategy Card, eligible denominator |
| **02 Thread Timeline** | Full user threads with ET daypart + copy-risk flags; `near_duplicate_to_previous_coach_sms` review flag; inbound resolved-truth metadata on replies | Daily/weekly/inbound writers, time-of-day copy |
| **14 Relationship Thread Review** | **Human-readable** user/coach alternating thread (visible rows only); brief/durable telemetry on daily coach rows; optional user memory-signal flags | Manual relationship-quality review; compare to what C1 brief writer should have seen |
| **03 Eligible No-Send** | Every eligible no-send + coach-body duplicate telemetry + per-user repeat count, candidate/repair bodies | Lane no-send, memory repeat, FVG |
| **04 Memory / Thread** | Memory repeat skip (Slice 2), coach-body near-duplicate blocks, thread freshness repairs, question-shape on bodies | `daily_v3_lane` memory + thread freshness |
| **05 Language Scan** | Zero-question violations, hidden questions, robot/recommit language (daily + weekly + inbound) | Strategy Card, Final Voice Gate, product-law guards |
| **06 Inbound Pairing** | Ghosting, contradiction, completion→planning mismatch, resolved-truth continuity | `sms-inbound-coach` route, inbound lane |
| **07 Truth Spine Cert** | Expected vs persisted outcomes, `cert_diagnostic`, goal-change/amend-goals detection, known fixtures | `v2-inbound-accountability-outcome-persist`, meaning |
| **08 No-Send Truth Loss** | Truth persisted despite no-send vs possible loss; pre-writer / on-no-send persist telemetry | No-send truth persistence (Case C) |
| **09 Plans / Blockers / Goals** | Plans must not become proof; blockers captured; amend/re-state/reset goal-change not fake miss | Meaning backstops, blocker/contract paths |
| **10 Victory Room** | Spine proof → VR display eligibility; negative controls | Victory Room projection from spine |
| **11 Weekly + Pending** | Weekly miss-count language, recommit/menu, pending verbatim, stuck state | Weekly writer, pending resolution |
| **12 Final Guard / Side Room** | Product-law blocks vs telemetry-only noise vs raw_json false positives | Unified final guard, legacy/side paths |
| **13 Denominator Sanity** | Per-issue `impacted_query` + `severity` when telemetry could make other queries lie | Observability gaps only (SQL/payload) |

---

## v2.1 reliability fixes (June 19 soak)

| Area | What changed |
|------|----------------|
| **Eligibility (01, 03, 12, 13)** | Legitimate `skipped_*` statuses excluded before no_send_reason/skip_source checks — stale/memory/thread/final-guard failures still eligible |
| **Inbound extraction (06, 08, 12)** | `actual_job_no_send_reason` + truth metadata parsed from metadata, `last_error` JSON, and regex fallback on truncated JSON |
| **Inbound pairing (06)** | Priority: `exact_message_sid` → `exact_raw_body` → `nearest_future_same_user` (60m); `pairing_quality` column |
| **No-send truth loss (08)** | Cancelled jobs treated as no-send; `no_send_truth_diagnostic` uses extracted reason (not `reply_not_no_send`) |
| **Pending / guard (11, 12)** | `turn_understanding_stale_ask_blocked` → `inbound_stale_ask_no_send` via `actual_no_send_reason` |
| **Denominator sanity (13)** | Issue rows name which primary query becomes unreliable (`impacted_query`) with `blocker` / `warning` / `info` |

---

## Recommended run order

```text
01  Command Center          ← start here
14  Relationship Thread     ← film room for user/coach alternation (9-day window)
02  Thread Timeline         ← copy-risk / telemetry on same window
03  Eligible No-Send        ← if 01 shows no-send pressure
06  Inbound Pairing         ← if inbound/truth flags in 01
07  Truth Spine Cert        ← if truth mismatch count > 0
08  No-Send Truth Loss      ← if 07/01 show truth risk
04  Memory / Thread         ← if memory/thread blocks in 01
05  Language Scan           ← if zero-question or robot count > 0
10  Victory Room            ← if VR failure count > 0
09  Plans / Blockers / Goals
11  Weekly + Pending
12  Final Guard / Side Room
13  Denominator Sanity      ← if metrics look impossible
```

### Query 14 tips

- Filter by `clerk_user_id` in Supabase when reviewing one user (pack has no hard-coded IDs).
- Read `thread_seq` in order — expect `user` / `coach` alternation when the relationship is active.
- On `coach_daily_outbound` rows, check `daily_brief_thread_message_count` and `daily_freshness_avoid_phrases_preview` against the prior thread.
- `user_stated_*_signal` columns are review hints only (regex), not product gates.

---

## Success thresholds (same as soak pack)

| Metric | Target |
|--------|--------|
| `eligible_no_send_rate_pct` | **~1%** target; **<5%** acceptable; **≥15%** still high |
| Zero-question visible violations (01, 05) | **0** |
| `no_send_truth_loss_count` (01, 08) post-fix | **0** |
| `inbound_truth_mismatch_count` (01, 07) post-fix | **0** |
| Query 13 `impacted_query` rows | Investigate named query reliability (`blocker` first) |

---

## Old → new query mapping

| Old queries | New query |
|-------------|-----------|
| SMS Q16, Q2, Q5 | **01** Command Center |
| SMS Q1 | **02** Thread Timeline |
| SMS Q3, Q14 | **03** Eligible No-Send |
| SMS Q6, Q7 | **04** Memory / Thread |
| SMS Q8, Q9, Q10 | **05** Language Scan |
| SMS Q12 | **06** Inbound Pairing |
| SMS Q11 | **11** Weekly + Pending |
| SMS Q13, Q15 | **12** Final Guard / Side Room |
| Truth Q12, Q13, Q1, Q2, Q3, Q4, Q5 | **07** Truth Spine Cert |
| Truth Q11 | **08** No-Send Truth Loss |
| Truth Q6, Q7, Q8 | **09** Plans / Blockers / Goals |
| Truth Q9 | **10** Victory Room |
| Truth Q10 | folded into **06** and **08** |
| (new) | **13** Denominator Sanity |
| (new) | **14** Relationship Thread Review |
| (new) | **v2.8** Weekly body paths (`north_star_gate.final_body`, `metadata.sms_body`) |

---

## Legacy packs (still available)

| File | When to use |
|------|-------------|
| [`sms_soak_debug_pack_v1_3.sql`](../../supabase/manual/sms_soak_debug_pack_v1_3.sql) | Deep SMS soak, per-query CSV exports |
| [`truth_spine_certification_pack.sql`](../../supabase/manual/truth_spine_certification_pack.sql) | Full truth certification, known fixtures, Q13 drilldown |

---

## Notes

- All queries use `to_jsonb()` for column-safe reads — no schema migrations required.
- No `clerk_user_id` filters — all users in window.
- Pre-fix rows are labeled via `fix_era` where applicable; do not treat pre-cutover rows as current bugs without checking era.
