/**
 * Phase 4 slice 4G + 4.0 — production SMS send surface inventory + secondary outbound FVG policy matrix.
 * No send-behavior changes here; failures force explicit classification when new Twilio entrypoints appear.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  FORBIDDEN_INBOUND_DETERMINISTIC_RELATIONSHIP_APPEND,
  RELATIONSHIP_SMS_ROUTE_FILES,
} from "./sms-voice-ownership-static-policy";
import {
  findSurfaceAuthorityEntriesByRouteIdentifier,
  SMS_SURFACE_AUTHORITY_REGISTRY,
} from "./sms-surface-authority-registry";

const REPO_ROOT = process.cwd();

/**
 * Every production file that may invoke `sendSMS(` or `sendSMSChunked(`.
 * If you add a new outbound path, extend this set and document it in the policy matrix below.
 */
export const PRODUCTION_SMS_SEND_CALLER_ALLOWLIST = new Set<string>([
  "src/lib/twilio.ts",
  "src/app/api/cron/daily-sms/route.ts",
  "src/app/api/cron/sms-inbound-coach/route.ts",
  "src/app/api/cron/weekly-sms/route.ts",
  "src/lib/tyler-text-overview-weekly-send.ts",
  "src/lib/tyler-text-overview-evening-send.ts",
  "src/app/api/onboarding/sms/route.ts",
  "src/lib/v2-adaptive-contract.ts",
  "src/lib/victory-media/inbound-mms-d2b.ts",
]);

const SEND_SMS_CALL = /\bsendSMS\s*\(/;
const SEND_SMS_CHUNKED_CALL = /\bsendSMSChunked\s*\(/;

function isSendSmsDefinitionLine(line: string): boolean {
  const t = line.trim();
  if (/\bexport\s+async\s+function\s+sendSMS\b/.test(t)) return true;
  if (/\bexport\s+async\s+function\s+sendSMSChunked\b/.test(t)) return true;
  return false;
}

function walkProductionTsFiles(dir: string): string[] {
  const results: string[] = [];
  const skipDirs = new Set(["node_modules", ".next", "dist", "coverage"]);

  function walk(current: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        if (skipDirs.has(ent.name)) continue;
        walk(full);
      } else if (ent.isFile() && ent.name.endsWith(".ts")) {
        if (ent.name.endsWith(".test.ts") || ent.name.endsWith(".spec.ts")) continue;
        results.push(full);
      }
    }
  }

  walk(dir);
  return results;
}

function toPosixRel(fileAbs: string): string {
  return path.relative(REPO_ROOT, fileAbs).split(path.sep).join("/");
}

type SendHit = { file: string; line: number; text: string; kind: "sendSMS" | "sendSMSChunked" };

function findSendHits(relFile: string, content: string): SendHit[] {
  const hits: SendHit[] = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//")) return;
    if (isSendSmsDefinitionLine(line)) return;
    if (SEND_SMS_CHUNKED_CALL.test(line)) {
      hits.push({ file: relFile, line: idx + 1, text: trimmed, kind: "sendSMSChunked" });
    } else if (SEND_SMS_CALL.test(line)) {
      hits.push({ file: relFile, line: idx + 1, text: trimmed, kind: "sendSMS" });
    }
  });
  return hits;
}

/** Test-only policy matrix for secondary + transactional surfaces (Phase 4 planning enforcement). */
export const SECONDARY_SMS_ROUTE_POLICY = [
  {
    route: "weekly_sms",
    file: "src/app/api/cron/weekly-sms/route.ts",
    classification: "relationship_coaching" as const,
    canBypassRelationshipLane: false,
    requiresFvg: false,
    requiresFailClosedWhenCoaching: true,
    usesNorthStar: false,
    usesFvg: false,
    normalCoachingPattern:
      "Weekly TTO draft-authoritative: cron sends only persisted weekly_review current_body_to_send (+ STOP/HELP footer) via tyler-text-overview-weekly-send. No live-build / NS / FVG in cron. Voice ownership runs at Weekly TTO generation time.",
    notNormalCoachingBypassRisk:
      "Cron must not live-build; force=1 bypasses window only; dryRun is side-effect free.",
    phase4Action: "migrate_visible_body_to_outbound_v3_relationship_lane",
  },
  {
    route: "followup_sms",
    file: "src/app/api/cron/followup-sms/route.ts",
    classification: "deprecated_legacy" as const,
    canBypassRelationshipLane: false,
    requiresFvg: false,
    requiresFailClosedWhenCoaching: false,
    usesNorthStar: false,
    usesFvg: false,
    normalCoachingPattern:
      "Phase 4.3: legacy followup deprecated — metadata-only update on sms_send_events; no sendSMS / NS / FVG.",
    notNormalCoachingBypassRisk: "N/A — route no longer sends coaching SMS.",
    phase4Action: "delete_or_deprecate_for_v2_cohort_or_migrate_if_stragglers_remain",
  },
  {
    route: "missed_yesterday_sms",
    file: "src/app/api/cron/missed-yesterday-sms/route.ts",
    classification: "deprecated_legacy" as const,
    canBypassRelationshipLane: false,
    requiresFvg: false,
    requiresFailClosedWhenCoaching: false,
    usesNorthStar: false,
    usesFvg: false,
    normalCoachingPattern:
      "Phase 4.3: legacy missed-yesterday deprecated — metadata-only update on sms_send_events; no sendSMS / NS / FVG.",
    notNormalCoachingBypassRisk: "N/A — route no longer sends coaching SMS.",
    phase4Action: "delete_or_deprecate_for_v2_cohort_or_migrate_if_stragglers_remain",
  },
  {
    route: "inactivity_rescue",
    file: "src/app/api/cron/inactivity-rescue/route.ts",
    classification: "deprecated_legacy" as const,
    canBypassRelationshipLane: false,
    requiresFvg: false,
    requiresFailClosedWhenCoaching: false,
    usesNorthStar: false,
    usesFvg: false,
    normalCoachingPattern:
      "Phase 4.4: inactivity-rescue is deprecated no-send when enabled; feedback_events only; canonical reactivation is daily SMS V3.",
    notNormalCoachingBypassRisk: "N/A — route no longer sends coaching SMS.",
    phase4Action: "delete_or_deprecate_for_v2_cohort_or_migrate_if_stragglers_remain",
  },
  {
    route: "post_churn_winback",
    file: "src/app/api/cron/post-churn-winback/route.ts",
    classification: "deprecated_legacy" as const,
    canBypassRelationshipLane: false,
    requiresFvg: false,
    requiresFailClosedWhenCoaching: false,
    usesNorthStar: false,
    usesFvg: false,
    normalCoachingPattern:
      "Phase 4.5: post-churn winback deprecated no-send; feedback_events only; no SMS / NS / FVG / signed links.",
    notNormalCoachingBypassRisk: "N/A — route no longer sends SMS.",
    phase4Action: "delete_or_deprecate_for_v2_cohort_or_migrate_if_stragglers_remain",
  },
  {
    route: "onboarding_sms",
    file: "src/app/api/onboarding/sms/route.ts",
    classification: "transactional_compliance" as const,
    canBypassRelationshipLane: true,
    requiresFvg: false,
    requiresFailClosedWhenCoaching: false,
    usesNorthStar: false,
    usesFvg: false,
    normalCoachingPattern:
      "Phase 4.7: deterministic transactional copy; sendSMS lastOutbound.delivery_snapshot tags onboarding_consent_transactional; no V3/NS/FVG.",
    notNormalCoachingBypassRisk: "None — relationship lane intentionally not used (file comment).",
    phase4Action: "accepted_transactional_exception_with_metadata",
  },
  {
    route: "guided_contract_shrink_ask",
    file: "src/lib/v2-adaptive-contract.ts (entry: src/app/api/v2/guided-resolution/tighten/route.ts)",
    classification: "relationship_coaching" as const,
    canBypassRelationshipLane: false,
    requiresFvg: true,
    requiresFailClosedWhenCoaching: true,
    usesNorthStar: true,
    usesFvg: true,
    normalCoachingPattern: "normalCoaching: true in proposeShrinkAskFromGuidedResolution",
    notNormalCoachingBypassRisk:
      "Fail-closed when normalCoaching true; replySource from buildV2ShrinkProposalOutboundSms — metadata parity review later.",
    phase4Action: "metadata_reply_source_review_only_in_phase4_later_slices",
  },
] as const;

describe("Phase 4.0 — production SMS send surface allowlist (4G)", () => {
  it("every production sendSMS/sendSMSChunked call site lives in the explicit allowlist", () => {
    const srcRoot = path.join(REPO_ROOT, "src");
    const files = walkProductionTsFiles(srcRoot);
    const violations: SendHit[] = [];
    const allHits: SendHit[] = [];

    for (const abs of files) {
      const rel = toPosixRel(abs);
      const content = fs.readFileSync(abs, "utf8");
      const hits = findSendHits(rel, content);
      for (const h of hits) {
        allHits.push(h);
        if (!PRODUCTION_SMS_SEND_CALLER_ALLOWLIST.has(rel)) {
          violations.push(h);
        }
      }
    }

    if (violations.length > 0) {
      const detail = violations
        .map((v) => `${v.file}:${v.line} [${v.kind}] ${v.text}`)
        .join("\n");
      throw new Error(
        `Unlisted production SMS send call site(s). Add the file to PRODUCTION_SMS_SEND_CALLER_ALLOWLIST after explicit review:\n${detail}`
      );
    }

    expect(allHits.length).toBeGreaterThan(0);
  });

  it("twilio transport is the only sendSMSChunked entrypoint outside inbound coach", () => {
    const srcRoot = path.join(REPO_ROOT, "src");
    const files = walkProductionTsFiles(srcRoot);
    const chunked: SendHit[] = [];
    for (const abs of files) {
      const rel = toPosixRel(abs);
      const content = fs.readFileSync(abs, "utf8");
      chunked.push(...findSendHits(rel, content).filter((h) => h.kind === "sendSMSChunked"));
    }
    const unexpected = chunked.filter(
      (h) =>
        h.file !== "src/lib/twilio.ts" &&
        h.file !== "src/app/api/cron/sms-inbound-coach/route.ts" &&
        h.file !== "src/lib/victory-media/inbound-mms-d2b.ts"
    );
    expect(unexpected).toEqual([]);
  });
});

describe("Phase 4.0 — secondary outbound FVG policy matrix (static)", () => {
  it("policy matrix covers every allowlisted non-transport, non-core cron sender", () => {
    const secondaryFiles = new Set(
      SECONDARY_SMS_ROUTE_POLICY.map((p) => p.file.split(" ")[0]!.trim())
    );
    const expectedSecondaries = [
      "src/app/api/cron/weekly-sms/route.ts",
      "src/app/api/cron/followup-sms/route.ts",
      "src/app/api/cron/missed-yesterday-sms/route.ts",
      "src/app/api/cron/inactivity-rescue/route.ts",
      "src/app/api/cron/post-churn-winback/route.ts",
      "src/app/api/onboarding/sms/route.ts",
      "src/lib/v2-adaptive-contract.ts",
    ];
    for (const f of expectedSecondaries) {
      expect(secondaryFiles.has(f), `missing policy row for ${f}`).toBe(true);
    }
  });

  for (const row of SECONDARY_SMS_ROUTE_POLICY) {
    it(`route ${row.route} has documented FVG / NS expectations`, () => {
      const primaryPath = path.join(REPO_ROOT, row.file.split(" ")[0]!.trim());
      expect(fs.existsSync(primaryPath), `policy file missing: ${row.file}`).toBe(true);
      const src = fs.readFileSync(primaryPath, "utf8");

      if (row.requiresFvg) {
        expect(src.includes("applyFinalVoiceOwnershipGate"), `${row.route}: expected FVG`).toBe(true);
      }
      if (row.usesNorthStar) {
        expect(
          src.includes("finalizeNorthStarCoachSmsAsync") || src.includes("finalizeNorthStarCoachSms"),
          `${row.route}: expected North Star`
        ).toBe(true);
      }
      if (row.route === "onboarding_sms") {
        expect(src.includes("applyFinalVoiceOwnershipGate"), "onboarding must not add FVG accidentally").toBe(
          false
        );
      }
    });
  }

  it("guided tighten API delegates send+FVG to v2-adaptive-contract", () => {
    const tighten = fs.readFileSync(
      path.join(REPO_ROOT, "src/app/api/v2/guided-resolution/tighten/route.ts"),
      "utf8"
    );
    expect(tighten).toContain("proposeShrinkAskFromGuidedResolution");
    const lib = fs.readFileSync(path.join(REPO_ROOT, "src/lib/v2-adaptive-contract.ts"), "utf8");
    expect(lib).toContain("applyFinalVoiceOwnershipGate");
    expect(lib).toContain("proposeShrinkAskFromGuidedResolution");
  });

  it("relationship_coaching rows require migration action (Phase 4 later), not transactional bypass", () => {
    for (const row of SECONDARY_SMS_ROUTE_POLICY) {
      if (row.classification === "relationship_coaching") {
        expect(row.canBypassRelationshipLane).toBe(false);
        expect(row.phase4Action).toMatch(/migrate|redesign|review/);
      }
      if (row.classification === "transactional_compliance" || row.classification === "product_research") {
        expect(row.canBypassRelationshipLane).toBe(true);
      }
      if (row.classification === "deprecated_legacy") {
        expect(row.phase4Action).toMatch(/delete|deprecate|migrate/);
      }
    }
  });
});

describe("Phase 4.1 — secondary FVG normalCoaching policy (fail-closed relationship sends)", () => {
  it("weekly-sms is Weekly TTO draft-authoritative (no FVG/NS live-build in cron)", () => {
    const weekly = fs.readFileSync(path.join(REPO_ROOT, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    expect(weekly).toContain("weekly-sms is Weekly TTO draft-authoritative");
    expect(weekly).toContain("assertWeeklyTtoDraftAuthoritativeForCronSend");
    expect(weekly).not.toContain("applyFinalVoiceOwnershipGate");
    expect(weekly).not.toContain("finalizeNorthStarCoachSmsAsync");
    expect(weekly).not.toMatch(/normalCoaching:\s*true/);
    expect(weekly).not.toContain("produceWeeklyV3RelationshipSms");
  });

  it("followup-sms and missed-yesterday-sms are Phase 4.3 deprecated (no send / NS / FVG)", () => {
    const followup = fs.readFileSync(path.join(REPO_ROOT, "src/app/api/cron/followup-sms/route.ts"), "utf8");
    expect(followup).toContain("skipped_legacy_followup_deprecated");
    expect(followup).not.toMatch(/\bsendSMS\s*\(/);
    expect(followup).not.toContain("finalizeNorthStarCoachSmsAsync");
    expect(followup).not.toContain("applyFinalVoiceOwnershipGate");
    expect(followup).not.toContain("refineMachineSmsBodyWithV3RefineLane");

    const missed = fs.readFileSync(path.join(REPO_ROOT, "src/app/api/cron/missed-yesterday-sms/route.ts"), "utf8");
    expect(missed).toContain("skipped_legacy_missed_yesterday_deprecated");
    expect(missed).not.toMatch(/\bsendSMS\s*\(/);
    expect(missed).not.toContain("finalizeNorthStarCoachSmsAsync");
    expect(missed).not.toContain("applyFinalVoiceOwnershipGate");
    expect(missed).not.toContain("refineMachineSmsBodyWithV3RefineLane");
  });

  it("inactivity-rescue is Phase 4.4 deprecated (no send / NS / FVG)", () => {
    const rescue = fs.readFileSync(path.join(REPO_ROOT, "src/app/api/cron/inactivity-rescue/route.ts"), "utf8");
    expect(rescue).toContain("inactivity_rescue_deprecated");
    expect(rescue).not.toMatch(/\bsendSMS\s*\(/);
    expect(rescue).not.toContain("finalizeNorthStarCoachSmsAsync");
    expect(rescue).not.toContain("applyFinalVoiceOwnershipGate");
    expect(rescue).not.toContain("refineMachineSmsBodyWithV3RefineLane");
  });

  it("inactivity-rescue uses resolveUserFullyOnV2ForCutoverMessaging (Phase 4.4 observability)", () => {
    const rescue = fs.readFileSync(path.join(REPO_ROOT, "src/app/api/cron/inactivity-rescue/route.ts"), "utf8");
    expect(rescue).toContain("resolveUserFullyOnV2ForCutoverMessaging");
  });

  it("onboarding_sms is Phase 4.7 transactional exception (policy matrix + route static)", () => {
    const row = SECONDARY_SMS_ROUTE_POLICY.find((r) => r.route === "onboarding_sms");
    expect(row?.phase4Action).toBe("accepted_transactional_exception_with_metadata");
    expect(row?.classification).toBe("transactional_compliance");
    expect(row?.usesNorthStar).toBe(false);
    expect(row?.usesFvg).toBe(false);
    const onboarding = fs.readFileSync(
      path.join(REPO_ROOT, "src/app/api/onboarding/sms/route.ts"),
      "utf8"
    );
    expect(onboarding).not.toContain("applyFinalVoiceOwnershipGate");
    expect(onboarding).toContain("buildOnboardingTransactionalSmsDeliverySnapshot");
  });

  it("post-churn-winback is Phase 4.5 deprecated (no send / NS / FVG / signed link)", () => {
    const winback = fs.readFileSync(path.join(REPO_ROOT, "src/app/api/cron/post-churn-winback/route.ts"), "utf8");
    expect(winback).toContain("post_churn_winback_deprecated");
    expect(winback).not.toMatch(/\bsendSMS\s*\(/);
    expect(winback).not.toContain("finalizeNorthStarCoachSmsAsync");
    expect(winback).not.toContain("applyFinalVoiceOwnershipGate");
    expect(winback).not.toContain("refineMachineSmsBodyWithV3RefineLane");
    expect(winback).not.toContain("appendPreservedSignedLink");
    expect(winback).not.toContain("createWinbackToken");
    expect(winback).not.toContain("/winback?t=");
  });
});

describe("Phase 4.9b — send caller surface authority registry linkage", () => {
  const COACHING_SEND_CALLERS = [
    "src/app/api/cron/sms-inbound-coach/route.ts",
    "src/app/api/cron/daily-sms/route.ts",
    "src/lib/tyler-text-overview-weekly-send.ts",
    "src/lib/v2-adaptive-contract.ts",
  ] as const;

  it("every coaching send caller is covered by at least one authority registry entry", () => {
    for (const caller of COACHING_SEND_CALLERS) {
      const covering = SMS_SURFACE_AUTHORITY_REGISTRY.filter((e) =>
        e.send_caller_files?.includes(caller)
      );
      expect(covering.length, caller).toBeGreaterThan(0);
    }
  });

  it("onboarding send caller maps to hard_route_deterministic_exception", () => {
    const entries = SMS_SURFACE_AUTHORITY_REGISTRY.filter((e) =>
      e.send_caller_files?.includes("src/app/api/onboarding/sms/route.ts")
    );
    expect(entries.some((e) => e.id === "hard_onboarding_consent")).toBe(true);
    expect(entries.every((e) => e.classification !== "active_strategy_card_surface")).toBe(true);
  });

  it("guided shrink maps to app_driven_constrained_exception, not active card", () => {
    const entry = findSurfaceAuthorityEntriesByRouteIdentifier("guided_shrink_contract_prompt")[0];
    expect(entry?.classification).toBe("app_driven_constrained_exception");
    expect(entry?.strategy_card_route_kind).toBeFalsy();
  });

  it("hard-route TwiML/compliance surfaces are never_strategy_card dispositions", () => {
    for (const route of ["stop", "help", "start", "onboarding_consent"]) {
      const entry = findSurfaceAuthorityEntriesByRouteIdentifier(route)[0];
      expect(
        entry?.classification === "hard_route_deterministic_exception" ||
          entry?.classification === "suppressed_no_visible_sms"
      ).toBe(true);
      expect(entry?.disposition).toBe("never_card");
    }
  });
});

describe("Phase 4 — SMS Voice Ownership Slice 1 cross-check", () => {
  it("relationship coaching send routes are locked by sms-voice-ownership-static.test.ts", () => {
    const voiceStatic = path.join(REPO_ROOT, "src/lib/sms-voice-ownership-static.test.ts");
    expect(fs.existsSync(voiceStatic)).toBe(true);
    for (const f of RELATIONSHIP_SMS_ROUTE_FILES) {
      expect(PRODUCTION_SMS_SEND_CALLER_ALLOWLIST.has(f)).toBe(true);
    }
  });

  it("inbound coach must not use forbidden deterministic Victory append (Slice 2)", () => {
    const inbound = fs.readFileSync(
      path.join(REPO_ROOT, "src/app/api/cron/sms-inbound-coach/route.ts"),
      "utf8"
    );
    for (const forbidden of FORBIDDEN_INBOUND_DETERMINISTIC_RELATIONSHIP_APPEND) {
      expect(inbound).not.toContain(forbidden);
    }
    expect(inbound).toContain("buildInboundProofCalloutHint");
  });
});
