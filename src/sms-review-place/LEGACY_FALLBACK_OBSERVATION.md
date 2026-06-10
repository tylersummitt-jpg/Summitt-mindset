# Legacy Fallback — Production Observation Checklist (Phase 4.6a)

Read-only operator guide for **`conversation_brain_unavailable`** / **`conversation_brain_legacy_disabled_lane`**. This branch is **not** Strategy Card consolidated. No SQL execution required here.

## When this branch runs

**Trigger (inbound route):**

```text
conversationBrainControlTurn == null
&& !isV2SmsConversationBrainLegacyFallbackEnabled()
```

**Env gates (`src/lib/v2-sms-conversation-brain.ts`):**

| Variable | Default | Effect |
|----------|---------|--------|
| `V2_SMS_CONVERSATION_BRAIN_LEGACY_FALLBACK_ENABLED` | **enabled** unless `"false"` or `"0"` | When enabled, this branch is **skipped**; main `normal_inbound_reply` hallway runs |
| `V2_SMS_CONVERSATION_BRAIN_CONTROL_ENABLED` | off unless `"true"` | Conversation brain control turn usually null |

**Meaning:** Under default env, this is a **migration / degraded-mode writer path**, not the default inbound hallway. Do **not** flip `V2_SMS_CONVERSATION_BRAIN_LEGACY_FALLBACK_ENABLED=false` without an explicit plan.

## Route identity

| Field | Value |
|-------|-------|
| `route_purpose` | `conversation_brain_unavailable` |
| `branch_name` | `conversation_brain_legacy_disabled_lane` |
| Strategy Card | **Not wired** — `conversation_brain_fallback_facts` blocks all Strategy Card eligibility |

## What to monitor

### Volume (does it run?)

- `route_purpose = conversation_brain_unavailable`
- `branch_name = conversation_brain_legacy_disabled_lane`
- `conversation_brain_fallback_facts_summary` (slim telemetry — preview length, not full text)

**Illustrative read-only SQL** (adapt table/column names to your observability store):

```sql
-- Example only — do not run from this repo
SELECT
  DATE_TRUNC('day', created_at) AS day,
  COUNT(*) AS turns
FROM inbound_coach_lane_events
WHERE route_purpose = 'conversation_brain_unavailable'
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1 DESC;
```

### No-send rates (is it safe?)

Watch structured no-send reasons:

- `conversation_brain_legacy_disabled_lane_no_send` (lane)
- `conversation_brain_legacy_fallback_disabled_final_voice_no_send` (final voice gate)
- `legacy_fallback_final_voice_suppressed` (log)
- `legacy_fallback_final_body_guard_blocked` (unified final guard)

### TU vs fallback authority

- `conversation_brain_fallback_suppressed_by_turn_understanding = true` when authoritative TU overrides fallback `suggested_coaching_move`

### Product law

- Final SMS must **not** quote `deterministic_template_preview` from fallback facts
- No internal route labels in user-facing copy
- Final guard still runs on send path

## SMS Review Place regression

Mocked legacy fallback scenarios (metadata / product-law only — not exact SMS copy):

```bash
npx vitest run src/sms-review-place/legacy-fallback-scenarios.test.ts
npx vitest run src/sms-review-place/legacy-fallback-validators.test.ts
```

## Decision framework (Phase 4.6 audit)

| If volume is… | Consider… |
|---------------|-----------|
| Zero / negligible under default env | **Leave as-is (Option B)** — dormant but guarded |
| Non-zero with `LEGACY_FALLBACK_ENABLED=false` | **Review Place green + telemetry** → then Strategy Card (Option C) or keep minimal |
| Non-zero with errors | Fix guards first; do not retire without replacement |

## Out of scope (Phase 4.6a)

- Strategy Card for `conversation_brain_unavailable`
- Retiring the branch
- Env gate changes
- Routing / persistence / send / final guard internals
