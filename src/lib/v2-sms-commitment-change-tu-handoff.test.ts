import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

vi.mock("@/lib/v2-refresh-session", () => ({
  isRefreshSessionActive: vi.fn(() => false),
}));

import { validateTuProposedGoalBarText } from "@/lib/v2-sms-commitment-change";

describe("validateTuProposedGoalBarText remains live structural validation", () => {
  it("rejects vague proposed bars", () => {
    expect(
      validateTuProposedGoalBarText({
        proposedText: "be better",
        currentBehaviorStatement: "Walk daily",
      }).skipReason
    ).toBe("vague_candidate");
  });

  it("rejects proposed bar identical to current behavior", () => {
    expect(
      validateTuProposedGoalBarText({
        proposedText: "Walk 20 minutes after dinner",
        currentBehaviorStatement: "Walk 20 minutes after dinner",
      }).skipReason
    ).toBe("identical_to_current_bar");
  });

  it("accepts a concrete daily bar", () => {
    const r = validateTuProposedGoalBarText({
      proposedText: "run 3 miles every day",
      currentBehaviorStatement: "Walk 20 minutes after dinner",
    });
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe("run 3 miles every day");
  });
});

describe("7E-1 dead TU inbound handoff is gone", () => {
  it("library no longer exports inbound TU/phrase Goal Change routers", () => {
    const lib = fs.readFileSync(
      path.join(process.cwd(), "src/lib/v2-sms-commitment-change.ts"),
      "utf8"
    );
    expect(lib).not.toContain("export function evaluateTuGoalChangePendingHandoff");
    expect(lib).not.toContain("export function shouldOpenTuGoalChangePendingHandoff");
    expect(lib).not.toContain("export function deriveIntentPackFromReconciledGoalChange");
    expect(lib).not.toContain("export function deriveAwaitingCandidateIntentPackFromReconciledGoalChange");
    expect(lib).toContain("export function validateTuProposedGoalBarText");
    expect(lib).toContain("export async function applyWave4SmsCommitmentPendingResolution");
  });
});
