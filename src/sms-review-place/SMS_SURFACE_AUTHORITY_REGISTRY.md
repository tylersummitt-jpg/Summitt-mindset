# SMS Surface Authority Registry (Phase 4.9b)

Executable consolidation guard: every visible SMS surface is classified as **exactly one** authority type. Test-backed; not imported by production routing.

## What “100% consolidated while safe” means

- **Consolidated:** All relationship coaching surfaces that should use Strategy Card are wired and packet dual-authority is cleaned up.
- **Safe:** Intentional non-card surfaces (transactional inbound, hard routes, guided shrink, legacy fallback) are **signed**, not forgotten.
- **Executable:** Adding a new `route_purpose` / `route_kind` in production source without a registry entry **fails CI**.

## Authority classifications

| Classification | Meaning |
|----------------|---------|
| `active_strategy_card_surface` | Strategy Card is primary writer move authority + final guard |
| `state_machine_transactional_exception` | Server state machine owns move; no Strategy Card |
| `hard_route_deterministic_exception` | Compliance/safety/opt-out; never Strategy Card |
| `app_driven_constrained_exception` | App-triggered constrained send (e.g. guided shrink) |
| `deferred_env_gated_exception` | Env-gated degraded mode (legacy fallback) |
| `deprecated_no_visible_sms` | Cron/branch retained but no Twilio visible send |
| `suppressed_no_visible_sms` | Tapback/suppressed; no visible coaching SMS |

## Active Strategy Card surfaces (11)

**Inbound:** `normal_inbound_reply`, `open_question_answer`, `arc_clarify_ambiguous_short`, `central_brain_pivot`

**Daily:** `main_active_accountability`, `low_pressure_reactivation`, `contract_prompt`, `pending_resolution`, `refresh_identity`, `refresh_commitment`

**Weekly:** `weekly_proof_v2`

## Intentional exceptions (not forgotten)

See `src/lib/sms-surface-authority-registry.ts` for the full signed list including:

- Hard routes: STOP, HELP, START, crisis/safety, onboarding consent, tapbacks/suppressed, soft opt-out, compliance footer
- Transactional inbound: blocker ack, central brain blocker pivot, memory, pending inbound, contract consent, adaptive clarify, handoff, refresh inbound, identity edit, relationship exit, commitment change context
- Deferred: `conversation_brain_unavailable`
- App-driven: `guided_shrink_contract_prompt`
- Deprecated: weekly legacy, legacy daily crons (followup, missed-yesterday, inactivity-rescue, post-churn-winback)

Dual-purpose route ids (`pending_resolution`, `refresh_identity`, `refresh_commitment`, `refresh`) appear on **both** outbound daily Strategy Card entries and inbound transactional exception entries.

## Rule for adding any new SMS surface

1. Choose Strategy Card **or** an exception classification (never leave unclassified).
2. Add an entry to `SMS_SURFACE_AUTHORITY_REGISTRY` in `src/lib/sms-surface-authority-registry.ts`.
3. Add/extend tests in `src/lib/sms-surface-authority-registry.test.ts`.
4. Define `final_guard_mode` and `send_caller_files`.
5. Define telemetry fields to watch.

## Tests

```bash
npx vitest run src/lib/sms-surface-authority-registry.test.ts
npx vitest run src/lib/sms-strategy-card-exception-registry.test.ts
npx vitest run src/lib/phase4-sms-send-surface-governance.test.ts
```

## Related

- Phase 4.9a exception registry (legacy export): `src/lib/sms-strategy-card-exception-registry.ts` — derived from authority registry.
- Production soak: [STRATEGY_CARD_OBSERVATION.md](./STRATEGY_CARD_OBSERVATION.md)
