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

import { isLikelyCommitmentChangeIntentTurn } from "@/lib/v2-sms-conversation-brain-eligibility";
import { isInboundSolMainCoachingBranch } from "@/lib/inbound-sol-relationship-turn";
import { extractCandidateBarsFromSms } from "@/lib/v2-sms-commitment-change";

const ROOT = process.cwd();
const ROUTE = path.join(ROOT, "src/app/api/cron/sms-inbound-coach/route.ts");
const PENDING_OPEN = path.join(ROOT, "src/lib/sol-goal-change-pending-open.ts");
const LEFTOVER = path.join(ROOT, "src/lib/v2-sms-pending-resolution-complete.ts");

describe("Slice 6 — dead saved Goal Change routing retired", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const pendingOpen = fs.readFileSync(PENDING_OPEN, "utf8");
  const leftover = fs.readFileSync(LEFTOVER, "utf8");

  const pendingFnStart = src.indexOf("async function processV2SmsInboundPendingResolution");
  const pendingBlock = src.slice(
    pendingFnStart,
    src.indexOf("async function processV2CoachingRefreshInbound")
  );
  const normalStart = src.indexOf("async function processV2NormalInboundOutcome");
  const normalBlock = src.slice(
    normalStart,
    src.indexOf("async function processV2BlockerCapture")
  );

  it("1: persistCommitmentChangeHandoffLaneAndSend is no longer production-defined or called", () => {
    expect(src).not.toContain("persistCommitmentChangeHandoffLaneAndSend");
  });

  it("2: dead first-turn Wave4 block is gone", () => {
    expect(src).not.toContain("if (openCommitmentChangeHandoff && !plannedInterruptionActionable)");
    expect(normalBlock).not.toContain("await applyWave4SmsCommitmentPendingResolution");
    expect(normalBlock).not.toContain("deriveSmsCommitmentChangeIntent");
    expect(src).not.toContain("legacyOpenCommitmentChangeHandoff");
    expect(src).not.toContain("evaluateTuGoalChangePendingHandoff");
    expect(src).not.toContain("shouldOpenCommitmentChangeHandoff");
  });

  it("3: openCommitmentChangeHandoff live routing variable is gone", () => {
    expect(src).not.toMatch(/\bopenCommitmentChangeHandoff\b/);
    expect(src).toContain("const normalInboundV3OwnershipEligible = !isInboundTransactionalException;");
  });

  it("4: phrase heuristics cannot open saved-replace pending", () => {
    expect(isLikelyCommitmentChangeIntentTurn("I want to change my goal to 10:30")).toBe(true);
    expect(extractCandidateBarsFromSms("I want to change my goal to 10:30").candidateNewBar).toBe(
      "10:30"
    );
    expect(normalBlock).not.toContain("applyWave4SmsCommitmentPendingResolution");
    expect(normalBlock).toContain("await runSolGoalChangePendingOpenForInbound");
    expect(pendingOpen).toContain("applyWave4SmsCommitmentPendingResolution");
  });

  it("5: saved replace awaiting_candidate reaches Sol hallway before leftover", () => {
    const slice3 = pendingBlock.indexOf("await runSolGoalChangePendingConfirmForInbound");
    const hallway = pendingBlock.indexOf("await runSolGoalChangeAwaitingCandidateForInbound");
    const leftoverCall = pendingBlock.indexOf("await tryHandleSmsInboundPendingResolution");
    expect(hallway).toBeGreaterThan(slice3);
    expect(leftoverCall).toBeGreaterThan(hallway);
    expect(pendingBlock).toContain("sendSolGoalChangeAwaitingCandidateInboundReply");
  });

  it("6: saved replace awaiting_confirmation reaches Slice 3 before leftover", () => {
    const slice3 = pendingBlock.indexOf("await runSolGoalChangePendingConfirmForInbound");
    const leftoverCall = pendingBlock.indexOf("await tryHandleSmsInboundPendingResolution");
    expect(slice3).toBeGreaterThan(0);
    expect(leftoverCall).toBeGreaterThan(slice3);
    expect(pendingBlock).toContain("sendSolGoalChangePendingConfirmInboundReply");
  });

  it("7–8: leftover saved-replace synonym confirmation and candidate AI are unreachable", () => {
    const handleStart = leftover.indexOf("export async function tryHandleSmsInboundPendingResolution");
    const replaceExit = leftover.indexOf(
      "Slice 6: leftover does not own saved-replace English.",
      handleStart
    );
    const synonym = leftover.indexOf("const conf = parseSmsConfirmation(rawFull);", handleStart);
    const aiCall = leftover.indexOf("await tryExtractV2SmsPendingResolutionCandidateAi", handleStart);
    expect(handleStart).toBeGreaterThan(0);
    expect(replaceExit).toBeGreaterThan(handleStart);
    expect(synonym).toBeGreaterThan(replaceExit);
    expect(aiCall).toBeGreaterThan(replaceExit);
    expect(leftover).toContain("return { handled: false };");
  });

  it("9: leftover V3 saved-replace writer is unreachable for healthy replace", () => {
    expect(src).not.toContain("persistCommitmentChangeHandoffLaneAndSend");
    expect(src).not.toContain("buildCommitmentChangeInboundFactsFromWave4");
    expect(pendingBlock).toContain("sendDegenerateSavedReplacePendingSafetyReply");
    const leftoverCall = pendingBlock.indexOf("await tryHandleSmsInboundPendingResolution");
    const degenerate = pendingBlock.indexOf("sendDegenerateSavedReplacePendingSafetyReply");
    expect(degenerate).toBeGreaterThan(0);
    expect(degenerate).toBeLessThan(leftoverCall);
  });

  it("10: leftover tighten path still exists after the saved-replace early exit", () => {
    expect(leftover).toContain('kind === "commitment_tighten"');
    expect(leftover).toContain("applySmsTightenMutation");
    expect(leftover).toContain("payload.sol_temporary_overlay === true");
    expect(pendingBlock).toContain("await tryHandleSmsInboundPendingResolution");
  });

  it("tagged temp awaiting_confirmation has exclusive confirm owner before leftover", () => {
    const hallway = pendingBlock.indexOf("await runSolGoalChangeAwaitingCandidateForInbound");
    const confirm = pendingBlock.indexOf("await runSolTemporaryOverlayConfirmForInbound");
    const leftoverCall = pendingBlock.indexOf("await tryHandleSmsInboundPendingResolution");
    expect(confirm).toBeGreaterThan(hallway);
    expect(leftoverCall).toBeGreaterThan(confirm);
    expect(pendingBlock).toContain("sendSolTemporaryOverlayConfirmInboundReply");
    expect(pendingBlock).toContain("isSolOwnedTemporaryOverlayPending");
    expect(pendingBlock).not.toContain("runSolTemporaryOverlayHoldingForInbound");
  });

  it("Sol pending-open still uses the Wave4-named structural writer helper", () => {
    expect(pendingOpen).toContain("applyWave4SmsCommitmentPendingResolution");
    expect(pendingOpen).toContain('intent: "sms_replace_request"');
    expect(src).not.toContain("await applyWave4SmsCommitmentPendingResolution");
  });

  it("phrase heuristics still cannot suppress Sol", () => {
    expect(src).toContain("const commitmentChangeHeuristicContext = false");
    expect(
      isInboundSolMainCoachingBranch({
        normalInboundV3OwnershipEligible: true,
        relationshipExitLaneActive: false,
        identityEditLaneActive: false,
        commitmentChangeHeuristicContext: true,
        conversationBrainControlTurnActive: false,
      })
    ).toBe(true);
    expect(src).not.toContain("buildCommitmentChangeContextFactsForHeuristicInbound");
  });

  it("collision fences remain fence-only", () => {
    expect(src).toContain("isLikelyCommitmentChangeIntentTurn");
    expect(normalBlock).not.toContain("await applyWave4SmsCommitmentPendingResolution");
    expect(src).not.toContain("persistCommitmentChangeHandoffLaneAndSend");
  });

  it("gated commitment_change_handoff remains as a no-score mode, not a writer", () => {
    expect(src).toContain('"commitment_change_handoff"');
    expect(src).not.toContain("persistCommitmentChangeHandoffLaneAndSend");
    expect(src).not.toContain("openCommitmentChangeHandoff");
  });

  it("body safety remains on Sol owned pending replies and remaining V3 writers", () => {
    expect(src).toContain("applyGoalChangeMachineBodySafety");
    expect(src).toMatch(/guardedOpen|guardedCb|guardedPivot|guardedArc|guardedV3|guardedFallback/);
  });
});
