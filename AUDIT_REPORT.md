# Summitt Mindset — State of the Product and Codebase Audit

**Audit Date:** March 2025  
**Scope:** Read-only inspection of entire codebase  
**Purpose:** Durable memory dump for ChatGPT-driven product/engineering decisions  

---

## 1. HIGH-LEVEL PRODUCT TRUTH

### What the Product CURRENTLY Is (From Code)

**Summitt Mindset is a retention-first daily leadership practice SaaS.** The core experience is:

- **One daily practice per day** — a short note from Coach Pat, one action item, one reflection prompt
- **One journal entry** — at least one honest sentence to "complete" the day
- **Progression is linear** — Day 1, Day 2, … Day 30 (Training Camp), then In-Season (day 31+)
- **No catch-up / no backlog** — you can only complete TODAY; past days are read-only

### Actual Core Daily Experience

1. User receives **Coach Pat note** (personalized, LLM-generated) + **today's practice** (action item + reflection prompt)
2. User writes **one honest sentence** (or more) in the journal
3. User clicks **Complete Today's Practice** → day locks, progression advances
4. **Coach Pat reply** (post-completion) — optional, rate-limited, personalized

### Actual Role of SMS

- **SMS is a first-class channel** — same daily content, same completion logic
- SMS users get morning delivery (6/8/10am local based on preference)
- Inbound reply = journal entry + completion attempt + Coach Pat reply (same `coachEngine`)
- **SMS and app share** `completeDay`, `getOrCreateDailyPracticeVersion`, `getOrCreateDailyCoachPatNote`

### Actual Role of AI

- **Coach Pat Daily Note** — LLM-generated each day (OpenAI); stored in `coach_pat_daily_notes`
- **Coach Pat Reply** — post-completion coaching (OpenAI); uses profile context, summaries, journal
- **Ask Pat** — standalone Q&A (embeddings + GPT-4.1-mini); uses Pat Summitt book chunks
- **In-Season reflection prompts** — LLM-generated (days 31+)
- **Memory/compression** — deterministic (no LLM); `compressReflectionToMemoryAtom` produces coach-safe atoms

### Core vs Optional

- **Core:** Daily practice, journal, completion, progression, Coach Pat note
- **Optional:** Ask Pat, Film Room, Coach Pat reply (post-completion), SMS

### What the Product Is Optimized For Today

- **Retention** — streaks (`daysInRow`), staleness detection, training camp structure
- **Parity** — app and SMS use identical logic for completion, practice version, coach note
- **Personalization** — onboarding profile, daily/weekly summaries, pattern insights

### Unfinished / Partial / Future-Looking

- `trainingCampTrack: "women"` exists but content resolution may be partial
- Weekly SMS sends weekly summary; daily SMS sends daily practice
- Winback, rescue, pulse flows exist; post-churn winback queue in retention metrics
- `ensure-daily-prompt` — legacy or backup path; `daily_prompts` archived on completion

---

## 2. FULL USER FLOW MAP

### Numbered Sequence

1. **Landing** — `/` (home), marketing pages (`/daily-practice`, `/ask-pat-preview`, `/film-room-preview`, `/about`, `/subscribe`)
2. **Sign-up / Sign-in** — Clerk (`/sign-up`, `/sign-in`); no custom auth
3. **Subscribe First** — Hard gate: must subscribe before onboarding (`/subscribe` → Stripe Checkout)
4. **Checkout** — Stripe subscription (7-day trial); `client_reference_id: userId`; success → `/subscribe/success`
5. **Confirm Checkout** — `POST /api/stripe/confirm-checkout` sync-updates Clerk metadata; then redirect to `/post-sign-in`
6. **Post-Sign-In Router** — `/post-sign-in` (canonical redirect):
   - If `onboardingCompleted !== true` → `/onboarding`
   - If not subscribed → `/subscribe`
   - Else → `/dashboard/day/[currentDay]`
7. **Onboarding** — Must be subscribed. Steps:
   - `/onboarding` — intro, CTA to identity
   - `/onboarding/identity` — preferred_name, life_desires, ninety_day_vision, support_area → `user_profiles`
   - `/onboarding/relationships` — people_summary, relationship_status, partner_name, children_summary → `user_profiles`
   - `/onboarding/pressure` — pressure_summary, proud_of, best_self_trigger, etc. → `user_profiles`
   - `/onboarding/sms` — SMS opt-in, phone, consent → Clerk + `sms_identities`
   - `/onboarding/complete` — pledge (daily + no backlog), timezone → `POST /api/onboarding/complete` → sets `onboardingCompleted: true`, `currentDay: 1`
8. **Daily Practice** — `/dashboard/day/[day]`:
   - Server resolves `resolveDailyPracticeForUser` + `getOrCreateDailyCoachPatNote`
   - `DayClient` renders note, action, reflection, journal, video (if Training Camp day 1–30)
9. **Journal** — `POST /api/journal` upserts `journal_entries` (clerk_user_id, day_number)
10. **Complete** — `DayCompleteButton` → `POST /api/day/complete` → `completeDay({ source: "app" })`
11. **After Completion** — Success overlay; optional Coach Pat reply (if user requests); feedback prompts at day 7, 14, 30
12. **Next Day** — `currentDay` incremented in Clerk; user returns to `/dashboard/day/[currentDay]`

### SMS-Only Path

1. User opts into SMS in onboarding
2. Cron `daily-sms` runs every 5 min; sends at 6/8/10am local (preference-based)
3. User replies with journal text
4. Twilio webhook `POST /api/twilio/inbound`:
   - Upserts `journal_entries`, calls `completeDay({ source: "sms" })`, calls `coachEngine`
   - Returns TwiML with completion confirmation + Coach Pat reply

### App-Only Path

1. User visits `/dashboard/day/[currentDay]` each day
2. Writes journal in app, clicks Complete
3. `POST /api/day/complete` → `completeDay({ source: "app" })`

### Both App and SMS

- Same `currentDay`, same `daily_prompts` / `daily_prompt_versions`
- Completion can happen via app OR SMS; `daily_completion_events` has `(clerk_user_id, day_key)` unique — prevents double completion
- SMS and app share `getOrCreateDailyPracticeVersion`, `getOrCreateDailyCoachPatNote`, `completeDay`

---

## 3. CURRENT DATA / SOURCE OF TRUTH ARCHITECTURE

### Clerk publicMetadata

Stores:

- `summittSubscribed` (boolean) — from Stripe webhook
- `summittPlan` — "monthly" | "annual" | null
- `stripeCustomerId`, `stripeSubscriptionId`
- `onboardingCompleted` (boolean)
- `currentDay` (number) — progression
- `totalDaysCompleted` (number)
- `daysInRow` (number) — streak
- `lastCompletedAt` (ISO string)
- `timezone` (IANA string, e.g. America/New_York)
- `smsEnabled`, `smsTimePreference` (early_morning | morning | midday), `phoneNumber`
- `smsDisclosureAccepted`, `smsStopHelpDisclosureShownAt`
- `smsStoppedAt`, `smsRestartedAt` — STOP/START handling
- `trainingCampTrack` — "women" | standard
- `activeCoachDay`, `activeCoachDayKey` — used for SMS thread continuity

### Supabase

- `user_profiles` — onboarding answers (identity, relationships, work, health, pressure)
- `journal_entries` — (clerk_user_id, day_number) unique; content, reflection_prompt, action_item, source
- `daily_completion_events` — (clerk_user_id, day_key) unique; source, day_number
- `daily_prompts` — archived on completion (action_item, reflection_prompt per day)
- `daily_prompt_versions` — rotating version per (clerk_user_id, day_key) for TODAY
- `daily_summaries` — memory atoms per (clerk_user_id, day_number)
- `weekly_summaries` — (clerk_user_id, week_start_day)
- `pattern_insights` — extracted patterns (pattern_key, confidence)
- `recent_summary` — latest 1–2 pattern phrase for Coach Pat
- `coach_pat_daily_notes` — daily note per (clerk_user_id, day_key)
- `coach_conversations` — user/coach thread per day
- `coach_reply_usage` — rate limit rows (per day_key UTC)
- `ask_pat_questions`, `ask_pat_usage`
- `sms_identities` — (phone_number, clerk_user_id), sms_enabled, stopped_at
- `sms_send_events` — (clerk_user_id, day_key) unique; status, message_sid
- `sms_inbound_messages` — raw inbound
- `sms_weekly_send_events`, `sms_daily_stats`
- `feedback_events`, `testimonials`
- `film_videos`, `training_camp_non_video_days`
- `pat_quotes`
- `achievements_unlocked`, `challenge_participants`
- `retention_signals`, `retention_daily_rollups`, `winback_queue`

### Stripe

- Subscriptions (monthly, annual)
- Checkout sessions — `client_reference_id` = Clerk userId
- Webhook updates Clerk metadata; no separate subscription DB

### Twilio

- Sends SMS via Messaging Service or fallback number
- Inbound → `/api/twilio/inbound` (signature-verified)

### Source of Truth by Concept

| Concept | Source of Truth |
|---------|-----------------|
| Subscription status | Clerk `summittSubscribed` (Stripe webhook + confirm-checkout) |
| Progression (current day) | Clerk `currentDay` |
| Total days completed | Clerk `totalDaysCompleted` |
| Streak | Clerk `daysInRow` |
| Timezone | Clerk `timezone` |
| Onboarding complete | Clerk `onboardingCompleted` |
| SMS enabled | Clerk + `sms_identities.sms_enabled` (identities canonical for opt-out) |
| Journal history | Supabase `journal_entries` |
| Daily summaries | Supabase `daily_summaries` |
| Weekly summaries | Supabase `weekly_summaries` |
| Ask Pat memory | `daily_summaries` + `weekly_summaries` (no separate Ask Pat memory table) |
| Coach Pat memory | `coach_conversations` + `recent_summary` + `pattern_insights` + profile |
| Testimonials/feedback | Supabase `feedback_events`, `testimonials` |
| Training content | Supabase `film_videos`, `training_camp_non_video_days` |

### Data Duplication / Edge Cases

- Subscription: Stripe is source; Clerk is cached; confirm-checkout + webhook keep in sync
- `sms_identities` vs Clerk: both store sms_enabled; inbound STOP updates both
- `listClerkUsers` pagination (200/500) — daily-sms scans all users each run; no cursor persistence

---

## 4. DATABASE / TABLE / SCHEMA BREAKDOWN

Inferred from code (no migrations in repo):

| Table | Purpose | Key Columns | Notes |
|-------|---------|-------------|-------|
| `user_profiles` | Onboarding profile | clerk_user_id, preferred_name, life_desires, ninety_day_vision, support_area, people_summary, relationship_status, partner_name, children_summary, responsibility, financial_goals, work_challenge, physical_state, health_goal, energy_obstacles, pressure_summary, proud_of, best_self_trigger | Upsert on conflict clerk_user_id |
| `journal_entries` | Daily journal | clerk_user_id, day_number, content, reflection_prompt, action_item, source | Unique (clerk_user_id, day_number) |
| `daily_completion_events` | Completion lock | clerk_user_id, day_key, source, day_number | Unique prevents double complete |
| `daily_prompts` | Archived prompts | clerk_user_id, day_number, action_item, reflection_prompt, source | Written on completion |
| `daily_prompt_versions` | Rotating today | clerk_user_id, day_key, day_number, action_item, reflection_prompt, source | Unique (clerk_user_id, day_key) |
| `daily_summaries` | Memory atoms | clerk_user_id, day_number, daily_summaries | Upsert on completion |
| `weekly_summaries` | Weekly rollup | clerk_user_id, week_start_day, week_end_day, weekly_summary | When day % 7 === 0 |
| `pattern_insights` | Extracted patterns | clerk_user_id, pattern_key, pattern_text, confidence | From weekly extraction |
| `recent_summary` | Coach context | clerk_user_id, summary_text | Top 2 patterns phrased |
| `coach_pat_daily_notes` | Daily Coach note | clerk_user_id, day_number, day_key, note_text | Unique (clerk_user_id, day_key) implied |
| `coach_conversations` | Coach thread | clerk_user_id, day_number, role, content | user + coach messages |
| `coach_reply_usage` | Rate limit | clerk_user_id, day_key | 20/day default |
| `ask_pat_questions` | Ask Pat log | clerk_user_id, day_key, question | |
| `ask_pat_usage` | Ask Pat rate limit | clerk_user_id, day_key | 10/day |
| `sms_identities` | Phone mapping | phone_number, clerk_user_id, sms_enabled, stopped_at | Canonical opt-out |
| `sms_send_events` | SMS send log | clerk_user_id, day_key, status, message_sid | Unique per user/day |
| `sms_inbound_messages` | Inbound log | message_sid, clerk_user_id, phone_number, raw_body | Unique message_sid |
| `sms_weekly_send_events` | Weekly SMS | Similar to sms_send_events | |
| `sms_daily_stats` | Daily stats | day_key, total_users, eligible, sent, failed, ... | Upsert by day_key |
| `feedback_events` | Feedback | event_type, clerk_user_id, ... | Multiple event types |
| `testimonials` | Approved testimonials | From feedback_events | approve/unapprove |
| `film_videos` | Film Room | training_camp_day, training_camp_track, action_item, reflection_prompt | |
| `training_camp_non_video_days` | Non-video days | training_camp_day, action_item, reflection_prompt | |
| `pat_quotes` | Quote library | For marketing/quote-of-the-day | |
| `achievements_unlocked` | Achievements | clerk_user_id, achievement_key | |
| `challenge_participants` | 7-day challenge | email, etc. | |
| `retention_signals`, `retention_daily_rollups`, `winback_queue` | Retention analytics | | Cron retention-metrics |

---

## 5. DAILY EXPERIENCE BREAKDOWN

### Routes / Components

- `src/app/dashboard/day/[day]/page.tsx` — server page
- `src/app/dashboard/day/[day]/day-client.tsx` — client (journal, complete button)
- `src/components/day-complete-button.tsx` — canonical complete UX

### How Daily Prompt Is Chosen

- `resolveDailyPracticeForUser` in `src/lib/resolve-daily-practice.ts`
- **Past day:** `daily_prompts` (archived)
- **Today:** `getOrCreateDailyPracticeVersion` → `daily_prompt_versions` (cached) or generated:
  - Days 1–30: `resolveTrainingCampDay` (film_videos or training_camp_non_video_days)
  - Days 31+: `selectInSeasonActionForDay` + `generateInSeasonReflectionPrompt` (LLM)

### Journal Prompt

- Comes from the same resolved practice (`reflectionPrompt`)

### Locked / Unlocked

- Only `currentDay` is unlockable (today)
- `requestedDay > currentDay` → redirect to current day

### Completion Flow

1. `DayCompleteButton` → `POST /api/day/complete` with `{ day: dayNumber }`
2. API checks `pageDay === currentDay` (from Clerk)
3. `completeDay({ userId, source: "app" })` in `src/lib/complete-day.ts`
4. `tryInsertCompletionLock` — insert `daily_completion_events`; 23505 = already completed
5. Journal required — reads `journal_entries` for currentDay; retry once for SMS race
6. `compressReflectionToMemoryAtom` → memory atom
7. Archive to `daily_prompts`, upsert `daily_summaries`
8. If day % 7 === 0: weekly extraction → `pattern_insights`, `weekly_summaries`, `recent_summary`
9. Update Clerk: currentDay+1, totalDaysCompleted+1, daysInRow+1, lastCompletedAt, activeCoachDay/Key
10. `awardAchievementsIfEligible`

### Duplicate Prevention

- `daily_completion_events` unique (clerk_user_id, day_key) — Postgres 23505

### Timezone

- `resolveUserTimezone(metadata.timezone)` — default America/New_York
- `getDateKeyInTimezone(now, timezone)` — "YYYY-MM-DD" in user TZ

### Tomorrow

- `currentDay + 1` in Clerk after completion

### Past Days

- Read-only; load from `daily_prompts`; no completion button

### Coaching / Memory

- `getOrCreateDailyCoachPatNote` — daily note
- `coachEngine` — post-completion reply; uses `buildCoachPatContext` (recent_summary, daily_summaries, pattern_insights, journal)

---

## 6. SMS EXPERIENCE BREAKDOWN

### When SMS Is Sent

- **Daily:** Cron `GET /api/cron/daily-sms` every 5 min (`*/5 * * * *`)
- **Weekly:** Cron `GET /api/cron/weekly-sms` every 5 min; sends Sunday 5pm local

### Cron Jobs (vercel.json)

- `daily-sms` — */5 * * * *
- `weekly-sms` — */5 * * * *
- `challenge` — 0 * * * * (hourly)

### Message Content

- **Daily:** Coach Pat note + training header (days 1–30) + action item + reflection prompt + completion CTA
- **Weekly:** From `weekly_summaries` (last week)

### Logic Parity

- Same `getOrCreateDailyPracticeVersion`, `getOrCreateDailyCoachPatNote`
- Same `completeDay` (source: "sms")

### Inbound Handling

- `POST /api/twilio/inbound` — Twilio signature verified
- Lookup `sms_identities` by `From` phone
- STOP → sms_enabled=false, stopped_at
- START → sms_enabled=true, stopped_at=null
- HELP → static reply
- Otherwise: upsert journal, `completeDay`, `coachEngine` → return TwiML with confirmation + Coach reply

### Reply Storage

- `journal_entries` upsert (clerk_user_id, day_number)
- `sms_inbound_messages` insert (message_sid for dedupe)

### Completing via SMS

- Yes — same `completeDay({ source: "sms" })`

### Reminders

- No explicit reminder flow; only one daily send per user (reserved via sms_send_events)
- Retries: up to 3 for `send_failed`

### Timezone / Send Time

- `smsTimePreference`: early_morning (6), morning (8), midday (10)
- 5-minute window: `local.getHours() === sendHour && local.getMinutes() < 5`

### Opt-in / Compliance

- `sms_identities.sms_enabled`, `stopped_at`
- Confirmation SMS includes STOP + HELP
- `smsDisclosureAccepted` required in onboarding

### Gaps

- Weekly SMS uses `getWeekKey` (YYYY-WW); weekly summary key is `week_start_day` — potential mismatch if week boundaries differ
- `listClerkUsers` pagination — 200 per page; no cursor; all users scanned each run

### Scalability

- 2,500 users × N pages = many Clerk API calls per cron run
- No batching; each user = multiple Supabase queries

---

## 7. ASK PAT BREAKDOWN

### Routes

- `POST /api/ask-pat/route.ts`

### Context

- `buildProfileContext` (user_profiles)
- Last 7 `daily_summaries`
- Latest `weekly_summaries`

### Embeddings

- Yes — `openai.embeddings.create` with text-embedding-3-small
- `getTopRelevantChunks(queryEmbedding, 6)` from `pat_library_with_embeddings.jsonl`

### Content

- Pat Summitt book chunks (JSONL file in `src/lib/ask-pat/`)

### Memory

- Profile + daily/weekly summaries (no separate Ask Pat memory store)

### Storage

- `ask_pat_questions` — question logged
- `ask_pat_usage` — rate limit

### Rate Limits

- 10 per day (UTC day_key)

### Failure

- 200 with error payload for rate limit / usage check failure
- 500 for server error

### Model

- gpt-4.1-mini, temperature 0.6

### Flow

1. Rate limit check (ask_pat_usage)
2. Insert usage row
3. Save question
4. Build profile + summaries
5. Embed question
6. Cosine similarity → top 6 chunks
7. System prompt + profile + athlete context + book chunks
8. Completion → finalize with display name

---

## 8. COACH PAT BREAKDOWN

### Daily Note

- `getOrCreateDailyCoachPatNote` — `coach_pat_daily_notes` (clerk_user_id, day_key)
- Uses `generateCoachPatNote` (from coach-pat-generator)
- Input: actionItem from `getOrCreateDailyPracticeVersion`
- Stored: note_text, staleness_mode, simplicity_passed, model

### Post-Completion Reply

- `coachEngine` in `src/lib/coach-engine.ts`
- Called from app (day-client) and from Twilio inbound
- Uses `generateCoachReply` from `coach-reply-generator`

### Routes / Files

- Day page calls `getOrCreateDailyCoachPatNote` server-side
- `coachEngine` invoked from client (app) or Twilio inbound

### Prompts / Context

- Profile (`buildProfileContext`)
- `buildCoachPatContext` — recent_summary, last 7 daily_summaries, pattern_insights, today's journal

### Storage

- `coach_conversations` — user + coach messages
- `coach_reply_usage` — rate limit

### Rate Limits

- 20 replies per UTC day (coach_reply_usage)

### Ephemeral vs Persistent

- All stored; nothing ephemeral

### Personalization

- Profile, summaries, patterns, journal

---

## 9. ONBOARDING BREAKDOWN

### Steps (5)

1. Identity — `/onboarding/identity`
2. Relationships — `/onboarding/relationships`
3. Pressure — `/onboarding/pressure`
4. SMS — `/onboarding/sms`
5. Complete — `/onboarding/complete`

### Routes

- Each step has page + API route (identity, relationships, pressure, sms)
- `POST /api/onboarding/complete` — canonical completion

### What Gets Saved

- Identity: preferred_name, life_desires, ninety_day_vision, support_area → user_profiles
- Relationships: people_summary, relationship_status, partner_name, children_summary → user_profiles
- Pressure: pressure_summary, proud_of, best_self_trigger, etc. → user_profiles
- SMS: Clerk metadata + sms_identities (phone, consent)

### Required vs Optional

- Identity/relationships/pressure: Required (complete page redirects to identity if no profile)
- SMS: Optional
- Pledge: Required (both checkboxes)

### Clerk on Complete

- onboardingCompleted: true
- currentDay: existing ?? 1
- timezone (from client)
- smsEnabled (only if valid consent + phone)
- smsTimePreference (preserved or default "morning")

### Marks Complete

- `POST /api/onboarding/complete` → `updateClerkPublicMetadata` with onboardingCompleted: true

### Edge Cases

- Complete preserves prior SMS settings
- If user skips SMS, smsEnabled stays false

### Retention Fit

- Profile drives personalization; pledge sets expectations (no backlog)

---

## 10. SUBSCRIPTION / PAYWALL / ACCESS CONTROL

### Stripe

- `STRIPE_PRICE_ID_MONTHLY`, `STRIPE_PRICE_ID_ANNUAL` from env
- 7-day trial on subscription
- client_reference_id = userId

### Trial

- Stripe subscription with trial_period_days: 7; no separate trial table

### Webhook

- checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed, invoice.paid
- All update Clerk publicMetadata

### Access

- `SubscriptionGate` (client) — checks summittSubscribed, summittPlan
- Dashboard layout (server) — redirects to /subscribe if not subscribed
- 6-second grace for webhook propagation

### Paywall

- Dashboard, Ask Pat, Film Room, etc. wrapped in SubscriptionGate or layout gate

### Grace / Hydration

- SubscriptionGate: "Finalizing your membership…" up to 6 seconds when both summittSubscribed and plan undefined

### Risk Points

- Webhook delay could block access briefly
- confirm-checkout provides immediate unlock on success page

---

## 11. PERSONALIZATION / MEMORY ENGINE

### What App Remembers

- user_profiles (onboarding)
- daily_summaries (memory atoms)
- weekly_summaries (pattern extraction)
- pattern_insights (confidence-weighted)
- recent_summary (top 2 patterns phrased)

### SMS Memory

- Same; no separate SMS memory

### Summary Generation

- **Daily:** `compressReflectionToMemoryAtom` — deterministic, no LLM
- **Weekly:** `extractWeeklyPatternsFromMemoryAtoms` — LLM (in pattern-extractor)

### Deterministic vs LLM

- Daily: deterministic
- Weekly: LLM extraction

### User Attributes

- Arena, outcome (onboarding) — stored but unclear if actively used in prompt selection
- trainingCampTrack (women vs standard)
- Staleness level (short/medium/long idle) affects tone

### Strong Areas

- Profile → Coach note, Coach reply, Ask Pat
- Summaries → Ask Pat, Coach reply
- Pattern insights → recent_summary → Coach

### Weak

- In-season action selection: `selectInSeasonActionForDay` — deterministic from day number; arena/outcome usage unclear

---

## 12. ADMIN / INTERNAL TOOLS

### Testimonials

- `/admin/testimonials` — testimonials-dashboard
- API: list, update, approve, unapprove

### Feedback

- `feedback_events` — various event types
- `api/admin/weekly-feedback-digest` — friction, churn, promoter seeds, testimonial stories

### Video / Content

- `api/admin/fetch-vimeo-thumbnails` — film_videos

### Analytics

- `api/cron/retention-metrics` — retention_signals, rollups, winback_queue

### Support

- Coach audit: `api/admin/coach-audit` — coach_conversations, coach_pat_daily_notes, sms_send_events

### Override Tools

- Unclear from code; Clerk/Stripe manual changes possible

---

## 13. CODEBASE STRUCTURE MAP

### App Routes

- `/` — home
- `/subscribe`, `/subscribe/success` — checkout
- `/onboarding`, `/onboarding/identity`, `/onboarding/relationships`, `/onboarding/pressure`, `/onboarding/sms`, `/onboarding/complete`
- `/post-sign-in` — router
- `/dashboard`, `/dashboard/day/[day]` — main app
- `/ask-pat`, `/film-room`, `/film-room/[id]`
- `/pulse`, `/rescue`, `/winback`, `/cancel`
- `/admin/testimonials`
- `/sign-in`, `/sign-up`, `/sign-out`

### API Routes

- `api/day/complete` — canonical completion
- `api/journal` — journal GET/POST
- `api/ask-pat`
- `api/stripe/create-checkout-session`, `api/stripe/confirm-checkout`, `api/stripe/webhook`
- `api/onboarding/*` — identity, relationships, pressure, sms, complete
- `api/twilio/inbound`
- `api/cron/daily-sms`, `api/cron/weekly-sms`, `api/cron/challenge`, `api/cron/retention-metrics`, `api/cron/day4-5-sms-pulse`, `api/cron/inactivity-rescue`, `api/cron/post-churn-winback`
- `api/feedback`, `api/feedback/can-prompt`, `api/feedback/state`
- `api/admin/*` — testimonials, coach-audit, weekly-feedback-digest, fetch-vimeo-thumbnails, post-churn-winback-scan
- `api/rescue`, `api/winback`, `api/pause-membership`, `api/cancel-membership`
- `api/sms/pulse-reply`
- `api/daily-summary`, `api/quote-of-the-day`
- `api/challenge/signup`

### Lib

- `complete-day.ts` — canonical completion
- `clerk-rest.ts`, `clerk-public-metadata.ts` — Clerk REST (metadata)
- `resolve-daily-practice.ts` — practice resolution
- `get-or-create-daily-practice-version.ts` — version per day
- `get-or-create-daily-coach-pat-note.ts` — Coach note
- `coach-engine.ts` — Coach reply
- `coach-reply-generator.ts`, `coach-pat-context.ts`
- `profile-context.ts` — profile for AI
- `training-camp-resolver.ts` — Training Camp content
- `in-season-selector.ts`, `in-season-reflection-generator.ts`
- `memory/compress-reflection.ts`, `memory/pattern-extractor.ts`
- `timezone.ts`
- `twilio.ts` — send, chunk, TwiML
- `ask-pat/chunks.ts` — embeddings + similarity

### Middleware

- `middleware.ts` — Clerk; public routes for marketing, webhooks, cron, Twilio

### Admin

- `admin/testimonials/testimonials-dashboard.tsx`
- `api/admin/*`

---

## 14. NON-NEGOTIABLE IMPLEMENTATION TRUTHS

1. **completeDay** (`src/lib/complete-day.ts`) — THE completion function. App and SMS must use it. Do not duplicate.
2. **Clerk metadata** — Use `getClerkPublicMetadata` (REST) and `updateClerkPublicMetadata` (merge + PATCH). Do not use Clerk SDK metadata helpers for writes.
3. **Day match guard** — API must verify `pageDay === currentDay` from Clerk before allowing completion.
4. **daily_completion_events** — Unique (clerk_user_id, day_key) is the completion lock. 23505 = already done.
5. **journal_entries** — Unique (clerk_user_id, day_number). Required for completion. Ask Pat uses ask_pat_questions, NOT journal_entries.
6. **getOrCreateDailyPracticeVersion** — Idempotent, race-safe. Uses upsert on (clerk_user_id, day_key). Do not use maybeSingle for existence.
7. **getOrCreateDailyCoachPatNote** — Same for Coach note. App and SMS must use this only.
8. **resolveDailyPracticeForUser** — Past days from daily_prompts; today from getOrCreateDailyPracticeVersion.
9. **Timezone** — All calendar logic via `resolveUserTimezone`, `getDateKeyInTimezone`. Default America/New_York.
10. **Stripe webhook** — Canonical for subscription. confirm-checkout is sync bridge; do not rely on it alone for long-term state.
11. **SMS opt-out** — sms_identities is canonical; STOP updates both Supabase and Clerk.
12. **compressReflectionToMemoryAtom** — Deterministic, no LLM. Produces coach-safe atoms. Do not leak raw journal phrasing.

---

## 15. SCALABILITY / RETENTION RISKS

### Retention / Product

- Staleness detection exists but re-engagement flows (rescue, winback) are partial
- Weekly summary depends on week boundaries; edge cases possible
- In-season content may feel repetitive (deterministic by day)

### Architecture / Data

- `listClerkUsers` scans all users every 5 min; 2,500 users = 13+ pages of 200
- No cursor/checkpoint for cron; stateless scan
- Clerk rate limits on user list
- Supabase: many queries per user in daily-sms loop

### SMS

- Twilio cost and rate limits at 2,500 users
- Single cron run processes all users; no sharding
- Retry logic exists (3 attempts) but no backoff

### AI Cost

- Coach note + Coach reply + Ask Pat + In-season reflection = multiple OpenAI calls per user per day
- No caching of Coach note across refreshes (stored in DB)
- Ask Pat: embedding + completion per question

### Operational

- Admin tools are basic
- No visible alerting/monitoring
- Webhook failure = stale metadata until manual fix

### Code Quality

- `isSubscribedFromMetadata` duplicated in 6+ files
- Some error handling returns 200 with domain errors (intentional but easy to misuse)

---

## 16. WHAT IS ALREADY GOOD / STRONG

1. **App/SMS parity** — Shared completion, practice version, Coach note; no divergent logic
2. **Completion lock** — Unique constraint prevents double completion
3. **Clerk REST for metadata** — Avoids SDK quirks at scale
4. **Deterministic memory** — compressReflectionToMemoryAtom is safe and fast
5. **Profile-driven AI** — Strong use of onboarding for Coach note, Coach reply, Ask Pat
6. **Training Camp structure** — Clear 30-day phase, then In-Season
7. **Staleness awareness** — getUserStalenessLevel influences tone
8. **SMS compliance** — STOP/START/HELP, disclosure
9. **Timezone handling** — Consistent use of user TZ
10. **Canonical functions** — Well-named, single responsibility

---

## 17. WHAT IS FRAGILE / CONFUSING / UNCLEAR

1. **isSubscribedFromMetadata** — Duplicated; should be shared
2. **ensure-daily-prompt** — Role unclear; possibly legacy
3. **trainingCampTrack** — "women" content resolution path; completeness unclear
4. **Week key vs week_start_day** — weekly-sms uses getWeekKey; weekly_summaries uses week_start_day
5. **Arena / outcome** — Stored in onboarding; usage in in-season selection unclear
6. **afternoon/evening** in smsTimePreference — Legacy, not in SEND_HOUR_BY_PREFERENCE
7. **daily_prompts vs daily_prompt_versions** — Both exist; daily_prompts archived on completion
8. **SubscriptionGate grace** — 6 seconds hardcoded; may need tuning
9. **Pat library file** — pat_library_with_embeddings.jsonl; must exist at runtime

---

## 18. TOP 25 FACTS CHATGPT SHOULD REMEMBER

1. **completeDay** in `src/lib/complete-day.ts` is the ONLY completion logic. App and SMS both call it with source "app" or "sms".
2. Clerk metadata must be read via `getClerkPublicMetadata` (REST) and written via `updateClerkPublicMetadata` (merge).
3. Subscription truth: Clerk `summittSubscribed` and `summittPlan`; updated by Stripe webhook and confirm-checkout.
4. Progression: Clerk `currentDay` is the single source of truth. Incremented only by completeDay.
5. `daily_completion_events` has unique (clerk_user_id, day_key). Insert fails with 23505 if already completed.
6. Journal is required for completion. Stored in `journal_entries` (clerk_user_id, day_number).
7. `getOrCreateDailyPracticeVersion` uses upsert on (clerk_user_id, day_key). Idempotent and race-safe.
8. `getOrCreateDailyCoachPatNote` is the ONLY way to get the daily Coach note. Used by app and SMS cron.
9. Past days load from `daily_prompts`; today loads from `getOrCreateDailyPracticeVersion` → `daily_prompt_versions`.
10. Days 1–30: Training Camp from `film_videos` or `training_camp_non_video_days`. Days 31+: In-Season with LLM reflection.
11. SMS cron runs every 5 min. Send window: 6/8/10am local (5 min). One send per user per day via sms_send_events reservation.
12. Twilio inbound: STOP/START/HELP handled; otherwise journal upsert + completeDay + coachEngine.
13. coachEngine rate limit: 20 per UTC day (coach_reply_usage). Ask Pat: 10 per day (ask_pat_usage).
14. Onboarding order: subscribe → identity → relationships → pressure → sms → complete. Complete sets currentDay: 1.
15. Post-sign-in: `/post-sign-in` redirects to onboarding, subscribe, or dashboard/day/[currentDay].
16. Timezone default: America/New_York. Stored in Clerk, used by timezone.ts helpers.
17. compressReflectionToMemoryAtom is deterministic. No LLM. Produces coach-safe one-sentence atoms.
18. Weekly summary: when day % 7 === 0. extractWeeklyPatternsFromMemoryAtoms → pattern_insights, weekly_summaries, recent_summary.
19. Ask Pat uses embeddings from pat_library_with_embeddings.jsonl + cosine similarity. Top 6 chunks.
20. sms_identities is canonical for opt-out. STOP updates Supabase and Clerk.
21. Stripe checkout: client_reference_id = userId. 7-day trial. confirm-checkout sync-unlocks.
22. SubscriptionGate has 6-second grace when summittSubscribed and plan both undefined.
23. Feedback prompts: day 7 (NPS), day 14 (PMF), day 30 (testimonial). Guarded by can-prompt API.
24. trainingCampTrack: "women" | "standard". Affects film_videos and training_camp_non_video_days lookup.
25. listClerkUsers pagination: 200 default, 500 max. Daily-sms scans all users; no cursor.
