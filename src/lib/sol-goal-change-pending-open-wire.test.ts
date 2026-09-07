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

  it("runs Sol pending-open on the normal inbound path; Wave4 first-turn apply is suppressed", () => {
    const fnStart = src.indexOf("async function processV2NormalInboundOutcome");
    const openIdx = src.indexOf("await runSolGoalChangePendingOpenForInbound", fnStart);
    const solIdx = src.indexOf("await runInboundSolRelationshipTurn", fnStart);
    const suppressIdx = src.indexOf("const openCommitmentChangeHandoff = false", fnStart);
    const wave4If = src.indexOf(
      "if (openCommitmentChangeHandoff && !plannedInterruptionActionable)",
      fnStart
    );
    expect(fnStart).toBeGreaterThan(0);
    expect(suppressIdx).toBeGreaterThan(fnStart);
    expect(wave4If).toBeGreaterThan(suppressIdx);
    expect(openIdx).toBeGreaterThan(wave4If);
    expect(solIdx).toBeGreaterThan(openIdx);

    const wave4Block = src.slice(wave4If, openIdx);
    expect(wave4Block).toContain("applyWave4SmsCommitmentPendingResolution");
    expect(wave4Block).not.toContain("runSolGoalChangePendingOpenForInbound");

    const afterWave4If = src.slice(openIdx, solIdx);
    expect(afterWave4If).toContain("plannedInterruptionKnown: plannedInterruptionActionable");
    expect(afterWave4If).not.toContain("!plannedInterruptionActionable");
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

  it("guards Wave4 handoff V3 after produceInboundV3RelationshipSms and before persist/send", () => {
    const start = src.indexOf("async function persistCommitmentChangeHandoffLaneAndSend");
    const end = src.indexOf("async function handleAdaptiveProposalConsentAmbiguousInbound", start);
    const body = src.slice(start, end);
    const produceIdx = body.indexOf("produceInboundV3RelationshipSms");
    const safetyIdx = body.indexOf("applyGoalChangeMachineBodySafety");
    const persistIdx = body.indexOf("northStarGatePersistBodyAsync");
    expect(produceIdx).toBeGreaterThan(0);
    expect(safetyIdx).toBeGreaterThan(produceIdx);
    expect(persistIdx).toBeGreaterThan(safetyIdx);
    expect(body).toContain("goalChangeConfirmationAuthorization");
    expect(src).toContain("goalChangeConfirmationAuthorization,");
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
