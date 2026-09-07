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
const AWAITING = path.join(process.cwd(), "src/lib/sol-goal-change-awaiting-candidate.ts");
const LEFTOVER = path.join(process.cwd(), "src/lib/v2-sms-pending-resolution-complete.ts");
const OPEN = path.join(process.cwd(), "src/lib/sol-goal-change-pending-open.ts");
const GUARD = path.join(process.cwd(), "src/lib/sol-goal-change-confirmation-guard.ts");

describe("Slice 5 Turn-2 Sol-owned awaiting-candidate seam", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const awaiting = fs.readFileSync(AWAITING, "utf8");
  const leftover = fs.readFileSync(LEFTOVER, "utf8");
  const open = fs.readFileSync(OPEN, "utf8");
  const guard = fs.readFileSync(GUARD, "utf8");

  const pendingFnStart = src.indexOf("async function processV2SmsInboundPendingResolution");
  const pendingBlock = src.slice(
    pendingFnStart,
    src.indexOf("async function processV2CoachingRefreshInbound")
  );

  it("owns replace awaiting_candidate after Slice 3 and before leftover", () => {
    const slice3 = pendingBlock.indexOf("await runSolGoalChangePendingConfirmForInbound");
    const hallway = pendingBlock.indexOf("await runSolGoalChangeAwaitingCandidateForInbound");
    const leftoverCall = pendingBlock.indexOf("await tryHandleSmsInboundPendingResolution");
    expect(slice3).toBeGreaterThan(0);
    expect(hallway).toBeGreaterThan(slice3);
    expect(leftoverCall).toBeGreaterThan(hallway);
    const between = pendingBlock.slice(hallway, leftoverCall);
    expect(between).toContain("if (hallway.handled)");
    expect(between).toContain("sendSolGoalChangeAwaitingCandidateInboundReply");
    expect(between).toContain("return true");
    expect(between).not.toContain("tryHandleSmsInboundPendingResolution");
  });

  it("Turn 2 visible writer is Sol, not V3", () => {
    const ownedStart = src.indexOf("async function sendSolGoalChangeOwnedPendingInboundReply");
    const ownedBlock = src.slice(
      ownedStart,
      src.indexOf("async function sendSolGoalChangePendingConfirmInboundReply")
    );
    expect(ownedBlock).toContain("runInboundSolRelationshipTurn");
    expect(ownedBlock).toContain("exclusiveLaneOwnsTurn: true");
    expect(ownedBlock).not.toContain("persistInboundV3RelationshipLaneReplyReadyAndSend");
    expect(src).toContain('decisionReason: "sol_goal_change_awaiting_candidate"');
    expect(src).toContain("sendSolGoalChangeAwaitingCandidateInboundReply");
    expect(src).not.toMatch(
      /sendSolGoalChangeAwaitingCandidateInboundReply[\s\S]{0,800}persistInboundV3RelationshipLaneReplyReadyAndSend/
    );
  });

  it("Turn 1 Sol writer remains Sol after pending-open", () => {
    const fnStart = src.indexOf("async function processV2NormalInboundOutcome");
    const openIdx = src.indexOf("await runSolGoalChangePendingOpenForInbound", fnStart);
    const solIdx = src.indexOf("await runInboundSolRelationshipTurn", fnStart);
    expect(solIdx).toBeGreaterThan(openIdx);
  });

  it("Sol interpreter is the Turn 2 English brain; leftover candidate AI is not imported", () => {
    expect(awaiting).toContain("runSolGoalChangeSemanticInterpreter");
    expect(awaiting).toContain("isSolGoalChangeClockOnlyFragment");
    expect(awaiting).not.toContain("tryExtractV2SmsPendingResolutionCandidateAi");
    expect(awaiting).not.toContain("looksLikeCancellation");
    expect(awaiting).not.toContain("extractAwaitingCandidateHallwayBar");
    expect(awaiting).not.toContain("parseSmsConfirmation");
    expect(leftover).toContain("tryExtractV2SmsPendingResolutionCandidateAi");
    expect(leftover).toContain("sol_owned_awaiting_candidate_shell");
    expect(leftover).toContain("openedAsAwaitingCandidateShell === true");
  });

  it("exact clock structural helper is the only code-owned Turn 2 exception", () => {
    expect(awaiting).toContain("isSolGoalChangeClockOnlyFragment(inbound)");
    expect(awaiting).toContain("trySubstituteClockFragmentIntoCanonical");
    expect(awaiting).toContain("interpreter_invoked: false");
    expect(awaiting).toContain("Code must not interpret natural-language Turn 2.");
  });

  it("awaiting_candidate writer-fail fallback is elicitation, confirmable fallback is preserved", () => {
    expect(guard).toContain("AUTHORIZED_AWAITING_CANDIDATE_ELICITATION_ASK");
    expect(guard).toContain("What do you want your new goal to be?");
    expect(guard).toContain('pending_state === "awaiting_confirmation"');
    expect(guard).toContain('pending_state === "awaiting_candidate"');
    expect(open).toContain("isStructuralIncompleteReplacementCandidate");
    expect(open).toContain("incomplete_replacement_fragment");
    expect(src).toContain("tryBuildAuthorizedGoalChangeWriterFailureFallback");
    expect(src).toContain("buildSolGoalChangePendingConfirmFallbackBody");
  });

  it("does not apply on Turn 2", () => {
    expect(awaiting).not.toContain("applyCanonicalGoalChangeWithSeasonMutation");
    expect(awaiting).toContain("Turn 2 never applies");
  });
});
