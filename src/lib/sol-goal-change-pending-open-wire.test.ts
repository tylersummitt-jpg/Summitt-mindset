import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

vi.mock("server-only", () => ({}));

vi.mock("next/server", () => ({
  after: vi.fn(),
}));

const ROUTE = path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");
const TURN = path.join(process.cwd(), "src/lib/inbound-sol-relationship-turn.ts");
const WRITER = path.join(process.cwd(), "src/lib/inbound-sol-writer.ts");

describe("Slice 2 Goal Change pending-open production seam", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const turn = fs.readFileSync(TURN, "utf8");
  const writer = fs.readFileSync(WRITER, "utf8");

  it("runs Sol pending-open on the normal inbound path; Wave4 first-turn apply is gone", () => {
    const fnStart = src.indexOf("async function processV2NormalInboundOutcome");
    const openIdx = src.indexOf("await runSolGoalChangePendingOpenForInbound", fnStart);
    const solIdx = src.indexOf("await runInboundSolRelationshipTurn", fnStart);
    expect(fnStart).toBeGreaterThan(0);
    expect(openIdx).toBeGreaterThan(fnStart);
    expect(solIdx).toBeGreaterThan(openIdx);
    expect(src).not.toContain("openCommitmentChangeHandoff");
    expect(src).not.toContain("if (openCommitmentChangeHandoff && !plannedInterruptionActionable)");
    expect(src).not.toContain("await applyWave4SmsCommitmentPendingResolution");

    const afterOpen = src.slice(openIdx, solIdx);
    expect(afterOpen).toContain("plannedInterruptionKnown: plannedInterruptionActionable");
    expect(afterOpen).not.toContain("!plannedInterruptionActionable");
  });

  it("does not apply the canonical Goal Change RPC", () => {
    const openSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/sol-goal-change-pending-open.ts"),
      "utf8"
    );
    expect(openSrc).not.toContain("applyCanonicalGoalChangeWithSeasonMutation");
    expect(src).not.toContain("applyCanonicalGoalChangeWithSeasonMutation");
  });

  it("passes authorization into Sol and guards V3 body after the main lane writer", () => {
    expect(src).toContain("goalChangeConfirmationAuthorization");
    expect(turn).toContain("goalChangeConfirmationAuthorization: args.goalChangeConfirmationAuthorization ?? null");
    expect(turn).toContain("applyGoalChangeMachineBodySafety");
    const openIdx = src.indexOf("await runSolGoalChangePendingOpenForInbound");
    const v3Idx = src.indexOf("const laneRes = await produceInboundV3RelationshipSms", openIdx);
    const guardIdx = src.indexOf("applyGoalChangeMachineBodySafety", v3Idx);
    expect(v3Idx).toBeGreaterThan(0);
    expect(guardIdx).toBeGreaterThan(v3Idx);
  });

  it("guards remaining V3 writers with body safety; dead Wave4 handoff writer is gone", () => {
    expect(src).not.toContain("persistCommitmentChangeHandoffLaneAndSend");
    expect(src).toContain("applyGoalChangeMachineBodySafety");
  });

  it("writer prompt forbids unbound binding confirmation and false-applied claims", () => {
    expect(writer).toContain(
      "A binding saved-goal confirmation question is allowed only when goal_change_confirmation_authorized is true."
    );
    expect(writer).toContain("Pending is not applied");
    expect(writer).toContain("three mutually exclusive coaching states");
    expect(writer).toContain("GOAL_CHANGE_CONFIRMATION_STATE");
    expect(writer).toContain("GOAL_CHANGE_APPLIED_COACHING_NOTE");
    expect(writer).toContain("Do NOT re-ask confirmation after apply");
  });
});
