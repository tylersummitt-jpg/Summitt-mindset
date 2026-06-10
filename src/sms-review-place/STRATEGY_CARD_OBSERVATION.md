# Strategy Card v1 — Production Observation Checklist (Phase 4.2)

Read-only operator guide for **inbound normal** Strategy Card telemetry. No SQL execution required here; use your existing lane / packet observability tables or logs that already carry `strategy_card_*` keys from `RELATIONSHIP_PACKET_OBSERVABILITY_KEYS`.

## What to watch (daily / weekly review)

### Card shape & validation

| Field | What healthy looks like | Red flags |
|-------|-------------------------|-----------|
| `strategy_card_move_type` | Distribution matches turn mix (miss → `ask_blocker`/`recover_today`; wins → `ack_completion`; plan ack → `protect_existing_plan`/`close_loop`) | Sudden spike in `propose_adjustment`, `evaluate_commitment`, or `raise_standard` on single-miss turns |
| `strategy_card_validation_status` | Mostly `valid`; occasional `repaired` | Sustained `repaired` > ~15% or new validation reason clusters |
| `strategy_card_validation_reasons` | Short, stable reason codes | New repeating reasons after deploy |
| `strategy_card_legacy_hint_used` | Some true early (legacy hints still in packet) | Hint used but move contradicts server truth |
| `strategy_card_legacy_hint_replaced` | Repairs replacing bad legacy moves | High replace rate + wrong final SMS themes |

### Plan acknowledgment (SACA / TU / intent)

| Field | Notes |
|-------|-------|
| `strategy_card_plan_ack_source` | `saca` = short-answer context; `tu` = turn understanding; `sms_intent` = inbound meaning; `none` = not a plan ack turn |
| Plan ack turns | Expect `strategy_card_move_type` ∈ `{ protect_existing_plan, close_loop }` |
| Plan ack claims | `strategy_card_can_claim_proof` / completion claims should stay false unless independent server truth |

### Single miss

- Expect `strategy_card_move_type` ∈ `{ ask_blocker, recover_today }`
- Forbidden on single miss: `propose_adjustment`, `evaluate_commitment`, `raise_standard`
- `strategy_card_can_claim_proof` / `strategy_card_can_reference_victory_room` should be false

### Final guard after card

- Compare lane no-send vs final no-send rates (final guard / FVG / product law unchanged by card)
- Card active + final no-send is OK when guard blocks copy — watch for **new** reason clusters tied to card moves

### Proof / Victory

- When `strategy_card_can_claim_proof=false`, final SMS should not claim saved proof or Victory Room (existing hard flags in Review Place)

## Suggested slices

1. **Move distribution** — `strategy_card_move_type` × `route_purpose=normal_inbound_reply`
2. **Validation health** — `strategy_card_validation_status`, top `strategy_card_validation_reasons`
3. **Plan ack source** — `strategy_card_plan_ack_source` where move ∈ plan-ack moves
4. **Legacy hint** — rates of `strategy_card_legacy_hint_used` vs `strategy_card_legacy_hint_replaced`
5. **Repaired → no-send** — rows where card repaired then final guard no-send

## SMS Review Place regression

Run mocked Sim-1 strategy card scenarios:

```bash
SMS_REVIEW_SCENARIO=strategy-card-single-miss npx vitest run src/sms-review-place/run-review.test.ts
npx vitest run src/sms-review-place/strategy-card-validators.test.ts
npx vitest run src/sms-review-place/strategy-card-scope.test.ts
```

All eight `strategy-card-*` scenarios assert **card metadata and invariants**, not exact final SMS copy.

## Phase 4.9a — production soak window (1–2 weeks)

**Allowed during soak:** packet dual-authority cleanup (`strategy_card_packet_writer_hints_stripped`), signed exception registry docs/tests.

**Not allowed during soak:** new Strategy Card surfaces unless **P0** user-facing bug.

### Fields to watch

| Area | Fields / signals |
|------|------------------|
| Card shape | `strategy_card_surface`, `strategy_card_route_kind`, `strategy_card_move_type`, `strategy_card_validation_status`, `strategy_card_validation_reasons` |
| Packet cleanup | `strategy_card_packet_writer_hints_stripped`, `strategy_card_packet_stripped_fields` |
| Final guard | Unified final guard no-send rate, blocked reason clusters, `unified_final_guard_mode` |
| Lane no-send | `no_send_reason`, `lane_stage` by surface (daily / inbound / weekly) |
| Legacy fallback | `route_purpose=conversation_brain_unavailable`, `branch_name=conversation_brain_legacy_disabled_lane` volume |
| Guided shrink | `guided_shrink_contract_prompt`, `guided_contract_proposal` no-send / rollback |
| Transactional inbound | Contract consent, memory, pending inbound, adaptive clarify no-send rates |
| Quality | User-reported embarrassing SMS; repeated-question reports |

### Soak success criteria (informal)

- No sustained spike in final-guard no-sends on card-active routes after packet strip deploy
- `strategy_card_packet_writer_hints_stripped` present on card-active sends without new wrong-move themes
- Legacy fallback volume remains near zero under default env
- No P0 “writer followed packet suggested_move instead of card” incidents

### Exception registry

Intentional non-card surfaces are listed in `src/lib/sms-strategy-card-exception-registry.ts` (signed registry, test-guarded).

## Consolidated surfaces (reference)

Strategy Card is active for: inbound normal / open question / arc clarify / central pivot; all daily route kinds; `weekly_proof_v2`.

## Related: legacy fallback (not Strategy Card)

See [LEGACY_FALLBACK_OBSERVATION.md](./LEGACY_FALLBACK_OBSERVATION.md) for `conversation_brain_unavailable` / `conversation_brain_legacy_disabled_lane` telemetry and Review Place coverage (Phase 4.6a). That branch is intentionally **not** Strategy Card consolidated.
