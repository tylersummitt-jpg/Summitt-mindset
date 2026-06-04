# SMS Review Place (Sim-1)

Internal SMS testing and review harness for **Summitt Mindset SMS**. This is not Film Room (Film Room is the member-facing video product).

## What Sim-1 does

Runs curated **fake relationship scenarios** through the same safe production seams used for V3 coaching SMS:

1. V3 relationship lane (`produceDailyV3RelationshipSms` / `produceInboundV3RelationshipSms`)
2. North Star finalizer (deterministic for V3 relationship sources)
3. Final Voice Gate
4. Deterministic validators
5. Local **JSONL + Markdown** reports

## Two modes

### Mocked mode (regression / safety)

- Deterministic OpenAI responses via `vi.mock("openai")`
- Fast, repeatable, CI-safe
- Use for guards and scenario pass/fail regression

### Real OpenAI dry-run (product voice review)

- **Live OpenAI** inside production V3 lane / repair / FVG code paths
- Still **fake users only** (`sim_*` personas)
- Still **no Twilio**, **no DB writes**, **no cron**, **no production replay**
- Manual/local only — skipped unless you set `SMS_REVIEW_REAL_OPENAI=1`
- **Never run in CI**

North Star OpenAI finalizer remains **disabled for V3** in production (same as prod); real calls are primarily lane generation and repair loops.

## What Sim-1 does NOT do

- Send real SMS (no Twilio)
- Write to Supabase (no production DB)
- Call cron routes (`daily-sms`, `sms-inbound-coach`, `weekly-sms`)
- Use `SMS_DRY_RUN` on crons (still touches `sms_send_events`)
- Load operator QA or production transcripts
- Mutate users, billing, STOP/HELP/START, crisis state, or proof
- Use production users or phone numbers

## Commands — mocked mode

```bash
npx vitest run src/sms-review-place/guards/no-side-effects.test.ts
npx vitest run src/sms-review-place/run-review.test.ts
```

Optional filters:

```bash
SMS_REVIEW_SCENARIO=time-ref-yesterday npx vitest run src/sms-review-place/run-review.test.ts
SMS_REVIEW_PERSONA=alex npx vitest run src/sms-review-place/run-review.test.ts
SMS_REVIEW_SKIP_REPORT=1 npx vitest run src/sms-review-place/run-review.test.ts
```

## Commands — real OpenAI dry-run

**Start with one scenario.** Read the generated report under `sms-review-place/reports-real-openai/`.

```bash
SMS_REVIEW_REAL_OPENAI=1 \
SMS_REVIEW_ACK_NETWORK=1 \
SMS_REVIEW_ACK_FAKE_USERS_ONLY=1 \
SMS_REVIEW_SCENARIO=blocker-heavy \
OPENAI_API_KEY="$OPENAI_API_KEY" \
npx vitest run src/sms-review-place/run-review-real-openai.test.ts
```

### Real OpenAI env vars

| Variable | Required | Purpose |
|----------|----------|---------|
| `SMS_REVIEW_REAL_OPENAI` | `1` | Master enable |
| `SMS_REVIEW_ACK_NETWORK` | `1` | Acknowledge live API calls |
| `SMS_REVIEW_ACK_FAKE_USERS_ONLY` | `1` | Acknowledge fake `sim_*` users only |
| `OPENAI_API_KEY` | real key | Not `sim-mock-key-not-real` |
| `SMS_REVIEW_SCENARIO` | recommended | One scenario id (e.g. `blocker-heavy`) |
| `SMS_REVIEW_ALL` | optional | Run voice-review scenario set |
| `SMS_REVIEW_ACK_COST` | with `ALL=1` | Acknowledge multi-step API cost |
| `SMS_REVIEW_LIMIT` | optional | Cap steps (default max 3 without ALL) |
| `SMS_REVIEW_PERSONA` | optional | Filter by persona |
| `SMS_REVIEW_INCLUDE_CLASSIFIER` | optional | Include classifier-only scenarios (no OpenAI) |

**Blocked in real mode:** `warm-praise-overuse`, `repeated-question-risk`, `proof-victory-forbidden` (mock-negative fixtures).

**Do not** set `SMS_REVIEW_REAL_OPENAI=1` in CI or production `NODE_ENV`.

## Reports

| Mode | Path |
|------|------|
| Mock | `sms-review-place/reports/<timestamp>/` |
| Real OpenAI | `sms-review-place/reports-real-openai/<timestamp>/` |

Each run writes `run.jsonl`, `summary.json`, and `report.md`. Both folders are gitignored.

## Safety

See `guards/no-side-effects.test.ts` for forbidden import checks.
