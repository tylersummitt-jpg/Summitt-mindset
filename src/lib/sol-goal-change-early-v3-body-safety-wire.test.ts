import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  applyGoalChangeMachineBodySafety,
  SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED,
} from "@/lib/sol-goal-change-confirmation-guard";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

vi.mock("server-only", () => ({}));

vi.mock("next/server", () => ({
  after: vi.fn(),
}));

const ROUTE = path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");
const TURN = path.join(process.cwd(), "src/lib/inbound-sol-relationship-turn.ts");

const BINDING = "Do you want 10:30 to replace 9:30 going forward?";
const FALSE_APPLIED_NOW = "Your goal is now 10:30.";
const FALSE_APPLIED_GOING_FORWARD = "Your goal going forward is 10:30.";
const ORDINARY_ANSWER = "Proud you named that. Rest tonight.";
const ORDINARY_COACHING = "Glad you reached out—and while I've got you, did today's bar happen?";
const ORDINARY_PIVOT = "Fair. That was confusing. Keep it simple: Did today's commitment happen?";
const ORDINARY_CLARIFY = "Quick check — are you saying yes: you did today's commitment?";

function seamBetween(src: string, produceMarker: string, persistMarker: string): string {
  const produceIdx = src.indexOf(produceMarker);
  const persistIdx = src.indexOf(persistMarker, produceIdx);
  expect(produceIdx).toBeGreaterThan(0);
  expect(persistIdx).toBeGreaterThan(produceIdx);
  return src.slice(produceIdx, persistIdx);
}

describe("early V3 Goal Change body-safety seams", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const turn = fs.readFileSync(TURN, "utf8");

  it("open-question V3: produce → helper(unauthorized) → persist", () => {
    const seam = seamBetween(
      src,
      "const openLaneRes = await produceInboundV3RelationshipSms",
      "const openVoicePack = await northStarGatePersistBodyAsync(openLaneRes.body"
    );
    const safetyIdx = seam.indexOf("applyGoalChangeMachineBodySafety");
    const emptyIdx = seam.indexOf("if (!openLaneRes.shouldSend || !openLaneRes.body.trim())");
    expect(safetyIdx).toBeGreaterThan(0);
    expect(emptyIdx).toBeGreaterThan(safetyIdx);
    expect(seam).toContain("authorization: SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED");
    expect(seam).toContain("openLaneRes.body = guardedOpen.body");
    expect(seam).toContain("cancelInboundV3LaneNoSendWithExplicitOutcomePersist");
  });

  it("conversation-brain fallback V3: produce → helper(unauthorized) → persist", () => {
    const seam = seamBetween(
      src,
      "const cbLaneRes = await produceInboundV3RelationshipSms",
      "const cbVoicePack = await northStarGatePersistBodyAsync(cbLaneRes.body"
    );
    const safetyIdx = seam.indexOf("applyGoalChangeMachineBodySafety");
    const emptyIdx = seam.indexOf("if (!cbLaneRes.shouldSend || !cbLaneRes.body.trim())");
    expect(safetyIdx).toBeGreaterThan(0);
    expect(emptyIdx).toBeGreaterThan(safetyIdx);
    expect(seam).toContain("authorization: SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED");
    expect(seam).toContain("cbLaneRes.body = guardedCb.body");
    expect(seam).toContain("conversation_brain_legacy_fallback_disabled_inbound_v3_lane_no_send");
    expect(src).not.toContain("priorDraftFromConversationBrain = applyGoalChangeMachineBodySafety");
  });

  it("central-brain pivot V3: produce → helper(unauthorized) → persist", () => {
    const seam = seamBetween(
      src,
      "const pivotLaneRes = await produceInboundV3RelationshipSms",
      "const pivotVoicePack = await northStarGatePersistBodyAsync(pivotLaneRes.body"
    );
    const safetyIdx = seam.indexOf("applyGoalChangeMachineBodySafety");
    const emptyIdx = seam.indexOf("if (!pivotLaneRes.shouldSend || !pivotLaneRes.body.trim())");
    expect(safetyIdx).toBeGreaterThan(0);
    expect(emptyIdx).toBeGreaterThan(safetyIdx);
    expect(seam).toContain("authorization: SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED");
    expect(seam).toContain("pivotLaneRes.body = guardedPivot.body");
    expect(seam).toContain("cancelInboundV3LaneNoSendWithExplicitOutcomePersist");
  });

  it("arc clarify V3: produce → helper(unauthorized) → persist", () => {
    const seam = seamBetween(
      src,
      "const arcLaneRes = await produceInboundV3RelationshipSms",
      "const clarifyVoicePack = await northStarGatePersistBodyAsync(arcLaneRes.body"
    );
    const safetyIdx = seam.indexOf("applyGoalChangeMachineBodySafety");
    const emptyIdx = seam.indexOf("if (!arcLaneRes.shouldSend || !arcLaneRes.body.trim())");
    expect(safetyIdx).toBeGreaterThan(0);
    expect(emptyIdx).toBeGreaterThan(safetyIdx);
    expect(seam).toContain("authorization: SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED");
    expect(seam).toContain("arcLaneRes.body = guardedArc.body");
    expect(seam).toContain("cancelInboundV3LaneNoSendWithExplicitOutcomePersist");
  });

  it("already-protected Sol main and V3 main still call the shared helper; dead Wave4 handoff is gone", () => {
    expect(turn).toContain("applyGoalChangeMachineBodySafety");
    const v3Main = seamBetween(
      src,
      "const laneRes = await produceInboundV3RelationshipSms",
      "attachInboundReplyBriefTelemetryToLaneMetadata"
    );
    expect(v3Main).toContain("applyGoalChangeMachineBodySafety");
    expect(src).not.toContain("persistCommitmentChangeHandoffLaneAndSend");
  });
});

describe("early V3 unauthorized Goal Change body-safety behavior", () => {
  const unauthorized = SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED;

  it("1: open-question binding confirmation is blocked with empty body", () => {
    const r = applyGoalChangeMachineBodySafety({ body: BINDING, authorization: unauthorized });
    expect(r.blocked).toBe(true);
    expect(r.body).toBe("");
    expect(r.reason).toBe("unauthorized_binding_goal_change_confirmation");
  });

  it("2: open-question ordinary answer response is unchanged", () => {
    const r = applyGoalChangeMachineBodySafety({
      body: ORDINARY_ANSWER,
      authorization: unauthorized,
    });
    expect(r.blocked).toBe(false);
    expect(r.body).toBe(ORDINARY_ANSWER);
  });

  it("3: conversation-brain fallback false-applied claim is blocked with empty body", () => {
    const r = applyGoalChangeMachineBodySafety({
      body: FALSE_APPLIED_NOW,
      authorization: unauthorized,
    });
    expect(r.blocked).toBe(true);
    expect(r.body).toBe("");
    expect(r.reason).toBe("false_applied_goal_change_claim");
  });

  it("4: conversation-brain fallback ordinary coaching is unchanged", () => {
    const r = applyGoalChangeMachineBodySafety({
      body: ORDINARY_COACHING,
      authorization: unauthorized,
    });
    expect(r.blocked).toBe(false);
    expect(r.body).toBe(ORDINARY_COACHING);
  });

  it("5: central pivot binding question without pending is blocked with empty body", () => {
    const r = applyGoalChangeMachineBodySafety({ body: BINDING, authorization: unauthorized });
    expect(r.blocked).toBe(true);
    expect(r.body).toBe("");
    expect(r.reason).toBe("unauthorized_binding_goal_change_confirmation");
  });

  it("6: central pivot ordinary prose is unchanged", () => {
    const r = applyGoalChangeMachineBodySafety({
      body: ORDINARY_PIVOT,
      authorization: unauthorized,
    });
    expect(r.blocked).toBe(false);
    expect(r.body).toBe(ORDINARY_PIVOT);
  });

  it("7: arc clarify false-applied after bare Yes is blocked with empty body", () => {
    const r = applyGoalChangeMachineBodySafety({
      body: FALSE_APPLIED_GOING_FORWARD,
      authorization: unauthorized,
    });
    expect(r.blocked).toBe(true);
    expect(r.body).toBe("");
    expect(r.reason).toBe("false_applied_goal_change_claim");
  });

  it("8: arc clarify ordinary clarification is unchanged", () => {
    const r = applyGoalChangeMachineBodySafety({
      body: ORDINARY_CLARIFY,
      authorization: unauthorized,
    });
    expect(r.blocked).toBe(false);
    expect(r.body).toBe(ORDINARY_CLARIFY);
  });
});
