> **SUPERSEDED (historical only — April 2026)**  
> This audit reflects **March 2025** readiness assumptions (progression-heavy SMS, `completeDay`, etc.). The shipped system has since moved to **V2 commitment + spine**, **SMS-first accountability**, and **Victory Room**. Treat everything below as **historical context**, not launch criteria for the current product.

---

# Production Readiness Audit — Summitt Mindset
## Retention / SMS / Progression-Awareness Changes

**Audit Date:** March 10, 2025  
**Scope:** All changes to sms_audience, sync flows, daily/followup/missed-yesterday crons, Momentum SMS, Coach progression awareness

---

## 1. EXECUTIVE VERDICT

**Not launch-ready.**

There are **two launch blockers** and several important issues:

1. **pause-membership and cancel-membership do not sync to sms_audience.** Users who pause or cancel subscriptions keep `summitt_subscribed: true` in `sms_audience`. They will continue to receive daily, followup, and missed-yesterday SMS until the Stripe webhook `customer.subscription.deleted` fires (which does sync). For **pause**, the webhook does NOT fire—Stripe pauses the subscription, it is not deleted. So paused users will receive SMS indefinitely. **Blocker.**

2. **Onboarding SMS opt-out without phone: drift.** When a user disables SMS in onboarding without providing a phone in that request, `normalizedPhone` is null. `syncSmsAudience` returns early when `!phoneNumber`. If the user had a phone from a prior session stored in Clerk, we never pass it. We therefore never update `sms_audience` to `sms_enabled: false`. That user stays in the audience and keeps getting SMS. **Blocker** if users can return to onboarding and toggle SMS off without re-entering phone.

3. **confirm-checkout does not sync.** New subscribers get Clerk metadata updated immediately, but `sms_audience` is only updated when the webhook runs. There is a window where a new paid user may not be in `sms_audience` and misses that day’s SMS. Tolerable but suboptimal.

4. **weekly-sms still uses Clerk + sms_identities.** Different logic from daily-sms, which uses `sms_audience`. Risk of inconsistent audiences between daily and weekly SMS.

5. **Stats naming and dead code.** `missed-yesterday-sms` uses `skippedAlreadySent` when `!existingEvent` (no daily row), which is misleading. `followup-sms` has dead `else` branch (insert) because `existingEvent` is always required.

---

## 2. CHANGE SURFACE MAP

| File | What changed | Why it matters | Risk |
|------|--------------|----------------|------|
| `src/lib/sms-audience-sync.ts` | New helper; upserts sms_audience; early return if !phoneNumber | Central sync for SMS audience; no-op without phone | **Medium** — no-op can hide missing syncs |
| `src/app/api/onboarding/sms/route.ts` | Added syncSmsAudience after Clerk + sms_identities | First integration point; opt-out drift when phone null | **High** |
| `src/app/api/twilio/inbound/route.ts` | Added syncSmsAudience after STOP and START | Sync STOP/START to audience | **Low** |
| `src/app/api/onboarding/complete/route.ts` | Added syncSmsAudience after Clerk update | Sync timezone, sms preference, etc. on completion | **Low** |
| `src/app/api/stripe/webhook/route.ts` | Added syncSmsAudience after each Clerk update (5 events) | Subscription state flows to audience | **Low** |
| `src/app/api/cron/daily-sms/route.ts` | Switched from listClerkUsers to sms_audience; added staleness/reentry | Main daily SMS path; staleness adds complexity | **Medium** |
| `src/app/api/cron/followup-sms/route.ts` | New cron; 5–8pm; requires existingEvent; blocked if missed_yesterday_sent | Retention path; tightly coupled to daily-sms | **Medium** |
| `src/app/api/cron/missed-yesterday-sms/route.ts` | New cron; 6–10am; requires existingEvent; records missed_yesterday_sent | Recovery path; depends on daily row | **Medium** |
| `src/lib/complete-day.ts` | Momentum SMS on Day 3/7; uses sms_identities | Completion-triggered SMS; different table than audience | **Medium** |
| `src/lib/coach-reply-generator.ts` | Progression block + rules | Coach context; new data in prompt | **Low** |
| `src/lib/get-or-create-daily-coach-pat-note.ts` | Passes totalDaysCompleted, daysInRow, currentDay | Feeds progression into daily note | **Low** |
| `src/lib/coach-pat-generator.ts` | Accepts progression params; adds PROGRESSION block to brief | Daily note prompt | **Low** |
| `src/lib/get-user-staleness.ts` | Unchanged; used by daily-sms and followup-sms | Staleness logic | **Low** |
| `supabase/migrations/20250310000000_create_sms_audience.sql` | New table | Schema | **Low** |

**Not touched but relevant:**

| File | Relevance | Risk |
|------|-----------|------|
| `src/app/api/pause-membership/route.ts` | Sets summittSubscribed: false; no sync | **High** |
| `src/app/api/cancel-membership/route.ts` | Same; no sync | **High** |
| `src/app/api/stripe/confirm-checkout/route.ts` | Sets summittSubscribed: true; no sync | **Medium** |
| `src/app/api/cron/weekly-sms/route.ts` | Uses listClerkUsers + sms_identities | **Medium** |
| `src/lib/coach-pat-context.ts` | getYesterdaySummary selects `summary_text` but daily_summaries has `daily_summaries` | **Low** (pre-existing) |

---

## 3. SMS_AUDIENCE INTEGRITY AUDIT

**Is sms_audience reliable enough to drive outbound SMS selection?**

Not fully. It can lag or diverge from Clerk in several situations.

**Write paths that leave it stale:**

1. **pause-membership:** Updates Clerk `summittSubscribed: false` but never calls syncSmsAudience. Paused users stay in audience.
2. **cancel-membership:** Same. Webhook will eventually sync on `customer.subscription.deleted`, but there is a delay.
3. **confirm-checkout:** Updates Clerk with subscription state but does not sync. Webhook eventually fixes this.
4. **onboarding/sms when user disables SMS without phone:** `normalizedPhone` is null; syncSmsAudience early-returns. If user had phone in Clerk from earlier, we never update their row to `sms_enabled: false`.

**Routes where Clerk changes but sms_audience does not:**

- `pause-membership` — always
- `cancel-membership` — until webhook
- `confirm-checkout` — until webhook
- `onboarding/sms` — when smsEnabled=false and normalizedPhone=null (user had phone in Clerk)

**Phone number missing and sync no-op:**

- syncSmsAudience explicitly returns when `!phoneNumber`. No row is created or updated. Callers that pass `phoneNumber: null` (e.g. onboarding complete when user never gave phone, onboarding sms when user opts out without phone) never write to sms_audience for that user.

**Row staleness when phone changes:**

- Phone changes are only handled where we call sync with the new phone. Onboarding/sms and twilio/inbound do. Stripe webhook fetches Clerk metadata, which may include phoneNumber, and passes it. If phone is changed outside those flows (e.g. future “change phone” UI), sms_audience will not update.

**Subscription changes outside webhook:**

- `pause-membership` and `cancel-membership` are the main ones. They do not sync.

**Timezone changes outside onboarding complete:**

- Only `onboarding/complete` passes timezone to sync. If timezone is updated elsewhere (e.g. settings), sms_audience will not get it.

**SMS preference changes outside onboarding:**

- Same: only onboarding/sms and onboarding/complete pass smsTimePreference. Other flows do not.

**syncSmsAudience correctness:**

- Upsert on `clerk_user_id` is correct.
- Only non-null fields are included, so we do not overwrite with null when we intend to preserve.
- Early return when `!phoneNumber` means we cannot create or update a row without a phone; for updates (e.g. sms_enabled: false) we need the phone. Onboarding opt-out without phone in that request cannot sync.

**phone_number NOT NULL:**

- Prevents rows without a phone, which is correct for sending.
- The problem is callers that need to update existing rows (e.g. disable SMS) but do not have the phone in scope and therefore pass null.

**syncSmsAudience enriching existing rows:**

- If a row exists and we call sync with only `userId` + `summittSubscribed`, we would need `phoneNumber` for the upsert to run. Without it, we no-op. Stripe webhook passes `existing?.phoneNumber` from Clerk. If Clerk has no phone, we no-op. That is consistent but can leave rows stale if Clerk is the source of phone.

**Race conditions / ordering:**

- syncSmsAudience is fire-and-forget; no explicit ordering with Clerk writes. Typical flow is Clerk first, then sync. If sync fails, we only log; no retry. Ordering is acceptable; lack of retry is a reliability concern.

---

## 4. DAILY SMS CRON AUDIT

**Replacement of Clerk full-scan with sms_audience:** Yes. We query `sms_audience` with `summitt_subscribed=true` and `sms_enabled=true` instead of listing Clerk users.

**Hybrid model:** We still call `getClerkUser` per user for `currentDay`, `timezone`, `lastCompletedAt`. Staleness uses Clerk; timezone and send window use `audienceUser.timezone` (from sms_audience). There is potential drift if Clerk and sms_audience diverge.

**Variables:**

- `timezone` for send window: `audienceUser.timezone` (sms_audience)
- `timezone` for staleness: `md.timezone` (Clerk)
- `dayNumber` / `currentDay`: `md.currentDay` (Clerk)
- Phone: `audienceUser.phone_number` (sms_audience)

**Broken assumptions:** None obvious. The main risk is sms_audience containing users who should be excluded (e.g. paused) because other routes do not sync.

**Timezone mismatch:** We use `audienceUser.timezone` for `todayKey` and send window, and `md.timezone` for staleness. If they differ, we could use one timezone for “is it 8am?” and another for staleness. Generally they should match if onboarding/complete syncs timezone.

**Retry logic:** Unchanged. `send_failed` with `retry_count < 3` still retries. Completion check before retry is correct.

**Dedupe:** `sms_send_events` unique on `(clerk_user_id, day_key)`; reservation insert is correct. Retries update the same row.

**Completion check:** Queries `daily_completion_events` by `clerk_user_id` and `day_key` (todayKey). Logic is correct.

**sms_send_events updates:** Main path and retry path both update status and metadata. Correct.

**User gets daily when they should not:** Yes, if they are in sms_audience but should not be (e.g. paused, opted out without sync).

**User misses daily when they should:** Yes, if they are not in sms_audience (e.g. new subscriber before webhook, or sync failure).

**Performance at 2,500+ users:** Single query for all audience users. Then per user: getClerkUser, completion check, maybe reserve, getOrCreateDailyPracticeVersion, getOrCreateDailyCoachPatNote, sendSMS. That is O(n) network calls. At 2,500 users and ~5–10 calls per eligible user, runtime could be long. Acceptable for cron; could be optimized later.

**Dead code:** `getCoachHeader` is defined but never used. `skippedMissingIdentity` is never incremented (we no longer use sms_identities for this path).

---

## 5. FOLLOWUP SMS AUDIT

**Time window:** 5–8pm local via `local.getHours() >= 17 && < 20`. Correct.

**Completion check:** Queries `daily_completion_events` for todayKey. Correct.

**Requires existing daily SMS event:** Yes. `if (!existingEvent) { stats.skippedAlreadySent += 1; continue; }` skips when there is no row.

**followup_sent metadata:** We check `meta.followup_sent === true` and skip. On send we update `metadata: { ...meta, followup_sent: true }`. Safe.

**Duplicate sends:** No. We check `followup_sent` before sending and set it on send.

**Send after missed-yesterday:** No. We check `meta.missed_yesterday_sent === true` and skip. Blocking is correct.

**Adaptive staleness:** `getUserStalenessLevel` uses Clerk `timezone` and `lastCompletedAt`. `getFollowupMessage(level)` returns the right message. Correct.

**Clerk metadata:** One `getClerkUser` per user for staleness. No redundant fetches.

**Excluded users:** We skip completed users and those with `followup_sent` or `missed_yesterday_sent`. Correct.

**Skipped users who should receive:** Possible if sms_audience is missing them or if `!existingEvent` (no daily row). Latter is by design—we only follow up when daily was sent.

**Stats naming:** `skippedAlreadySent` when `!existingEvent` is misleading: it means “no daily SMS row,” not “followup already sent.”

**Dead code:** The `else` branch (insert) after send can never run because we require `existingEvent` earlier. Dead code.

---

## 6. MISSED-YESTERDAY SMS AUDIT

**“Missed yesterday” logic:** We compute `yesterdayKey` as `getDateKeyInTimezone(now - 86400000, timezone)`. We skip if `completedYesterday` exists. So we send only when the user did not complete yesterday. Correct.

**Timezone:** Same pattern as other crons. `resolveUserTimezone` handles bad values.

**Yesterday computation:** 24-hour subtraction is fine for 6–10am; minor DST edge cases are acceptable.

**Requires existing daily SMS event:** Yes. `if (!existingEvent) { stats.skippedAlreadySent += 1; continue; }` enforces this.

**Orphan messages:** No. We require an existing row from daily-sms.

**Blocking valid messages:** Only by requiring a daily row. That is intentional.

**Collision with followup-sms:** No. Missed-yesterday runs 6–10am; followup 5–8pm. Different windows. Followup also skips when `missed_yesterday_sent` is true, so we avoid double-send.

**missed_yesterday_sent metadata:** We check and set it correctly. Safe.

**Stats naming:** `skippedAlreadySent` when `!existingEvent` is wrong; it means “no daily row.”

**Dead code:** The `else` (insert) branch can never run because we require `existingEvent`.

---

## 7. MOMENTUM SMS AUDIT

**Placement:** After achievements, before return. Completion has already succeeded. Correct.

**Blocking completion:** No. Wrapped in try/catch; errors are logged only.

**Duplicate sends:** No dedupe. `completeDay` is invoked from app and SMS. For a given day, completion should happen once (unique `daily_completion_events`). If the same completion is triggered twice (e.g. bug or retry), we could send twice. Unlikely but possible.

**App vs SMS paths:** Both call `completeDay`. Momentum SMS fires on either. Correct.

**sms_identities vs sms_audience:** Momentum uses `sms_identities`. Daily-sms uses `sms_audience`. If they diverge (e.g. sync issues), a user in sms_audience but not sms_identities would get daily but not momentum, and vice versa. sms_identities is filled by onboarding/sms and twilio/inbound; sms_audience is filled by syncSmsAudience. In normal flows they should stay aligned, but it is a second source of truth.

**Dedupe:** None. If `completeDay` were called twice for the same completion, we could double-send. Not a blocker; could add later.

**Day 3 / Day 7:** We use `newTotalDaysCompleted === 3 || newTotalDaysCompleted === 7`. After completion, `newTotalDaysCompleted` is `totalDaysCompleted + 1`. So we send on completion of day 3 (newTotal=3) and day 7 (newTotal=7). Correct.

**Twilio in completion flow:** Adds latency and a failure point. Wrapped in try/catch so completion still succeeds. Acceptable.

---

## 8. COACH REPLY PROGRESSION-AWARENESS AUDIT

**Progression in prompt:** Yes. PROGRESSION block with `totalDaysCompleted`, `currentDay`, `daysInRow` is at the top of the user prompt.

**Validity:** From `md?.totalDaysCompleted ?? 0`, etc. Clerk can have missing or weird values; we default safely.

**currentDay vs dayNumber:** `currentDay = md?.currentDay ?? dayNumber`. We prefer Clerk, fallback to `dayNumber`. They should match when the user is on the current day. If Clerk lags, we use `dayNumber` from the caller.

**Repetition:** Rules say “do not mention progression every time” and “only when it strengthens the moment.” Helps but does not guarantee.

**Unused variables:** None. Progression vars are used in the prompt.

**Duplicate fetches:** `md` was already fetched; we now use it for progression. No extra fetch.

---

## 9. DAILY COACH NOTE PROGRESSION-AWARENESS AUDIT

**Values passed:** `get-or-create-daily-coach-pat-note` passes `totalDaysCompleted`, `daysInRow`, `currentDay` into `generateCoachPatNote`.

**Generator usage:** PROGRESSION block is at the top of the brief. Uses `totalDaysCompleted ?? 0`, etc.

**Naming:** `currentDay` and `dayNumber`; we use `currentDay ?? dayNumber` in the prompt. Aligned.

**Repetition:** No extra rules beyond what Coach reply has. Prompt does not force use.

**Type/param issues:** None.

**Existing generation impact:** Only added context; no structural change. Low risk.

---

## 10. CROSS-SYSTEM DRIFT / DUPLICATION AUDIT

**Duplicate truth:**

- `sms_identities` and `sms_audience` both represent SMS eligibility.
- `summittSubscribed` in Clerk vs `summitt_subscribed` in sms_audience.
- `smsEnabled` in Clerk vs `sms_enabled` in sms_audience.

**Stale reads:** sms_audience can be stale when pause/cancel/confirm-checkout/onboarding-opt-out do not sync.

**Mixed sources:**

- Daily-sms: sms_audience for audience, Clerk for progression/staleness.
- Weekly-sms: Clerk + sms_identities.
- Momentum: sms_identities.
- Followup/missed-yesterday: sms_audience.

**Message collisions:** Handled by metadata flags (followup_sent, missed_yesterday_sent) and time windows.

**Tone:** Reentry and followup messages are consistent in tone.

**Variable naming:** `skippedAlreadySent` used for “no daily row” is misleading in both followup and missed-yesterday.

**Timezone:** All crons use `resolveUserTimezone` and `getDateKeyInTimezone` consistently.

**SMS eligibility:** daily/followup/missed-yesterday use sms_audience; weekly and momentum use Clerk + sms_identities.

**sms_send_events.metadata coupling:** Crons share the same row and set different flags. Safe if we always merge (e.g. `{ ...meta, followup_sent: true }`).

**Acceptable for launch:** Most logic; progression; time windows.

**Risky but tolerable:** confirm-checkout sync delay; weekly-sms source mismatch.

**Blockers:** pause/cancel not syncing; onboarding opt-out without phone not syncing.

---

## 11. EDGE CASE / FAILURE MODE AUDIT

| Edge case | What happens | Safe? | Blocker? |
|-----------|--------------|-------|----------|
| User changes phone | Only sync’d where we have the new phone (onboarding, inbound) | No if changed elsewhere | No |
| User disables SMS in onboarding without phone | syncSmsAudience no-ops; user may stay in audience | No | Yes |
| STOP then START | inbound syncs both; audience updated | Yes | No |
| User completes by SMS before followup | completion check skips; no followup | Yes | No |
| Morning recovery then completes before daily/followup | completed today skips both | Yes | No |
| Webhook delayed | sms_audience lags until webhook | Temporary mismatch | No |
| syncSmsAudience fails | Log only; no retry | Stale data | No |
| Twilio failure | Momentum/logging; completion succeeds | Yes | No |
| Duplicate cron run | Reservation/dedupe via sms_send_events | Yes | No |
| Stale sms_audience | Wrong users can get or miss SMS | Depends on drift cause | Yes for pause/opt-out |
| Missing metadata | Defaults (0, dayNumber) prevent crashes | Yes | No |
| Invalid timezone | resolveUserTimezone returns default | Yes | No |
| existingEvent metadata overwrite | We merge `{ ...meta, newFlag: true }` | Yes | No |
| No row in sms_send_events | followup/missed-yesterday skip (by design) | Yes | No |
| Multiple crons, same row | Both update metadata; no conflict | Yes | No |
| Paused user | Stays in sms_audience; keeps getting SMS | No | Yes |

---

## 12. PERFORMANCE / SCALE AUDIT

**daily-sms (2,500 users):**

- One sms_audience query.
- Per user: getClerkUser, maybe completion check, maybe reserve, getOrCreateDailyPracticeVersion, getOrCreateDailyCoachPatNote, sendSMS. Sequential.
- At ~500 eligible, ~3000+ network calls. Could take minutes. Acceptable for cron.

**followup-sms:** Same pattern; getClerkUser per user. Similar scale.

**missed-yesterday-sms:** No Clerk call; uses sms_audience only. Lighter.

**Momentum SMS:** One extra Supabase query and one send per completion. Low impact.

**Unnecessary Clerk calls:** followup and daily both call getClerkUser for staleness/metadata. Could be reduced if sms_audience stored more.

**Before launch:** None strictly required; crons can be slow.

**Can wait:** Caching, batching, moving more data into sms_audience.

---

## 13. TEST / VERIFICATION CHECKLIST

### Onboarding
- Complete onboarding with SMS on and valid phone → user in sms_audience with phone, sms_enabled true.
- Complete onboarding with SMS off, no phone → user not in sms_audience (or no row if never had phone).
- Complete onboarding with SMS off, had phone in prior step → **verify:** does sync run with phone? Currently no if normalizedPhone is null.
- Complete onboarding with SMS on then go back and turn off → **verify:** sync with phone and sms_enabled false.

### Subscription changes
- New subscription via checkout → confirm-checkout runs; webhook runs. **Verify:** sms_audience has summitt_subscribed true.
- Pause subscription → **verify:** sms_audience gets summitt_subscribed false. (Currently it does not.)
- Cancel subscription → webhook should eventually sync. **Verify:** sms_audience updated.

### Daily SMS
- User in audience, in send window, not completed → receives daily SMS.
- User completes before send → no daily SMS.
- User in retry window (send_failed, retries left) → retry sends.
- User with stopped_at → filtered by query or loop; no send.

### Followup SMS
- User not completed, 5–8pm, has daily row, no followup_sent → receives followup.
- User completed today → no followup.
- User has missed_yesterday_sent → no followup.
- User has no daily row → no followup (by design).

### Missed-yesterday SMS
- User missed yesterday, 6–10am, has daily row, not completed today → receives missed-yesterday.
- User completed yesterday → no missed-yesterday.
- User has no daily row → no missed-yesterday.

### STOP/START
- User sends STOP → sms_identities and sms_audience updated; no more SMS.
- User sends START → both updated; SMS resume.

### Momentum SMS
- Complete day 3 → receives “You're building something real now.”
- Complete day 7 → receives “This is who you are becoming.”
- Complete other days → no momentum SMS.
- No sms_identities row → no momentum SMS.

### Coach reply
- User with progression → PROGRESSION block in prompt.
- Reply does not always mention progression.

### Daily Coach note
- Note generation includes PROGRESSION.
- Tone remains calm.

---

## 14. LAUNCH BLOCKERS VS NON-BLOCKERS

### A. Launch blockers

1. **pause-membership and cancel-membership must sync summittSubscribed to sms_audience.** Paused users currently keep getting SMS.
2. **Onboarding SMS opt-out without phone must still sync when user has a phone in Clerk.** Need to pass `existing?.phoneNumber` (or equivalent) into sync when disabling SMS so we can update the row.

### B. Important but can wait

1. confirm-checkout should call syncSmsAudience for faster audience update.
2. weekly-sms should be aligned with sms_audience (or at least document the difference).
3. Fix stats: `skippedAlreadySent` → e.g. `skippedNoDailyRow` when `!existingEvent`.
4. Remove dead `else` (insert) branches in followup-sms and missed-yesterday-sms.
5. coach-pat-context `getYesterdaySummary` uses `summary_text`; daily_summaries has `daily_summaries`. Fix or confirm column name.
6. Momentum SMS dedupe (e.g. via sms_send_events or a separate table).
7. Add retry or idempotency for syncSmsAudience failures.

---

## 15. TOP 20 THINGS CHATGPT SHOULD REMEMBER FROM THIS AUDIT

1. **sms_audience** is the source of truth for daily, followup, and missed-yesterday SMS selection. It must stay in sync with Clerk for subscription and SMS state.
2. **syncSmsAudience** no-ops when `phoneNumber` is null. You cannot update an existing row without passing the phone (or fetching it from Clerk).
3. **pause-membership** and **cancel-membership** do not call syncSmsAudience. Paused users keep getting SMS until this is fixed.
4. **onboarding/sms** disables SMS without sync when the user does not provide a phone in that request, even if Clerk has a phone.
5. **confirm-checkout** does not sync; the Stripe webhook does. New subscribers can lag in sms_audience.
6. **daily-sms** uses `sms_audience` for the audience and `getClerkUser` for `currentDay`, `lastCompletedAt`, and `timezone` (staleness).
7. **followup-sms** requires an existing `sms_send_events` row (from daily-sms) and skips when `missed_yesterday_sent` or `followup_sent` is true.
8. **missed-yesterday-sms** requires an existing daily row and skips when the user completed yesterday.
9. **weekly-sms** still uses `listClerkUsers` and `sms_identities`, not `sms_audience`.
10. **Momentum SMS** uses `sms_identities`, not `sms_audience`. It fires on day 3 and 7 completion.
11. **sms_send_events** has one row per (clerk_user_id, day_key). Metadata stores `followup_sent`, `missed_yesterday_sent`, and other flags.
12. **followup** and **missed-yesterday** use the misleading stat name `skippedAlreadySent` when there is no daily row. The real reason is “no daily SMS.”
13. **getUserStalenessLevel** uses Clerk `lastCompletedAt` and `timezone`. Levels: fresh (0–1 days), short_idle (2–3), medium_idle (4–7), long_idle (8+).
14. **Progression** (totalDaysCompleted, currentDay, daysInRow) is passed to both Coach reply and daily Coach note prompts.
15. **Stripe webhook** has five subscription-related events; each updates Clerk and then syncSmsAudience with `getClerkPublicMetadata` for phone, timezone, etc.
16. **twilio/inbound** STOP and START update sms_identities, Clerk, and syncSmsAudience. Both flows are wired.
17. **daily-sms** uses `audienceUser.timezone` for `todayKey` and send window, and `md.timezone` for staleness. They should match if onboarding/complete syncs timezone.
18. **sms_audience** has unique `clerk_user_id`; `phone_number` is NOT NULL. Rows are created only when we have a phone.
19. **resolveUserTimezone** defaults to `America/New_York` for invalid or missing timezone.
20. **getDateKeyInTimezone** returns `YYYY-MM-DD` in the user’s timezone via `Intl.DateTimeFormat` and `en-CA`.
