# Tyler Text Overview — Deployment Checklist

Read-only ops runbook for launching Tyler Text Overview MVP (Phases 1–6A).

**Single feature env var:** `TYLER_TEXT_OVERVIEW_ENABLED` (must be `"true"` to activate generation, admin runtime, 7AM draft overlay, and stale refresh sweeps).

**Source of truth for schema DDL:** `supabase/migrations/20260701120000_tyler_text_overview.sql` — do not copy DDL into this checklist; apply that file in Supabase.

---

## 1. Pre-push local checks

Run from repo root:

```bash
git status
git log origin/main..HEAD
```

Confirm only Tyler Text Overview vertical-slice commits are ahead of `origin/main`.

### Tests

```bash
npx vitest run src/lib/tyler-text-overview-schema.test.ts
npx vitest run src/lib/tyler-text-overview-draft-side-effects.test.ts
npx vitest run src/lib/tyler-text-overview-generate.test.ts
npx vitest run src/lib/tyler-text-overview-admin.test.ts
npx vitest run src/lib/tyler-text-overview-send.test.ts
npx vitest run src/lib/tyler-text-overview-refresh-stale.test.ts
npx vitest run src/lib/tyler-text-overview-sql-artifacts.test.ts
npm run build
```

### Static grep checks

```bash
# Only one TTO feature env var in product code
rg 'TYLER_TEXT_OVERVIEW_[A-Z_]+' src --glob '*tyler-text-overview*'
# Expect: TYLER_TEXT_OVERVIEW_ENABLED only (plus CRON_SECRET on cron routes)

# No vercel schedule for TTO yet
rg 'tyler-text-overview-generate|tyler-text-overview-refresh' vercel.json
# Expect: no matches

# sendSMS should remain on daily route only (not in stale refresh lib)
rg 'sendSMS' src/lib/tyler-text-overview-refresh-stale.ts
# Expect: no matches

# Admin DTO must not expose phone
rg 'phone_number' src/lib/tyler-text-overview-admin.ts src/app/admin/tyler-text-overview
# Expect: no matches in admin DTO paths

# No review workflow fields in TTO scope
rg 'review_reason|review_notes|reviewed_by' src --glob '*tyler-text-overview*'
# Expect: no matches

# Send metadata must not embed writer_openai_messages
rg 'writer_openai_messages' src/lib/tyler-text-overview-send.ts
# Expect: no writes to sms_send_events metadata
```

---

## 2. Manual Supabase Step 1 — Apply TTO schema

Cursor cannot apply Supabase changes. Tyler must run migration manually.

1. Open **Supabase → SQL Editor**.
2. Open repo file: `supabase/migrations/20260701120000_tyler_text_overview.sql`
3. Copy the **entire file contents**.
4. Paste into Supabase SQL Editor and **Run**.
5. Confirm success (creates `sms_daily_draft_generations` and `sms_daily_drafts`).

### Manual Supabase Step 2 — Verify schema

1. Open repo file: `supabase/manual/tyler_text_overview_post_migration_verification.sql`
2. Copy entire file and **Run** in Supabase SQL Editor.
3. Review all `TTO_VERIFY_*` blocks.
4. **Healthy:** `TTO_VERIFY_10_summary` shows `failed_checks = 0` and `recommendation = READY_FOR_ENV_ENABLE`.
5. **Do not set `TYLER_TEXT_OVERVIEW_ENABLED=true` until verification passes.**

---

## 3. Push / deploy

1. **One git push** of the full local vertical slice (Phases 1–6A + Phase 7 ops artifacts).
2. Wait for **Vercel deploy green**.
3. Set **`TYLER_TEXT_OVERVIEW_ENABLED=false`** on the new deployment (initial deploy).

---

## 4. Env progression (manual smoke)

Replace `https://<host>` with production/staging host.

### Step A — env false no-op

With `TYLER_TEXT_OVERVIEW_ENABLED=false`:

```bash
curl -sS -H "x-cron-secret: $CRON_SECRET" \
  "https://<host>/api/cron/tyler-text-overview-generate" | jq .
```

**Expected:** `enabled: false`, no draft rows created.

### Step B — enable env

Set **`TYLER_TEXT_OVERVIEW_ENABLED=true`** in Vercel env and redeploy (or wait for env propagation).

### Step C — manual noon generation

```bash
curl -sS -H "x-cron-secret: $CRON_SECRET" \
  "https://<host>/api/cron/tyler-text-overview-generate" | jq .
```

**Expected:** `generation_inserted > 0`, rows in both draft tables.

### Step D — admin review

1. Open `/admin/tyler-text-overview` as Tyler admin.
2. Confirm rows show: **Clerk ID**, editable body, exact `writerOpenAiMessages`.
3. Edit one draft and save.
4. Confirm only `sms_daily_drafts` changed (`edited_by_tyler=true`); generation rows immutable.

### Step E — stale refresh (manual)

Evening sweep:

```bash
curl -sS -H "x-cron-secret: $CRON_SECRET" \
  "https://<host>/api/cron/tyler-text-overview-refresh-stale?reason=evening_sweep" | jq .
```

Pre-send stale refresh:

```bash
curl -sS -H "x-cron-secret: $CRON_SECRET" \
  "https://<host>/api/cron/tyler-text-overview-refresh-stale?reason=pre_send_stale_refresh" | jq .
```

**Expected:** JSON stats only — **no SMS sent**, no Twilio activity from these routes.

### Step F — command center SQL

1. Open `supabase/manual/tyler_text_overview_command_center.sql`
2. Set `target_day_key` in each block's `params` CTE.
3. Run blocks in Supabase SQL Editor (start with `TTO_01`, `TTO_03`, `TTO_08`).

### Step G — 7AM production

- **Preferred:** wait for natural 7AM daily-sms cron with env on.
- **Optional:** controlled single-user test only if explicitly safe.
- Monitor `sms_send_events.metadata.tyler_text_overview` after send window.

---

## 5. Manual curl reference

```bash
# Noon / batch generation
curl -H "x-cron-secret: $CRON_SECRET" \
  "https://<host>/api/cron/tyler-text-overview-generate"

# Stale refresh — evening sweep (default reason)
curl -H "x-cron-secret: $CRON_SECRET" \
  "https://<host>/api/cron/tyler-text-overview-refresh-stale?reason=evening_sweep"

# Stale refresh — pre-send
curl -H "x-cron-secret: $CRON_SECRET" \
  "https://<host>/api/cron/tyler-text-overview-refresh-stale?reason=pre_send_stale_refresh"
```

Bearer auth also works if configured: `-H "Authorization: Bearer $CRON_SECRET"`.

---

## 6. Rollback

If anything looks wrong:

1. Set **`TYLER_TEXT_OVERVIEW_ENABLED=false`** in Vercel.
2. Redeploy or wait for env propagation.
3. Existing **daily-sms route** resumes prior live path (no draft overlay).
4. Draft tables remain harmless; **no migration rollback required**.
5. Admin page becomes inert for draft send path when env off.

---

## 7. Vercel cron schedules

**Do NOT add `vercel.json` schedules for first smoke.** Manual curl invoke first.

After first successful manual smoke (generate → admin edit → stale refresh → one 7AM window):

Consider adding schedules in a **follow-up deploy** (not first push):

| Route | Suggested purpose | Notes |
|-------|-------------------|-------|
| `/api/cron/tyler-text-overview-generate` | ~noon ET batch | UTC cron must account for **DST** |
| `/api/cron/tyler-text-overview-refresh-stale?reason=evening_sweep` | ~7PM ET sweep | Query string in path may work on Vercel; test manually first |
| `/api/cron/tyler-text-overview-refresh-stale?reason=pre_send_stale_refresh` | ~6:30AM ET pre-send | DST-sensitive |

Existing `daily-sms` cron remains the **only send path** (`*/5 * * * *` in repo today).

When env is `false`, TTO crons no-op safely even if scheduled later.

---

## 8. What to send ChatGPT after first run

Export Supabase results (CSV or paste) for:

- **TTO_01** — executive scorecard
- **TTO_04** — Tyler edits
- **TTO_08** — 7AM send reconciliation
- **TTO_11** — detail for ChatGPT review

Optional: **TTO_07** (stale inbound), **TTO_09** (send_source breakdown), **TTO_10** (unsent current).

Do not paste phone numbers (SQL pack excludes them by design).

---

## 9. Launch sequence summary

1. Pre-push tests + build green locally
2. **Manual Supabase:** apply Phase 1 migration file
3. **Manual Supabase:** run post-migration verification SQL
4. Push once; Vercel green; **env false**
5. Manual generate no-op test (env false)
6. **env true** → manual generate → admin edit → manual stale refresh
7. Run command center SQL
8. Monitor 7AM send metadata
9. Add Vercel crons only after soak (optional follow-up deploy)
