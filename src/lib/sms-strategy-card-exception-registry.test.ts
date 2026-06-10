import { describe, expect, it } from "vitest";

import type { StrategyCardRouteKind } from "@/lib/coaching-strategy-card-v1";
import {
  ACTIVE_STRATEGY_CARD_ROUTE_KINDS,
  findStrategyCardExceptionByRouteIdentifier,
  isActiveStrategyCardRouteKind,
  SMS_STRATEGY_CARD_EXCEPTIONS,
} from "@/lib/sms-strategy-card-exception-registry";

const ACTIVE_CARD_SET = new Set<string>(ACTIVE_STRATEGY_CARD_ROUTE_KINDS);

describe("SMS Strategy Card exception registry (Phase 4.9a)", () => {
  it("active Strategy Card route kinds are not listed as exceptions (except dual-purpose lane ids)", () => {
    const dualPurposeLaneRouteIds = new Set([
      "pending_resolution",
      "refresh_identity",
      "refresh_commitment",
      "refresh",
    ]);
    const exceptionRoutes = new Set(
      SMS_STRATEGY_CARD_EXCEPTIONS.flatMap((e) => e.route_identifiers)
    );
    for (const kind of ACTIVE_STRATEGY_CARD_ROUTE_KINDS) {
      if (dualPurposeLaneRouteIds.has(kind)) continue;
      expect(exceptionRoutes.has(kind)).toBe(false);
    }
  });

  it("conversation_brain_unavailable is documented but not an active card route kind", () => {
    expect(isActiveStrategyCardRouteKind("conversation_brain_unavailable")).toBe(false);
    expect(findStrategyCardExceptionByRouteIdentifier("conversation_brain_unavailable")).toBeDefined();
  });

  it("guided_shrink_contract_prompt is documented but not an active card route kind", () => {
    expect(isActiveStrategyCardRouteKind("guided_shrink_contract_prompt")).toBe(false);
    expect(findStrategyCardExceptionByRouteIdentifier("guided_shrink_contract_prompt")).toBeDefined();
  });

  it("weekly legacy deprecated routes are documented", () => {
    expect(findStrategyCardExceptionByRouteIdentifier("weekly_legacy_reflection")).toBeDefined();
    expect(findStrategyCardExceptionByRouteIdentifier("weekly_legacy_fallback_summary")).toBeDefined();
  });

  it("hard routes are documented as never-card", () => {
    const hard = SMS_STRATEGY_CARD_EXCEPTIONS.filter(
      (e) => e.classification === "hard_route_deterministic"
    );
    expect(hard.length).toBeGreaterThanOrEqual(5);
    for (const entry of hard) {
      expect(entry.disposition).toBe("never_strategy_card");
      expect(entry.reason.length).toBeGreaterThan(10);
      expect(entry.action.toLowerCase()).toContain("never");
    }
  });

  it("transactional state-machine routes are documented", () => {
    const txn = SMS_STRATEGY_CARD_EXCEPTIONS.filter(
      (e) => e.classification === "state_machine_transactional"
    );
    expect(txn.map((e) => e.route_identifiers).flat()).toContain("blocker_capture_ack");
    expect(txn.map((e) => e.route_identifiers).flat()).toContain("central_brain_blocker_pivot");
    expect(txn.map((e) => e.route_identifiers).flat()).toContain("memory_confirmation");
    expect(txn.map((e) => e.route_identifiers).flat()).toContain("adaptive_proposal_consent_clarification");
    expect(txn.map((e) => e.route_identifiers).flat()).toContain("commitment_change_handoff");
  });

  it("every exception has owner, disposition, and reason", () => {
    for (const entry of SMS_STRATEGY_CARD_EXCEPTIONS) {
      expect(entry.owner).toBe("sms-platform");
      expect(entry.disposition).toBeTruthy();
      expect(entry.reason.trim().length).toBeGreaterThan(10);
      expect(entry.action.trim().length).toBeGreaterThan(5);
      expect(entry.route_identifiers.length).toBeGreaterThan(0);
    }
  });

  it("no exception route identifier collides with active Strategy Card kinds (except dual-purpose lane ids)", () => {
    /** Same route_purpose string on inbound txn vs outbound daily card — documented in registry reason. */
    const dualPurposeLaneRouteIds = new Set([
      "pending_resolution",
      "refresh_identity",
      "refresh_commitment",
      "refresh",
    ]);
    for (const entry of SMS_STRATEGY_CARD_EXCEPTIONS) {
      for (const routeId of entry.route_identifiers) {
        if (dualPurposeLaneRouteIds.has(routeId)) continue;
        if (ACTIVE_CARD_SET.has(routeId)) {
          throw new Error(`exception ${entry.id} overlaps active card kind ${routeId}`);
        }
      }
    }
  });

  it("active card kinds match StrategyCardRouteKind union members used in production", () => {
    const expected: StrategyCardRouteKind[] = [
      "normal_inbound_reply",
      "open_question_answer",
      "arc_clarify_ambiguous_short",
      "central_brain_pivot",
      "main_active_accountability",
      "low_pressure_reactivation",
      "contract_prompt",
      "pending_resolution",
      "refresh_identity",
      "refresh_commitment",
      "weekly_proof_v2",
    ];
    expect([...ACTIVE_STRATEGY_CARD_ROUTE_KINDS].sort()).toEqual([...expected].sort());
  });
});
