import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

vi.mock("@/lib/v2-refresh-session", () => ({
  isRefreshSessionActive: vi.fn(() => false),
}));

import {
  applyIdentityEditGatedOverride,
  buildIdentityEditLaneGuardrails,
  detectSmsIdentityEditIntent,
} from "@/lib/sms-identity-edit-intent";

const REPO = path.join(__dirname, "..", "..");

function routeSrc(): string {
  return fs.readFileSync(path.join(REPO, "src/app/api/cron/sms-inbound-coach/route.ts"), "utf8");
}

function sliceBetween(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = src.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("Slice B — identity edit integrity wire", () => {
  it("processV2NormalInboundOutcome wires identity detection and override", () => {
    const fn = sliceBetween(
      routeSrc(),
      "async function processV2NormalInboundOutcome",
      "async function processV2BlockerCapture"
    );
    expect(fn).toContain("detectSmsIdentityEditIntent");
    expect(fn).toContain("applyIdentityEditGatedOverride");
    expect(fn).toContain("identity_edit_integrity");
    expect(fn).toContain("buildInboundV3IdentityEditFacts");
    expect(fn).toContain("shouldSuppressCommitmentChangeHandoffForIdentity");
    const exitIdx = fn.indexOf("applyRelationshipExitGatedOverride");
    const identityIdx = fn.indexOf("applyIdentityEditGatedOverride");
    expect(exitIdx).toBeGreaterThanOrEqual(0);
    expect(identityIdx).toBeGreaterThan(exitIdx);
  });

  it("identity lane sets non-outcome gated mode and blocks handoff suppression", () => {
    const fn = sliceBetween(
      routeSrc(),
      "async function processV2NormalInboundOutcome",
      "async function processV2BlockerCapture"
    );
    expect(fn).toContain('"identity_edit_integrity"');
    const g = applyIdentityEditGatedOverride(
      detectSmsIdentityEditIntent("Change my identity to someone who keeps promises")
    );
    expect(g.should_write_outcome_event).toBe(false);
    expect(g.mode).toBe("identity_edit_integrity");
    expect(g.final_event_type).toBeNull();
  });

  it("identity thread memory uses null expectedAnswerType", () => {
    const fn = sliceBetween(
      routeSrc(),
      "async function processV2NormalInboundOutcome",
      "async function processV2BlockerCapture"
    );
    expect(fn).toContain("identityEditLaneActive");
    expect(fn).toMatch(/expectedAnswerType:\s*identityEditLaneActive\s*\?\s*null/);
  });

  it("does not call profile or version persistence in identity path", () => {
    const fn = sliceBetween(
      routeSrc(),
      "async function processV2NormalInboundOutcome",
      "async function processV2BlockerCapture"
    );
    expect(fn).not.toContain("applyWave11ConfirmedProfileUpdates");
    expect(fn).not.toContain("persistOnboardingIdentity");
    expect(fn).not.toContain("user_identity_version");
  });

  it("V3 guardrails contain do-not-claim-identity-updated", () => {
    const g = buildIdentityEditLaneGuardrails();
    expect(g).toMatch(/did NOT update identity/i);
    expect(g).toMatch(/do NOT claim/i);
    expect(g).not.toMatch(/go to Victory Room automatically/i);
    expect(g).toMatch(/optional and fact-based/i);
  });

  it("v3 lane includes identity_edit_integrity route purpose", () => {
    const lane = fs.readFileSync(
      path.join(REPO, "src/lib/v3-inbound-relationship-lane.ts"),
      "utf8"
    );
    expect(lane).toContain("identity_edit_integrity");
    expect(lane).toContain("buildIdentityEditLaneGuardrails");
    expect(lane).toContain("identity_edit?:");
  });

  it("commitment handoff still uses Wave4 on behavior goal", () => {
    const fn = sliceBetween(
      routeSrc(),
      "async function processV2NormalInboundOutcome",
      "async function processV2BlockerCapture"
    );
    expect(fn).toContain("applyWave4SmsCommitmentPendingResolution");
    expect(fn).toContain("persistCommitmentChangeHandoffLaneAndSend");
  });

  it("D-lite relationship exit still wired before identity override", () => {
    const fn = sliceBetween(
      routeSrc(),
      "async function processV2NormalInboundOutcome",
      "async function processV2BlockerCapture"
    );
    expect(fn).toContain("detectSmsRelationshipExitIntent");
    expect(fn.indexOf("relationshipExitLaneActive")).toBeLessThan(fn.indexOf("identityEditLaneActive"));
  });
});
