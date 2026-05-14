/**
 * Phase 4 slice 4G + 4.0 — production SMS send surface inventory + secondary outbound FVG policy matrix.
 * No send-behavior changes here; failures force explicit classification when new Twilio entrypoints appear.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
  "src/app/api/cron/followup-sms/route.ts",
  "src/app/api/cron/missed-yesterday-sms/route.ts",
  "src/app/api/cron/inactivity-rescue/route.ts",
  "src/app/api/cron/post-churn-winback/route.ts",
  "src/app/api/onboarding/sms/route.ts",
  "src/lib/v2-adaptive-contract.ts",
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
    requiresFvg: true,
    requiresFailClosedWhenCoaching: true,
    usesNorthStar: true,
    usesFvg: true,
    normalCoachingPattern:
      "Phase 4.1: V2 weekly proof and legacy Pat Pause branches both use normalCoaching: true (fail-closed FVG).",
    notNormalCoachingBypassRisk:
      "Resolved in Phase 4.1 — no longer gates FVG on Boolean(legacyCommitment?.id); metadata records fvg_policy_classification.",
    phase4Action: "migrate_visible_body_to_outbound_v3_relationship_lane",
  },
  {
    route: "followup_sms",
    file: "src/app/api/cron/followup-sms/route.ts",
    classification: "deprecated_legacy" as const,
    canBypassRelationshipLane: false,
    requiresFvg: true,
    requiresFailClosedWhenCoaching: true,
    usesNorthStar: true,
    usesFvg: true,
    normalCoachingPattern: "Phase 4.1: normalCoaching: true (fail-closed regardless of commitment row).",
    notNormalCoachingBypassRisk:
      "Resolved in Phase 4.1 — previously Boolean(commitmentFu?.id) could open not_normal_coaching bypass.",
    phase4Action: "delete_or_deprecate_for_v2_cohort_or_migrate_if_stragglers_remain",
  },
  {
    route: "missed_yesterday_sms",
    file: "src/app/api/cron/missed-yesterday-sms/route.ts",
    classification: "deprecated_legacy" as const,
    canBypassRelationshipLane: false,
    requiresFvg: true,
    requiresFailClosedWhenCoaching: true,
    usesNorthStar: true,
    usesFvg: true,
    normalCoachingPattern: "Phase 4.1: normalCoaching: true.",
    notNormalCoachingBypassRisk: "Resolved in Phase 4.1 — same as followup_sms.",
    phase4Action: "delete_or_deprecate_for_v2_cohort_or_migrate_if_stragglers_remain",
  },
  {
    route: "inactivity_rescue",
    file: "src/app/api/cron/inactivity-rescue/route.ts",
    classification: "relationship_coaching" as const,
    canBypassRelationshipLane: false,
    requiresFvg: true,
    requiresFailClosedWhenCoaching: true,
    usesNorthStar: true,
    usesFvg: true,
    normalCoachingPattern: "Phase 4.1: normalCoaching: true.",
    notNormalCoachingBypassRisk: "Resolved in Phase 4.1 — previously Boolean(commitmentR?.id).",
    phase4Action: "redesign_signals_and_migrate_before_broad_enable",
  },
  {
    route: "post_churn_winback",
    file: "src/app/api/cron/post-churn-winback/route.ts",
    classification: "product_research" as const,
    canBypassRelationshipLane: true,
    requiresFvg: true,
    requiresFailClosedWhenCoaching: true,
    usesNorthStar: true,
    usesFvg: true,
    normalCoachingPattern:
      "Phase 4.1: normalCoaching: true for fail-closed FVG; product_research classification is explicit in metadata (not implicit missing-commitment bypass).",
    notNormalCoachingBypassRisk:
      "Resolved in Phase 4.1 — explicit fvg_policy_classification + normal_coaching_policy_source; no Boolean(commitmentWb?.id) gate.",
    phase4Action: "document_exception_or_explicit_bypassKind_in_future_implementation",
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
    normalCoachingPattern: "N/A (intentional hard-coded consent copy)",
    notNormalCoachingBypassRisk: "None — relationship lane intentionally not used (file comment).",
    phase4Action: "keep_transactional_explicitly_tagged",
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
      (h) => h.file !== "src/lib/twilio.ts" && h.file !== "src/app/api/cron/sms-inbound-coach/route.ts"
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
  it("weekly-sms V2 proof and legacy branches use normalCoaching: true (no Boolean(legacyCommitment?.id) FVG gate)", () => {
    const weekly = fs.readFileSync(path.join(REPO_ROOT, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    expect(weekly).not.toMatch(/normalCoaching:\s*Boolean\(legacyCommitment\?\.id\)/);
    const trueMatches = weekly.match(/normalCoaching:\s*true/g);
    expect(trueMatches?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(weekly).toContain('fvg_policy_classification: "relationship_coaching"');
  });

  it("followup, missed-yesterday, and inactivity-rescue use normalCoaching: true (not Boolean(commitment?.id))", () => {
    const followup = fs.readFileSync(path.join(REPO_ROOT, "src/app/api/cron/followup-sms/route.ts"), "utf8");
    expect(followup).not.toMatch(/normalCoaching:\s*Boolean\(commitmentFu\?\.id\)/);
    expect(followup).toMatch(/normalCoaching:\s*true/);
    expect(followup).toContain('fvg_policy_classification: "relationship_coaching"');

    const missed = fs.readFileSync(path.join(REPO_ROOT, "src/app/api/cron/missed-yesterday-sms/route.ts"), "utf8");
    expect(missed).not.toMatch(/normalCoaching:\s*Boolean\(commitmentM\?\.id\)/);
    expect(missed).toMatch(/normalCoaching:\s*true/);
    expect(missed).toContain('fvg_policy_classification: "relationship_coaching"');

    const rescue = fs.readFileSync(path.join(REPO_ROOT, "src/app/api/cron/inactivity-rescue/route.ts"), "utf8");
    expect(rescue).not.toMatch(/normalCoaching:\s*Boolean\(commitmentR\?\.id\)/);
    expect(rescue).toMatch(/normalCoaching:\s*true/);
    expect(rescue).toContain('fvg_policy_classification: "relationship_rescue"');
  });

  it("post-churn winback uses fail-closed normalCoaching: true with explicit product_research metadata", () => {
    const winback = fs.readFileSync(path.join(REPO_ROOT, "src/app/api/cron/post-churn-winback/route.ts"), "utf8");
    expect(winback).not.toMatch(/normalCoaching:\s*Boolean\(commitmentWb\?\.id\)/);
    expect(winback).toMatch(/normalCoaching:\s*true/);
    expect(winback).toContain('fvg_policy_classification: "product_research"');
    expect(winback).toContain("explicit_product_research_fail_closed_phase4_1");
    expect(winback).not.toMatch(/if\s*\(\s*!voiceWinback\.shouldSend\s*&&\s*commitmentWb\?\.id\s*\)/);
  });

  it("onboarding SMS remains transactional consent (no FVG)", () => {
    const onboarding = fs.readFileSync(path.join(REPO_ROOT, "src/app/api/onboarding/sms/route.ts"), "utf8");
    expect(onboarding).not.toContain("applyFinalVoiceOwnershipGate");
  });
});
