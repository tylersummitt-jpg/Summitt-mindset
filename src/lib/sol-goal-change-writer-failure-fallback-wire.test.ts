import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  applyGoalChangeMachineBodySafety,
  bodyClaimsSavedGoalChangeAlreadyApplied,
  tryBuildAuthorizedGoalChangeWriterFailureFallback,
  type SolGoalChangeConfirmationAuthorization,
} from "@/lib/sol-goal-change-confirmation-guard";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

vi.mock("server-only", () => ({}));

vi.mock("next/server", () => ({
  after: vi.fn(),
}));

const ROUTE = path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");
const OPEN = path.join(process.cwd(), "src/lib/sol-goal-change-pending-open.ts");

const CANDIDATE = "I will be in bed by 10:30 pm nightly.";
const CANONICAL = "I will be in bed by 9:30 pm nightly.";

const pendingAuth: SolGoalChangeConfirmationAuthorization = {
  goal_change_confirmation_authorized: true,
  goal_change_apply_authorized: false,
  candidate_behavior_statement: CANDIDATE,
  canonical_behavior_statement: CANONICAL,
  pending_state: "awaiting_confirmation",
  previous_behavior_statement: null,
  previous_commitment_id: null,
  active_commitment_id: "cmt_angela",
  pending_cleared: false,
};

describe("Slice 5 correction — Sol writer-failure pending ask seam", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const open = fs.readFileSync(OPEN, "utf8");

  it("Sol main no-send may send an authorized pending ask, then still cancels when none exists", () => {
    const start = src.indexOf("if (\n      isInboundSolMainCoachingBranch");
    const sent = src.indexOf("inbound_sol_main_sent", start);
    const block = src.slice(start, sent);
    const fallbackIdx = block.indexOf("tryBuildAuthorizedGoalChangeWriterFailureFallback");
    const safetyIdx = block.indexOf("applyGoalChangeMachineBodySafety");
    const cancelIdx = block.indexOf('tag: "inbound_sol_main_no_send"');
    expect(fallbackIdx).toBeGreaterThan(0);
    expect(safetyIdx).toBeGreaterThan(fallbackIdx);
    expect(cancelIdx).toBeGreaterThan(safetyIdx);
    expect(block).toContain("inbound_sol_main_pending_ask_fallback");
  });

  it("pending-open hallway does not authorize a binding confirmation", () => {
    expect(open).toContain("shouldAttemptSolSavedReplaceAwaitingCandidateHallway");
    expect(open).toContain("openedAsAwaitingCandidateShell: true");
    expect(open).toContain('pending_state: "awaiting_candidate"');
    expect(open).toContain("New first-turn Wave4 tighten/raise-bar English is intentionally NOT restored");
  });

  it("fallback body cannot claim applied", () => {
    const body = tryBuildAuthorizedGoalChangeWriterFailureFallback(pendingAuth);
    expect(body).toBeTruthy();
    expect(bodyClaimsSavedGoalChangeAlreadyApplied(body!)).toBe(false);
    const guarded = applyGoalChangeMachineBodySafety({
      body: body!,
      authorization: pendingAuth,
    });
    expect(bodyClaimsSavedGoalChangeAlreadyApplied(guarded.body)).toBe(false);
    expect(guarded.body).toMatch(/do you want/i);
    expect(guarded.body).toContain("10:30");
    expect(guarded.body).toContain("9:30");
  });
});
