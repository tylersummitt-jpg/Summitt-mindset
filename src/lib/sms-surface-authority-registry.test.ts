/**
 * Phase 4.9b — executable SMS surface authority registry gates.
 * No production behavior changes; fails when a new visible route is unclassified.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { StrategyCardRouteKind } from "@/lib/coaching-strategy-card-v1";
import {
  PRODUCTION_SMS_SEND_CALLER_ALLOWLIST,
} from "@/lib/phase4-sms-send-surface-governance.test";
import {
  ACTIVE_STRATEGY_CARD_ROUTE_KINDS,
  allSurfaceAuthorityRouteIdentifiers,
  extractSmsRouteLiteralsFromSource,
  findSurfaceAuthorityEntriesByRouteIdentifier,
  INBOUND_V3_ROUTE_PURPOSES,
  isActiveStrategyCardSurfaceRoute,
  isRouteIdentifierClassified,
  SMS_SURFACE_AUTHORITY_DUAL_PURPOSE_ROUTE_IDS,
  SMS_SURFACE_AUTHORITY_REGISTRY,
  SMS_SURFACE_AUTHORITY_SOURCE_FILES,
  SMS_SURFACE_REQUIRED_ROUTE_LITERALS,
  SMS_SURFACE_ROUTE_LITERAL_IGNORE,
} from "@/lib/sms-surface-authority-registry";

const REPO = process.cwd();

const INBOUND_ACTIVE = [
  "normal_inbound_reply",
  "open_question_answer",
  "arc_clarify_ambiguous_short",
  "central_brain_pivot",
] as const;

const DAILY_ACTIVE = [
  "main_active_accountability",
  "low_pressure_reactivation",
  "contract_prompt",
  "pending_resolution",
  "refresh_identity",
  "refresh_commitment",
] as const;

describe("SMS surface authority registry (Phase 4.9b)", () => {
  it("all active StrategyCardRouteKind values are active_strategy_card_surface", () => {
    for (const kind of ACTIVE_STRATEGY_CARD_ROUTE_KINDS) {
      const entries = findSurfaceAuthorityEntriesByRouteIdentifier(kind);
      const active = entries.filter((e) => e.classification === "active_strategy_card_surface");
      expect(active.length, kind).toBeGreaterThanOrEqual(1);
      expect(active[0]?.strategy_card_route_kind).toBe(kind);
      expect(active[0]?.visible_sms).toBe(true);
      expect(active[0]?.owner).toBe("strategy_card");
    }
  });

  it("active inbound route kinds are represented", () => {
    for (const kind of INBOUND_ACTIVE) {
      expect(isActiveStrategyCardSurfaceRoute(kind)).toBe(true);
      const entry = findSurfaceAuthorityEntriesByRouteIdentifier(kind).find(
        (e) => e.classification === "active_strategy_card_surface"
      );
      expect(entry?.final_guard_mode).toBe("normal_coaching_full");
    }
  });

  it("active daily route kinds are represented", () => {
    for (const kind of DAILY_ACTIVE) {
      const entry = findSurfaceAuthorityEntriesByRouteIdentifier(kind).find(
        (e) => e.classification === "active_strategy_card_surface"
      );
      expect(entry, kind).toBeDefined();
      expect(entry?.final_guard_mode).toBe("outbound_daily");
    }
  });

  it("active weekly route kind is represented", () => {
    const entry = findSurfaceAuthorityEntriesByRouteIdentifier("weekly_proof_v2").find(
      (e) => e.classification === "active_strategy_card_surface"
    );
    expect(entry?.final_guard_mode).toBe("outbound_weekly");
  });

  it("no active Strategy Card route kind is classified only as exception", () => {
    for (const kind of ACTIVE_STRATEGY_CARD_ROUTE_KINDS) {
      if (SMS_SURFACE_AUTHORITY_DUAL_PURPOSE_ROUTE_IDS.has(kind)) continue;
      const entries = findSurfaceAuthorityEntriesByRouteIdentifier(kind);
      expect(
        entries.some((e) => e.classification === "active_strategy_card_surface"),
        kind
      ).toBe(true);
      expect(
        entries.every((e) => e.classification === "active_strategy_card_surface"),
        kind
      ).toBe(true);
    }
  });

  it("dual-purpose route ids have both card and exception entries documented", () => {
    const outboundCardDual = new Set([
      "pending_resolution",
      "refresh_identity",
      "refresh_commitment",
    ]);
    for (const routeId of outboundCardDual) {
      const entries = findSurfaceAuthorityEntriesByRouteIdentifier(routeId);
      expect(entries.length, routeId).toBeGreaterThanOrEqual(2);
      expect(entries.some((e) => e.classification === "active_strategy_card_surface")).toBe(true);
      expect(entries.some((e) => e.dual_purpose_lane === true)).toBe(true);
    }
    const refreshInboundOnly = findSurfaceAuthorityEntriesByRouteIdentifier("refresh");
    expect(refreshInboundOnly.some((e) => e.dual_purpose_lane === true)).toBe(true);
  });

  it("every registry entry has required fields", () => {
    for (const entry of SMS_SURFACE_AUTHORITY_REGISTRY) {
      expect(entry.id.trim()).toBeTruthy();
      expect(entry.surface_label.trim()).toBeTruthy();
      expect(entry.route_identifiers.length).toBeGreaterThan(0);
      expect(entry.classification).not.toBe("unknown" as never);
      expect(entry.owner).toBeTruthy();
      expect(entry.disposition).toBeTruthy();
      expect(entry.reason.trim().length).toBeGreaterThan(10);
      expect(entry.action.trim().length).toBeGreaterThan(5);
      expect(typeof entry.visible_sms).toBe("boolean");
    }
  });

  it("no duplicate ids", () => {
    const ids = SMS_SURFACE_AUTHORITY_REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("no duplicate route_identifiers unless dual-purpose", () => {
    const routeToEntries = new Map<string, string[]>();
    for (const entry of SMS_SURFACE_AUTHORITY_REGISTRY) {
      for (const routeId of entry.route_identifiers) {
        const list = routeToEntries.get(routeId) ?? [];
        list.push(entry.id);
        routeToEntries.set(routeId, list);
      }
    }
    for (const [routeId, entryIds] of routeToEntries) {
      if (entryIds.length <= 1) continue;
      if (SMS_SURFACE_AUTHORITY_DUAL_PURPOSE_ROUTE_IDS.has(routeId)) continue;
      const dualMarked = entryIds.every((id) => {
        const e = SMS_SURFACE_AUTHORITY_REGISTRY.find((x) => x.id === id);
        return e?.dual_purpose_lane === true;
      });
      expect(
        dualMarked,
        `route ${routeId} appears on ${entryIds.join(", ")} without dual_purpose_lane`
      ).toBe(true);
    }
  });

  it("every visible_sms=true non-card surface has reason and action", () => {
    for (const entry of SMS_SURFACE_AUTHORITY_REGISTRY) {
      if (entry.classification === "active_strategy_card_surface") continue;
      if (!entry.visible_sms) continue;
      expect(entry.reason.length).toBeGreaterThan(10);
      expect(entry.action.length).toBeGreaterThan(5);
    }
  });

  it("every InboundV3RoutePurpose is classified in the registry", () => {
    for (const purpose of INBOUND_V3_ROUTE_PURPOSES) {
      expect(isRouteIdentifierClassified(purpose), purpose).toBe(true);
    }
  });

  it("curated required route literals are classified", () => {
    for (const routeId of SMS_SURFACE_REQUIRED_ROUTE_LITERALS) {
      expect(isRouteIdentifierClassified(routeId), routeId).toBe(true);
    }
  });

  it("static source grep: production route literals in target files are classified", () => {
    const unclassified: { file: string; route: string }[] = [];
    for (const rel of SMS_SURFACE_AUTHORITY_SOURCE_FILES) {
      const abs = path.join(REPO, rel);
      expect(fs.existsSync(abs), rel).toBe(true);
      const source = fs.readFileSync(abs, "utf8");
      for (const route of extractSmsRouteLiteralsFromSource(source)) {
        if (SMS_SURFACE_ROUTE_LITERAL_IGNORE.has(route)) continue;
        if (!isRouteIdentifierClassified(route)) {
          unclassified.push({ file: rel, route });
        }
      }
    }
    if (unclassified.length > 0) {
      throw new Error(
        `Unclassified route literals in production source:\n${unclassified
          .map((u) => `  ${u.file}: ${u.route}`)
          .join("\n")}\nAdd to SMS_SURFACE_AUTHORITY_REGISTRY.`
      );
    }
  });

  it("hard routes are documented", () => {
    const hard = SMS_SURFACE_AUTHORITY_REGISTRY.filter(
      (e) =>
        e.classification === "hard_route_deterministic_exception" ||
        e.classification === "suppressed_no_visible_sms"
    );
    expect(hard.length).toBeGreaterThanOrEqual(7);
    expect(findSurfaceAuthorityEntriesByRouteIdentifier("stop").length).toBeGreaterThan(0);
    expect(findSurfaceAuthorityEntriesByRouteIdentifier("onboarding_consent").length).toBeGreaterThan(
      0
    );
  });

  it("transactional state-machine routes are documented", () => {
    for (const route of [
      "blocker_capture_ack",
      "central_brain_blocker_pivot",
      "memory_confirmation",
      "adaptive_proposal_consent_clarification",
      "commitment_change_handoff",
    ]) {
      const entry = findSurfaceAuthorityEntriesByRouteIdentifier(route).find(
        (e) => e.classification === "state_machine_transactional_exception"
      );
      expect(entry, route).toBeDefined();
    }
  });

  it("legacy fallback and guided shrink are documented", () => {
    expect(
      findSurfaceAuthorityEntriesByRouteIdentifier("conversation_brain_unavailable")[0]
        ?.classification
    ).toBe("deferred_env_gated_exception");
    expect(
      findSurfaceAuthorityEntriesByRouteIdentifier("guided_shrink_contract_prompt")[0]
        ?.classification
    ).toBe("app_driven_constrained_exception");
  });

  it("weekly legacy deprecated is documented", () => {
    const entry = findSurfaceAuthorityEntriesByRouteIdentifier("weekly_legacy_reflection")[0];
    expect(entry?.classification).toBe("deprecated_no_visible_sms");
    expect(entry?.visible_sms).toBe(false);
  });

  it("active card kinds match StrategyCardRouteKind union used in production", () => {
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

describe("Phase 4.9b — send caller authority coverage", () => {
  const TRANSPORT_ONLY = new Set(["src/lib/twilio.ts"]);

  it("every production send caller (except transport) is referenced by registry send_caller_files", () => {
    const registryFiles = new Set(
      SMS_SURFACE_AUTHORITY_REGISTRY.flatMap((e) => e.send_caller_files ?? [])
    );
    for (const caller of PRODUCTION_SMS_SEND_CALLER_ALLOWLIST) {
      if (TRANSPORT_ONLY.has(caller)) continue;
      expect(registryFiles.has(caller), `missing registry coverage for ${caller}`).toBe(true);
    }
  });

  it("onboarding consent send caller is hard_route_deterministic_exception", () => {
    const entry = SMS_SURFACE_AUTHORITY_REGISTRY.find((e) => e.id === "hard_onboarding_consent");
    expect(entry?.classification).toBe("hard_route_deterministic_exception");
    expect(entry?.send_caller_files).toContain("src/app/api/onboarding/sms/route.ts");
  });

  it("guided shrink send caller is app_driven_constrained_exception", () => {
    const entry = SMS_SURFACE_AUTHORITY_REGISTRY.find((e) => e.id === "guided_shrink_contract");
    expect(entry?.classification).toBe("app_driven_constrained_exception");
    expect(entry?.send_caller_files).toContain("src/lib/v2-adaptive-contract.ts");
  });

  it("D2b photo clarification send caller is app_driven_constrained_exception", () => {
    const entry = SMS_SURFACE_AUTHORITY_REGISTRY.find(
      (e) => e.id === "mms_d2b_photo_clarification"
    );
    expect(entry?.classification).toBe("app_driven_constrained_exception");
    expect(entry?.send_caller_files).toContain(
      "src/lib/victory-media/inbound-mms-d2b.ts"
    );
  });

  it("deprecated cron send paths are deprecated_no_visible_sms or absent from allowlist", () => {
    const deprecated = SMS_SURFACE_AUTHORITY_REGISTRY.filter(
      (e) => e.classification === "deprecated_no_visible_sms"
    );
    expect(deprecated.map((e) => e.id)).toContain("weekly_legacy_deprecated");
    expect(deprecated.map((e) => e.id)).toContain("deprecated_followup_sms");
  });
});

describe("Phase 4.9b — no production behavior change guards", () => {
  const FORBIDDEN_PRODUCTION_TOUCH = [
    "src/app/api/cron/sms-inbound-coach/route.ts",
    "src/app/api/cron/daily-sms/route.ts",
    "src/app/api/cron/weekly-sms/route.ts",
    "src/lib/sms-final-product-law-guard.ts",
    "src/lib/weekly-outbound-proof-truth.ts",
    "src/lib/v2-adaptive-contract.ts",
    "src/lib/twilio.ts",
  ];

  const REGISTRY_AND_TESTS = [
    "src/lib/sms-surface-authority-registry.ts",
    "src/lib/sms-surface-authority-registry.test.ts",
    "src/lib/sms-strategy-card-exception-registry.ts",
    "src/sms-review-place/SMS_SURFACE_AUTHORITY_REGISTRY.md",
    "src/sms-review-place/STRATEGY_CARD_OBSERVATION.md",
    "src/lib/phase4-sms-send-surface-governance.test.ts",
  ];

  it("authority registry is not imported by production routing modules", () => {
    for (const rel of FORBIDDEN_PRODUCTION_TOUCH) {
      const src = fs.readFileSync(path.join(REPO, rel), "utf8");
      expect(src.includes("sms-surface-authority-registry")).toBe(false);
    }
  });

  it("no new Strategy Card surfaces wired in lane files", () => {
    const inbound = fs.readFileSync(
      path.join(REPO, "src/lib/v3-inbound-relationship-lane.ts"),
      "utf8"
    );
    const daily = fs.readFileSync(path.join(REPO, "src/lib/v3-daily-relationship-lane.ts"), "utf8");
    expect(inbound).not.toContain("guided_shrink");
    expect(daily).not.toContain("buildWeeklyProofStrategyCardV1");
    expect(allSurfaceAuthorityRouteIdentifiers().filter((r) => r.includes("unknown"))).toEqual([]);
  });
});
