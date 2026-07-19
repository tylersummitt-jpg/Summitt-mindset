# APP-041C1 — Account deletion purge / anonymization matrix

**Status:** IMPLEMENTED — PENDING REVIEW (documentation only)
**Canonical for:** APP-041C data-deletion specification
**Repository HEAD at freeze:** `61f615a0837535a06e2b392c8126226f94163616`
**Date:** 2026-07-19

This document freezes product policy and dependency order for Summitt Mindset account-deletion app-data purge. It does **not** implement SQL, migrations, RPCs, Clerk/Stripe/Twilio actions, or public deletion UI.

**Do not claim:** purge is implemented; real data was deleted; privacy policy was updated; legal review occurred; public deletion works; store compliance is complete.

---

## 1. Fixed product decisions (authoritative for V1)

Unless later legal counsel requires a change:

### 1.1 STOP / opt-out evidence

Retain **only** minimum evidence that an opt-out occurred (V1 C2 correction):

| Retain | Do not retain |
|---|---|
| Twilio `message_sid` | Raw E.164 phone number |
| `received_at` timestamp | Full inbound message body |
| Normalized command token (e.g. `STOP`) | Phone hash / HMAC |
| | Clerk user ID, name, email, coaching content |

- **Storage:** dedicated `sms_opt_out_tombstones` table (not in-place inbound anonymization).
- **Retention period:** indefinite for V1 until legal counsel provides a schedule.
- Account deletion ≠ TCPA/STOP suppression.
- **Do not fabricate** STOP evidence during deletion (B2a unlink ≠ STOP).
- **No phone hash in V1** (enumerable / practically reversible without a pepper architecture).

### 1.2 SMS data

**Delete:** `sms_identities`, `sms_audience`, `sms_inbound_coach_jobs`, non-STOP `sms_inbound_messages`, `sms_last_outbound_context`, `sms_delivery_state`, `sms_send_events`, `sms_weekly_send_events`, SMS drafts/generations, other user-linked SMS conversational/coaching data.

**Retain:** only transformed minimum STOP evidence (above).

### 1.3 User coaching and profile data

**Delete** all user-linked coaching/identity data (journals, summaries, Ask Pat/chat, Coach Pat notes, profiles, identity versions, important people, goals/coherence, V2 commitments and children, events, coaching/SMS thread memory, overlays/contracts/refresh, seasons/snapshots, prompts/reflections, achievements, usage, send-time prefs, user-tied rollout, feedback/retention/winback, and similar).

**Do not delete** shared/product catalog data.

### 1.4 Testimonials

**V1 C2:** DELETE all testimonial rows for the deleting user (approved and unapproved).

Do not anonymize or retain quotes. Consent is not durably stored per row; approval ≠ publication consent.

### 1.5 Admin customer relationship notes

**V1 C2:** DELETE the entire row (including clerk PK and structured flags).

Do not retain clerk-keyed identity linkage in the coaching DB after purge.

### 1.6 Shipping and fulfillment

**Delete from application tables:** recipient name, shipping address, email, phone, delivery instructions, fulfillment reminder email snapshots (delete rows).

Completed financial/fulfillment evidence remains only in proper **external** systems—not as coaching-DB PII.

### 1.7 Stripe (V1)

- Cancel Summitt subscriptions via APP-041B3a.
- **Do not** delete Stripe customer, invoices, payments, payment methods, or issue automatic refunds.
- Clear local/Clerk Stripe entitlement metadata before Clerk deletion.
- Leave `stripe_webhook_events` untouched.
- Stripe metadata cleanup may be a later external step—not part of first Supabase purge RPC.

### 1.8 Clerk

- Clerk deletion remains **last** (after `app_data_purged`).
- Before delete: clear public metadata (phone/SMS/subscription/customer refs); confirm Stripe cancel + app purge.
- Retain **raw** `clerk_user_id` on `account_deletion_requests` for V1 (late webhook/SMS guards, idempotent recovery, admin diagnosis, Clerk 404-as-already-done).
- Do **not** hash/remove Clerk ID before the full workflow completes.

### 1.9 Account deletion tombstone

Retain `account_deletion_requests` as operational evidence: request ID, Clerk user ID, status/step, generalized result fields, timestamps, attempt/retry metadata, non-PII category counts.

Sanitize/remove: raw error payloads, message bodies, phones, emails, quotes, free-text user content, secrets, external raw objects.

### 1.10 Challenge participants

**V1 C2:** additive nullable `challenge_participants.clerk_user_id` (no email backfill).

- **Purge:** `DELETE FROM challenge_participants WHERE clerk_user_id = <bound clerk>` only.
- **Do not** delete by email, fuzzy-match, or trusted-email parameter.
- **Legacy email-only rows** (`clerk_user_id IS NULL`) are anonymous/historical marketing records with **no provable Clerk ownership**. They are **out of band** for account-bound purge and **do not** force `incomplete` or block `app_data_purged`.
- Public challenge signup remains anonymous → leaves `clerk_user_id` NULL (do not guess).
- Informational count only: `challenge_rows_deleted` (non-PII).

### 1.11 Shared / product data — never touch

`film_videos`, `practice_prompts`, Pat quote/catalog tables, respond-day question catalogs, shared rollout/catalog config, aggregate day-level stats not user-keyed, `stripe_webhook_events`, another user’s rows, shared product/business content.

### 1.12 External systems

Not part of the Supabase purge transaction: Stripe financial history, Twilio provider logs, Clerk identity record, Resend logs, OpenAI provider logs, Vercel platform logs.

Public privacy copy must disclose lawful/operational retention accurately (see §6).

---

## 2. Decision vocabulary

| Code | Meaning |
|---|---|
| DELETE | Remove row(s) for this user |
| ANONYMIZE | Transform in place; remove identity; may keep non-identifying content |
| RETAIN LEGAL/COMPLIANCE | Keep minimum compliance evidence |
| RETAIN DELETION EVIDENCE | Keep operational tombstone |
| EXTERNAL | Outside Supabase purge transaction |
| SHARED/DO NOT TOUCH | Product/shared/other-user; never modify in purge |

---

## 3. Canonical purge matrix

| System/table | User key | Data category | Decision | Exact fields retained | Exact fields removed | Dependency/order | Reason | Implementation slice | Risk/notes |
|---|---|---|---|---|---|---|---|---|---|
| `account_deletion_requests` | `clerk_user_id` | orchestration | RETAIN DELETION EVIDENCE | id, clerk_user_id (raw), status, current_step, result fields, timestamps, attempt metadata, non-PII counts | raw error payloads, bodies, phones, emails, quotes, secrets | After purge RPC; sanitize under CAS | Tombstone + late guards | C2/C3 | Do not hash clerk id in V1 |
| `sms_identities` | phone PK + clerk | SMS binding | DELETE | — | all row data | Order step 2 | Live binding | C2 | Idempotent w/ B2a |
| `sms_audience` | clerk PK + phone | SMS audience | DELETE | — | all | Step 2 | Live audience | C2 | Idempotent w/ B2a |
| `sms_inbound_coach_jobs` | clerk + phone | SMS jobs | DELETE | — | all | Step 3 | Bodies/phones | C2 | Nonterminal already cancelled B2a |
| `sms_last_outbound_context` | clerk | SMS coaching | DELETE | — | all | Step 4 | Last body PII | C2 | — |
| `sms_delivery_state` | clerk | SMS engine | DELETE | — | all | Step 4 | Per-user state | C2 | — |
| `sms_send_events` | clerk | SMS ledger | DELETE | — | all | Step 5 | Ops ledger | C2 | — |
| `sms_weekly_send_events` | clerk | SMS ledger | DELETE | — | all | Step 5 | Weekly ledger | C2 | — |
| `sms_daily_drafts` | clerk | SMS drafts | DELETE | — | all | Step 6 (before gens if FK) | Draft bodies | C2 | FK-safe order |
| `sms_daily_draft_generations` | clerk | SMS drafts + OpenAI JSON | DELETE | — | all incl. `writer_openai_messages` | Step 6 | Prompt capture | C2 | — |
| `sms_inbound_messages` (STOP) | clerk/phone | STOP evidence | **COPY → tombstone then DELETE** | — (row deleted) | all inbound columns | Step 7 | Prefer dedicated tombstone | C2 | No in-place phone blanking |
| `sms_opt_out_tombstones` | message_sid PK | STOP evidence | RETAIN LEGAL/COMPLIANCE | message_sid, received_at, opt_out_command_token | phone, clerk, body, hash | Step 7 insert | Minimum opt-out proof | C2 | No phone hash in V1 |
| `sms_inbound_messages` (all target-user) | clerk | SMS inbound | DELETE | — | all | Step 7 after tombstone insert | Conversational + STOP source rows | C2 | After STOP copy |
| `sms_audience_pref_backup` | likely clerk | backup | DELETE if present | — | all | With SMS mid | Stale backup PII | C2 | Confirm live; delete-if-present |
| `sms_daily_stats` | day_key | aggregate | SHARED/DO NOT TOUCH | all | — | Never | Not user-keyed | — | — |
| `journal_entries` | clerk | user content | DELETE | — | all | Step 8 | Promised deletable | C2 | — |
| `daily_summaries` | clerk | memory | DELETE | — | all | Step 8 | PII | C2 | — |
| `weekly_summaries` | clerk | memory | DELETE | — | all | Step 8 | PII | C2 | — |
| `recent_summary` | clerk | memory | DELETE | — | all | Step 8 | PII | C2 | — |
| `pattern_insights` | clerk | derived | DELETE | — | all | Step 8 | Behavioral | C2 | — |
| `ask_pat_questions` | clerk | chat | DELETE | — | all | Step 8 | Free text | C2 | — |
| `ask_pat_usage` | clerk | rate limit | DELETE | — | all | Step 8 | Per-user | C2 | — |
| `coach_conversations` | clerk | chat | DELETE | — | all | Step 8 | Transcript | C2 | — |
| `coach_pat_daily_notes` | clerk | notes | DELETE | — | all | Step 8 | PII | C2 | — |
| `coach_pat_daily_usage` | likely clerk | rate limit | DELETE if present | — | all | Step 8 | Confirm schema | C2 | Orphan twin |
| `coach_reply_usage` | clerk | rate limit | DELETE | — | all | Step 8 | Per-user | C2 | — |
| `daily_prompt_versions` | clerk | prompts | DELETE | — | all | Step 8 | Mild PII | C2 | — |
| `daily_prompts` | clerk | prompts | DELETE | — | all | Step 8 | Archived | C2 | — |
| `weekly_sms_reflections` | clerk | reflections | DELETE | — | all | Step 8 | SMS body | C2 | — |
| `daily_completion_events` | clerk | ops | DELETE | — | all | Step 8 | Completion lock | C2 | — |
| `feedback_events` | clerk | feedback | DELETE | — | all | Step 8 | Free text | C2 | — |
| `winback_queue` | clerk | retention ops | DELETE | — | all | Step 8 | Queue | C2 | — |
| `retention_signals` | clerk | analytics | DELETE | — | all | Step 8 | Per-user | C2 | — |
| `achievements_unlocked` | clerk | gamification | DELETE | — | all | Step 8 | Per-user | C2 | — |
| `v2_sms_meaning_interpretation_shadow` | clerk | telemetry | DELETE | — | all | Step 9 | Soft FK | C2 | — |
| `v2_sms_pattern_correction` | clerk nullable | telemetry | DELETE user-scoped | — | user rows | Step 9 | Soft FK | C2 | Do not delete global-scope rows |
| `v2_user_sms_comms_preferences` | clerk | prefs | DELETE | — | all | Step 9 | Timing prefs | C2 | STOP remains inbound evidence |
| `v2_user_send_time_profile` | clerk | prefs | DELETE | — | all | Step 9 | Learned prefs | C2 | — |
| `v2_user_rollout` | clerk | rollout | DELETE | — | all | Step 9 | Enrollment | C2 | — |
| `v2_event` | clerk nullable | early V2 | DELETE user rows | — | user-keyed | Step 9 | Legacy | C2 | — |
| `v2_check_sent_outbound_intent_snapshot` | clerk | V2 | DELETE | — | all | Step 10–11 (CASCADE ok) | → commitment CASCADE | C2 | Prefer via commitment delete |
| `v2_refresh_outbound_intent_snapshot` | clerk | V2 | DELETE | — | all | Step 10–11 | CASCADE | C2 | — |
| `v2_commitment_sms_thread_memory` | clerk | SMS memory | DELETE | — | all | Step 10–11 | CASCADE; high volume | C2 | Batch if needed at C2 review |
| `v2_commitment_coaching_memory` | clerk | coaching | DELETE | — | all | Step 10–11 | CASCADE | C2 | — |
| `v2_commitment_event` | clerk | events | DELETE | — | all | Step 10–11 | CASCADE; high volume | C2 | Batch if needed |
| `v2_commitment_evolution_recommendation` | clerk | V2 | DELETE | — | all | Step 10–11 | CASCADE | C2 | — |
| `v2_commitment_intake` | clerk | onboarding | DELETE | — | all | Step 10–11 | CASCADE / SET NULL identity | C2 | — |
| `v2_victory_*_snapshot` tables | clerk | Victory Room | DELETE | — | all | Step 10–11 | CASCADE | C2 | — |
| `goal_coherence_log` | clerk | onboarding | DELETE | — | all | Step 10 **before** identity versions | RESTRICT → identity | C2 | Order-critical |
| `user_accountability_season` | clerk | seasons | DELETE | — | all | Step 10 **before** identity versions | RESTRICT → identity | C2 | Order-critical |
| `v2_commitment` | clerk | core commitment + adaptive overlay/contract columns | DELETE | — | all (incl. overlay/contract/proposal fields) | Step 11 | Parent CASCADE | C2 | Overlay/contract are columns on this table, not separate tables; after RESTRICT kids cleared |
| `important_people` | clerk | third-party PII | DELETE | — | all | Step 12 | Names | C2 | — |
| Remaining V2 orphans | clerk | V2 | DELETE | — | all | Step 12 | Safety net | C2 | — |
| `user_profiles` | clerk | profile | DELETE | — | all | Step 13 | Primary PII | C2 | — |
| `user_identity_version` | clerk | identity history | DELETE | — | all | Step 14 | After RESTRICT cleared | C2 | Order-critical |
| `testimonials` (all for user) | clerk | marketing | DELETE | — | all incl. quote | Step 15 | Consent not on-row | C2 | No anonymize in V1 |
| `admin_customer_relationship_notes` | clerk PK | CRM | DELETE | — | entire row | Step 15 | Clerk-keyed identity | C2 | Flags not retained in V1 |
| `coach_shipping_addresses` | clerk | fulfillment PII | DELETE | — | all | Step 15 | App DB must not keep PII | C2 | — |
| `quotes_book_fulfillment_reminders` | clerk | fulfillment | DELETE if present | — | all | Step 15 | Email snapshots | C2 | Optional table |
| `challenge_participants` (clerk-bound) | clerk (nullable col) | marketing | DELETE where clerk matches | — | all for that clerk | Step 15 | Exact ownership only | C2 | No email delete |
| `challenge_participants` (legacy email-only) | email / NULL clerk | marketing | **OUT OF BAND** | row retained | — | Never in C2 | Not attributable | later ownership design | Does **not** block purge |
| `stripe_webhook_events` | event_id | Stripe dedupe | SHARED/DO NOT TOUCH | all | — | Never | Shared | — | — |
| `retention_daily_rollups` | day aggregates | analytics | SHARED/DO NOT TOUCH | all | — | Never | Not user-keyed | — | — |
| `film_videos` | — | catalog | SHARED/DO NOT TOUCH | all | — | Never | Product | — | — |
| `pat_quotes` / `pat_quotes_sms` | — | catalog | SHARED/DO NOT TOUCH | all | — | Never | Product | — | Confirm columns |
| `practice_prompts` | — | catalog | SHARED/DO NOT TOUCH | all | — | Never | Product | — | — |
| `respond_day_questions` | — | catalog | SHARED/DO NOT TOUCH | all | — | Never | Product | — | — |
| `training_camp_non_video_days` | — | catalog | SHARED/DO NOT TOUCH | all | — | Never | Product | — | — |
| `v2_rollout_flag` | — | catalog | SHARED/DO NOT TOUCH | all | — | Never | Flags | — | — |
| Clerk user + metadata | Clerk | identity | EXTERNAL (delete last) | tombstone clerk id in ADR | clear metadata then delete user after app_data_purged | After C2 purge + Stripe cancel | Clerk-last | C3+ | Not in purge RPC |
| Stripe customer/subs/invoices | Stripe | financial | EXTERNAL / RETAIN LEGAL | invoices/payments in Stripe | Cancel sub only (B3a); no customer delete V1 | Outside Supabase txn | Financial | B3a / later | Webhook dedupe untouched |
| Twilio message logs | Twilio | carrier | EXTERNAL | provider logs | — | Outside | Provider retention | — | SIDs may remain in STOP tombstone |
| Resend / OpenAI / Vercel logs | external | ops | EXTERNAL | provider/platform logs | — | Outside | Not durable app store | — | Disclose in privacy copy |

---

## 4. Proposed Supabase purge operation order

1. Validate deletion request ID, Clerk user ID, active lease, expected version, and `purging_app_data` state.
2. Delete `sms_identities` and `sms_audience` if still present.
3. Delete `sms_inbound_coach_jobs`.
4. Delete `sms_last_outbound_context` and `sms_delivery_state`.
5. Delete `sms_send_events` and `sms_weekly_send_events`.
6. Delete SMS drafts and generations in FK-safe order.
7. Transform STOP: insert matching STOP rows into `sms_opt_out_tombstones` (SID + received_at + token; ON CONFLICT DO NOTHING); then DELETE all target-user `sms_inbound_messages`.
8. Delete non-V2 user content (journals, summaries, Ask Pat/chat, Coach Pat notes, feedback, winback/retention, achievements, prompts/reflections, usage/preferences).
9. Delete V2 soft-linked data.
10. Delete RESTRICT children (`goal_coherence_log`, user accountability seasons, related).
11. Delete `v2_commitment` and cascade/explicit children.
12. Delete remaining `important_people` and V2 orphans.
13. Delete `user_profiles`.
14. Delete `user_identity_version`.
15. Delete testimonials (all), admin-note rows (entire), shipping/reminders. Delete `challenge_participants` **only** where `clerk_user_id` matches (legacy NULL-clerk rows untouched).
16. Preserve `account_deletion_requests` tombstone (CAS sanitize later).
17. Return counts; if **blocking** limitations nonempty → `incomplete` (CAS to `app_data_purged` remains outside and must not run). Informational counts (e.g. `challenge_rows_deleted`) are not limitations.

**Never in this transaction:** Clerk deletion; Stripe customer deletion; Twilio provider-log deletion; shared catalog deletion; public API/UI actions.

---

## 5. Architecture freeze (later C2)

- One **service-role-only**, allowlisted Supabase purge RPC
- One atomic Supabase transaction where feasible
- No dynamic SQL
- Exact request / user / lease / version binding
- Idempotent delete-if-present / anonymize-if-present
- Transaction rollback on failure
- Counts/categories only in returned JSON (no PII)
- CAS state transition **outside** the purge RPC
- External systems in later stepwise orchestration
- Clerk deletion last

If table volume makes one transaction unsafe, **C2 review** may split only high-volume tables into bounded batches. Do not change that in C1.

---

## 6. State-machine / schema fit

**Existing statuses:** `purging_app_data`, `app_data_purged` (and full B1 machine).

**Existing column:** `purge_result` ∈ `pending | ok | skipped | already_done | failed`.

**APP-041C2 (in-repo, not applied):**
- 20-arg CAS: `20260719120000_account_deletion_cas_purge_result.sql`
- Purge RPC + STOP tombstone + challenge clerk column: `20260719121000_account_deletion_purge_app_data.sql`

**Live schema verification (production `information_schema`, confirmed):**

`sms_inbound_messages`:
- `message_sid` text NOT NULL UNIQUE
- `clerk_user_id` text NOT NULL
- `phone_number` text NOT NULL
- `raw_body` text NULL
- `received_at` timestamptz NOT NULL

→ Justifies dedicated STOP tombstone + source-row deletion (no in-place anonymize).

`testimonials`:
- `clerk_user_id` text NOT NULL
- `quote` text NOT NULL
- no durable publication-consent field (`approved` is not consent)

→ Justifies delete-all testimonial policy.

**STOP evidence:** dedicated `sms_opt_out_tombstones` (`message_sid` PK, `received_at`, `opt_out_command_token` CHECK stop|unsubscribe|cancel|end). No phone/clerk/body/hash. Insert STOP rows then DELETE all target inbound.

**Testimonials:** DELETE all for user (no anonymize).

**Admin notes:** DELETE entire row.

**Challenge:** nullable `clerk_user_id` + partial index; purge `DELETE … WHERE clerk_user_id = v_clerk` only. Legacy email-only rows out of band; do not block success outcomes.

**Purge outcomes:** `purged` | `already_absent` | `conflict` | `incomplete`. Blocking limitations nonempty ⇒ **`incomplete` only**. Unlinked legacy challenge rows are **not** limitations. C3 must not CAS `app_data_purged` on incomplete/conflict (`purgeOutcomeBlocksAppDataPurged`).

**CAS to `app_data_purged`:** outside purge RPC (C3).

---

## 7. Privacy / data-deletion copy requirements

Before **public** initiation/UI is released, update privacy and `/data-deletion` copy to disclose:

- minimum STOP evidence retention (SID + timestamp + command token; no phone hash)
- Stripe financial-record retention
- testimonials fully deleted (no quote retention in V1)
- deletion tombstone retention
- challenge: clerk-bound rows deleted; legacy anonymous/email-only challenge records may remain until a separate ownership-resolution design
- external provider retention
- deletion timing and retry behavior

Copy update does **not** block private, unreachable C2 implementation and testing.

---

## 8. C2 status / entry criteria

**APP-041C2:** **IMPLEMENTED — PENDING FINAL REVIEW** (worktree; migrations not applied; no production data touched).

Production-schema alignment + ownership-safe challenge cleanup: STOP tombstone; delete-all testimonials; challenge DELETE by clerk only; legacy email-only challenge rows non-blocking.

**Before apply:** independent final code review + controlled migration apply + fake-user transactional ROLLBACK + wrong-user survival + timeout/lock observation.

**APP-041C3:** NOT STARTED (must honor incomplete ⇒ no `app_data_purged`).

---

## 9. Explicit non-claims

This freeze / C2 foundation does **not** mean:

- purge SQL was applied or ran against production
- any real user data was deleted
- transactional DB validation completed
- privacy policy was updated
- legal counsel reviewed the schedule
- public account deletion works
- app-store deletion compliance is complete
- Clerk or Stripe customers were deleted
- all legacy email-only challenge rows were removed
- migration is safe to apply yet
- C2 is COMPLETE (pending final review + DB validation)
- end-to-end deletion works
