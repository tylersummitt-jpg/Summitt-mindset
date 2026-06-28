# SMS Daily Command Center — SQL Guide (v2.12)

v2.13 adds **schema-adaptive notebook fetch telemetry** for DailySmsWritingBriefV1: `daily_brief_thread_schema_fallback_used`, `schema_fallback_sources` on Q01/Q02 sent rows (distinct from `fallback_used`, which means `sms_last_outbound_context` only). Q13 sanity rows: `c1_brief_schema_fallback_used` (42703 recovered via select(*) fallback), `c1_brief_fetch_error_unrecovered` (fetch errors with zero source candidates and no schema fallback), `c1_brief_zero_source_candidates_after_schema_fallback`. Use when preferred column queries fail in production but bounded fallback still returns rows.

v2.12 adds **notebook fetch reliability telemetry** for DailySmsWritingBriefV1: `daily_brief_thread_fetch_error_count`, `fetch_error_sources`, `fetch_error_top`, `fallback_used`, `fallback_source_count` on Q01/Q02 sent rows. Q13 sanity rows: `c1_brief_thread_fetch_error` (fetch failed — notebook may be incomplete), `c1_brief_fallback_only_thread` (thread_count ≤ 1 with fallback and zero source candidates — likely `sms_last_outbound_context` only), `c1_brief_empty_thread_with_fetch_error`. Use when `source_candidate_count = 0` but Q14 shows prior visible coach rows.

v2.11 adds **Query 15 — Twilio ↔ DB Reconciliation + Duplicate Send Monitor** (`SM_AUDIT_15_Twilio_DB_Reconciliation_And_Duplicate_Send_Monitor`). Use after suspected duplicate or hidden sends (e.g. Twilio shows outbound SMS missing from normal DB tables). **Mode A:** paste Twilio `MessageSid` values into the `twilio_sids` CTE `VALUES` rows and run — any row with `missing_from_db = true` is **P0** (orphan Twilio send). **Mode B:** automatic risk monitor for duplicate clusters within 15 minutes, `metadata.twilio_message_sid` on retry-risk statuses, `twilio_db_primary_update_failed`, attempted-send without top-level `message_sid`, no-send rows with top SID, `recovered_at` rows, and daily rows missing operator-visible body. Body previews capped at 300 chars; no mutation.

v2.10 adds **DailySmsWritingBriefV1 thread build filter telemetry** on Q02/Q13/Q14 sent rows: `daily_brief_thread_source_candidate_count`, `visible_send_candidate_count`, `user_inbound_candidate_count`, `weekly_candidate_count`, `filtered_out_count`, `filtered_out_reason_top`, `effective_timestamp_rescue_count`, `source_tables_present` (counts only — no raw thread text). Q13 surfaces sanity rows: `c1_brief_empty_thread_with_candidates`, `c1_brief_filtered_all_candidates`, `c1_brief_effective_timestamp_rescue_present`, and per-reason filter diagnostics (`not_truly_sent`, `empty_body`, `timestamp_outside_window`). Use these when Q14 shows prior visible relationship rows but `daily_brief_thread_message_count` is 0 or 1.

v2.9 adds **Sunday daily suppression observability** for Slice B: when V2 weekly-eligible users would receive both daily accountability and Weekly Pat Pause on the same local Sunday, daily is intentionally skipped with `status = skipped_sunday_weekly_pause`. This is **not an error** — Weekly Pat Pause is the sole proactive Sunday touch. Q01 `skipped_sunday_weekly_pause_count` tracks suppressions; Q03 surfaces `no_send_reason` / `skip_source`; Q13 `sunday_daily_suppressed_before_weekly` warns when daily was suppressed but no visible weekly send arrived same local Sunday (check Q14 for weekly body). Q14 continues to exclude these rows (not visible user messages). Optional Q01 collision markers: `daily_visible_and_weekly_visible_same_sunday_count`, `sunday_daily_after_weekly_count`, `sunday_weekly_expected_but_daily_sent_count`.

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

Use this **15-query** pack for normal daily review. Keep the old packs for deep certification or historical forensics.

### Which query for what?

| Lens | Queries | Use when |
|------|---------|----------|
| **System health / telemetry** | Q01, Q02, Q03, Q05, Q13 | Eligible sends, no-sends, copy-risk flags, **weekly_body_missing_with_sid**, **skipped_sunday_weekly_pause**, denominator sanity, brief telemetry |
| **Human relationship review** | **Q14** | Did user/coach actually alternate in a real thread? Did daily send reflect prior user context? |
| **Twilio ↔ DB reconciliation** | **Q15** | Twilio shows sends missing from DB, duplicate coach texts within 15 minutes, or post-send DB update failures |

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
| 15 | `SM_AUDIT_15_Twilio_DB_Reconciliation_And_Duplicate_Send_Monitor` | Last **7 days** (Mode B); Mode A = paste Twilio SIDs |

---

## Query 15 — Twilio ↔ DB reconciliation (P0 ops)

After suspected duplicate or hidden sends:

1. Export Twilio Message SIDs + timestamps + body previews for the incident window.
2. Open Query 15 in `sms_daily_command_center_pack_v2.sql`.
3. Replace `PASTE_SID_HERE` rows in the `twilio_sids` CTE with real SIDs (add more `VALUES` rows as needed).
4. Run the query. **`missing_from_db = true` means P0** — Twilio delivered but no row in `sms_send_events`, `sms_inbound_coach_jobs`, `sms_weekly_send_events`, or `sms_last_outbound_context`.
5. Review Mode B rows (`duplicate_send_monitor`) for duplicate clusters, `twilio_db_primary_update_failed`, and metadata-SID retry risks without running Mode A.

---

## Daily workflow (after a 24-hour soak)

1. Wait until **Vercel is green** after any deploy you are measuring.
2. Run saved queries **01 → 15** in order (or at minimum **01**, then drill into anything flagged).
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
| (new) | **v2.9** `skipped_sunday_weekly_pause` Sunday daily suppression before weekly |
| (new) | **v2.10** Brief thread build filter telemetry (source/filter/rescue counts on Q02/Q13/Q14) |

### Brief thread filter telemetry (v2.10)

On visible C1 brief sends, check `daily_brief_thread_source_candidate_count` vs `daily_brief_thread_message_count`. If source > 0 but message_count ≤ 1, read `daily_brief_thread_filtered_out_reason_top` and `daily_brief_thread_filtered_out_count`. Q13 flags: `c1_brief_empty_thread_with_candidates`, `c1_brief_filtered_all_candidates`, `c1_brief_effective_timestamp_rescue_present`, and per-reason filter rows. No raw thread text is exposed in these columns.

### `skipped_sunday_weekly_pause` (v2.9)

Daily cron intentionally skips proactive accountability on local Sundays for V2 weekly-eligible users so **Weekly Pat Pause** is the sole proactive Sunday touch. Rows use `status = skipped_sunday_weekly_pause`, `metadata.no_send_reason = skipped_sunday_weekly_pause`, `metadata.skip_source = sunday_weekly_pause`. **Not an error.** Check **Q14** for the visible weekly Pat Pause body; check **Q13** `sunday_daily_suppressed_before_weekly` if suppression happened but weekly did not visibly send later the same Sunday.

### 7AM product floor + sentence integrity (manual SQL until pack v2.14)

Daily `sms_send_events.metadata` now includes scheduling telemetry: `computed_local_hour`, `product_floor_hour`, `product_floor_blocked_send`, `send_window_policy_source`, `explicit_preferred_local_hour`, `learned_window`, `retry_outside_window`.

Inbound/daily final bodies may include: `final_sentence_integrity_checked`, `final_sentence_integrity_ok`, `final_sentence_integrity_repair_applied`, `final_sentence_integrity_fallback_used`.

Writer/stage observability on sent inbound turns (`v2_commitment_event.payload_json` where `event_type = sms_memory_signal`): `writer_model`, `writer_finish_reason`, `writer_output_tokens`, `writer_prompt_tokens`, `writer_candidate_preview`, `post_north_star_body_preview`, `post_fvg_body_preview`, `final_body_before_integrity_preview`, `final_body_after_integrity_preview`.

**Early send before floor (last 24h):**

```sql
SELECT clerk_user_id, day_key,
       metadata->>'sent_at' AS sent_at,
       metadata->>'computed_local_hour' AS computed_local_hour,
       metadata->>'send_window_policy_source' AS policy_source,
       metadata->>'explicit_preferred_local_hour' AS explicit_hour,
       LEFT(sms_body, 80) AS body_preview
FROM sms_send_events
WHERE COALESCE(metadata->>'sent_at', created_at::text)::timestamptz > now() - interval '24 hours'
  AND message_sid IS NOT NULL
  AND (metadata->>'computed_local_hour')::int < 7
  AND COALESCE((metadata->>'explicit_preferred_local_hour')::int, 99) > 6;
```

**Sentence integrity repairs/blocks (inbound turn telemetry):**

```sql
SELECT clerk_user_id, created_at AS event_at,
       payload_json->>'final_sentence_integrity_repair_applied' AS repaired,
       payload_json->>'final_sentence_integrity_ok' AS integrity_ok,
       payload_json->>'final_sentence_integrity_reason' AS reason,
       payload_json->>'reply_body_preview' AS sent_preview
FROM v2_commitment_event
WHERE event_type = 'sms_memory_signal'
  AND source = 'sms_inbound_coach'
  AND created_at > now() - interval '24 hours'
  AND (payload_json->>'inbound_turn_telemetry')::boolean IS TRUE
  AND (
    payload_json->>'final_sentence_integrity_repair_applied' = 'true'
    OR payload_json->>'final_sentence_integrity_ok' = 'false'
  );
```

**Writer finish_reason = length (possible token truncation):**

```sql
SELECT clerk_user_id, created_at AS event_at,
       payload_json->>'writer_finish_reason' AS finish_reason,
       payload_json->>'writer_output_tokens' AS output_tokens,
       payload_json->>'writer_candidate_preview' AS writer_preview,
       payload_json->>'final_body_after_integrity_preview' AS final_preview
FROM v2_commitment_event
WHERE event_type = 'sms_memory_signal'
  AND source = 'sms_inbound_coach'
  AND created_at > now() - interval '24 hours'
  AND payload_json->>'writer_finish_reason' = 'length';
```

**Stage transition diff (writer vs final sent):**

```sql
SELECT clerk_user_id, created_at AS event_at,
       payload_json->>'writer_candidate_preview' AS writer_candidate,
       payload_json->>'post_north_star_body_preview' AS post_north_star,
       payload_json->>'post_fvg_body_preview' AS post_fvg,
       payload_json->>'final_body_before_integrity_preview' AS pre_integrity,
       payload_json->>'final_body_after_integrity_preview' AS post_integrity,
       payload_json->>'reply_body_preview' AS sent_preview
FROM v2_commitment_event
WHERE event_type = 'sms_memory_signal'
  AND source = 'sms_inbound_coach'
  AND created_at > now() - interval '24 hours'
  AND payload_json->>'writer_candidate_preview' IS NOT NULL
  AND payload_json->>'writer_candidate_preview'
      <> COALESCE(payload_json->>'final_body_after_integrity_preview', '');
```

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
