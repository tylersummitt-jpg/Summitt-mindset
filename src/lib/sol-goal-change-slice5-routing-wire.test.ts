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

import { extractCandidateBarsFromSms } from "@/lib/v2-sms-commitment-change";
import { isLikelyCommitmentChangeIntentTurn } from "@/lib/v2-sms-conversation-brain-eligibility";
import {
  isInboundSolMainCoachingBranch,
  isLikelyInboundSolMainBeforeHandoff,
} from "@/lib/inbound-sol-relationship-turn";
import {
  detectSmsRelationshipExitIntent,
  isRelationshipExitLaneActive,
  shouldDeferRelationshipExitToGoalHandoff,
} from "@/lib/sms-relationship-exit-intent";
import { trySubstituteClockFragmentIntoCanonical } from "@/lib/sol-goal-change-pending-open";

const ROOT = process.cwd();
const ROUTE = path.join(ROOT, "src/app/api/cron/sms-inbound-coach/route.ts");
const PENDING_OPEN = path.join(ROOT, "src/lib/sol-goal-change-pending-open.ts");
const PENDING_CONFIRM = path.join(ROOT, "src/lib/sol-goal-change-pending-confirm.ts");
const SOL_TURN = path.join(ROOT, "src/lib/inbound-sol-relationship-turn.ts");

const ANGELA_CANONICAL = "I will be in bed by 9:30 pm nightly.";
const ANGELA_NORMALIZED = "I will be in bed by 10:30 pm nightly.";

const EQUIVALENT_SAVED_CHANGE = [
  "I want to change my goal to 10:30",
  "I need to revise my goal to 10:30",
  "I want to adjust my goal to 10:30",
  "This goal isn't realistic. Make it 10:30.",
  "I need a different target. 10:30.",
] as const;

describe("Slice 5 first-turn Goal Change routing", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const pendingOpen = fs.readFileSync(PENDING_OPEN, "utf8");
  const pendingConfirm = fs.readFileSync(PENDING_CONFIRM, "utf8");
  const turn = fs.readFileSync(SOL_TURN, "utf8");

  it("1–2: heuristic-true change and heuristic-false revise both reach Sol pending-open; Wave4 is not first", () => {
    expect(isLikelyCommitmentChangeIntentTurn("I want to change my goal to 10:30")).toBe(true);
    expect(isLikelyCommitmentChangeIntentTurn("I need to revise my goal to 10:30")).toBe(false);

    const fnStart = src.indexOf("async function processV2NormalInboundOutcome");
    const suppressIdx = src.indexOf("const openCommitmentChangeHandoff = false", fnStart);
    const wave4If = src.indexOf(
      "if (openCommitmentChangeHandoff && !plannedInterruptionActionable)",
      fnStart
    );
    const openIdx = src.indexOf("await runSolGoalChangePendingOpenForInbound", fnStart);
    const solIdx = src.indexOf("await runInboundSolRelationshipTurn", fnStart);
    expect(suppressIdx).toBeGreaterThan(fnStart);
    expect(wave4If).toBeGreaterThan(suppressIdx);
    expect(openIdx).toBeGreaterThan(wave4If);
    expect(solIdx).toBeGreaterThan(openIdx);

    const wave4Block = src.slice(wave4If, openIdx);
    expect(wave4Block).not.toContain("runSolGoalChangePendingOpenForInbound");
    expect(src).toContain("const commitmentChangeHeuristicContext = false");
  });

  it("3: equivalent saved-change English converges on the same pending-open seam", () => {
    for (const inbound of EQUIVALENT_SAVED_CHANGE) {
      expect(src).toContain("await runSolGoalChangePendingOpenForInbound");
      expect(
        isInboundSolMainCoachingBranch({
          normalInboundV3OwnershipEligible: true,
          relationshipExitLaneActive: false,
          identityEditLaneActive: false,
          commitmentChangeHeuristicContext: isLikelyCommitmentChangeIntentTurn(inbound),
          conversationBrainControlTurnActive: false,
        })
      ).toBe(true);
      expect(
        isLikelyInboundSolMainBeforeHandoff({
          relationshipExitLaneActive: false,
          identityEditLaneActive: false,
          commitmentChangeIntentLikely: isLikelyCommitmentChangeIntentTurn(inbound),
          conversationBrainControlTurnActive: false,
        })
      ).toBe(true);
    }
  });

  it("4: Wave4 first-turn saved-replace state writer is not invoked first", () => {
    const fnStart = src.indexOf("async function processV2NormalInboundOutcome");
    expect(src).toContain("const openCommitmentChangeHandoff = false");
    expect(src).toContain("legacy_wave4_handoff_suppressed");
    const openIdx = src.indexOf("await runSolGoalChangePendingOpenForInbound", fnStart);
    const persistIdx = src.indexOf("await persistCommitmentChangeHandoffLaneAndSend", fnStart);
    expect(persistIdx).toBeGreaterThan(openIdx);
    expect(pendingOpen).toContain("runSolGoalChangeSemanticInterpreter");
    expect(pendingOpen).toContain("applyWave4SmsCommitmentPendingResolution");
  });

  it("5: existing pending remains exclusive Slice 3; pending-open must not duplicate", () => {
    const handleStart = src.indexOf("async function handleV2SmsInboundCoachJob");
    const pendingIdx = src.indexOf("await processV2SmsInboundPendingResolution", handleStart);
    const normalIdx = src.indexOf("await processV2NormalInboundOutcome", handleStart);
    expect(pendingIdx).toBeGreaterThan(handleStart);
    expect(normalIdx).toBeGreaterThan(pendingIdx);
    expect(src).toContain("runSolGoalChangePendingConfirmForInbound");
    expect(pendingOpen).toContain('pending_skip_reason: "existing_pending"');
    expect(pendingConfirm).toContain("applyCanonicalGoalChangeWithSeasonMutation");
    expect(src).not.toContain("applyCanonicalGoalChangeWithSeasonMutation");
    expect(src).toContain("runSolGoalChangeAwaitingCandidateForInbound");
  });

  it("7: PI + saved replace still reaches Sol semantic interpretation", () => {
    const openIdx = src.indexOf("await runSolGoalChangePendingOpenForInbound");
    const call = src.slice(openIdx, openIdx + 500);
    expect(call).toContain("plannedInterruptionKnown: plannedInterruptionActionable");
    expect(pendingOpen).toContain("plannedInterruptionKnown");
    expect(pendingOpen).toContain("Planned interruption must not");
  });

  it("8: STOP / identity / relationship-exit retain ownership ahead of Sol pending-open", () => {
    const handleStart = src.indexOf("async function handleV2SmsInboundCoachJob");
    const safetyIdx = src.indexOf("processInboundSmsSafetyShortCircuit", handleStart);
    const pendingIdx = src.indexOf("await processV2SmsInboundPendingResolution", handleStart);
    const normalIdx = src.indexOf("await processV2NormalInboundOutcome", handleStart);
    expect(safetyIdx).toBeGreaterThan(handleStart);
    expect(pendingIdx).toBeGreaterThan(safetyIdx);
    expect(normalIdx).toBeGreaterThan(pendingIdx);

    const fnStart = src.indexOf("async function processV2NormalInboundOutcome");
    const identityIdx = src.indexOf("identityEditLaneActive", fnStart);
    const exclusiveSkip = src.indexOf(
      "if (relationshipExitLaneActive || identityEditLaneActive)",
      fnStart
    );
    const openIdx = src.indexOf("await runSolGoalChangePendingOpenForInbound", fnStart);
    expect(identityIdx).toBeGreaterThan(fnStart);
    expect(exclusiveSkip).toBeGreaterThan(identityIdx);
    expect(openIdx).toBeGreaterThan(exclusiveSkip);
    expect(src).toContain("[sol-goal-change-pending-open] skipped_exclusive_lane");
    expect(src).toContain("detectSmsRelationshipExitIntent");
    expect(src).toContain("isIdentityEditLaneActive");
    expect(turn).toContain("!args.relationshipExitLaneActive");
    expect(turn).toContain("!args.identityEditLaneActive");
  });

  it("Sol-owned awaiting_candidate hallway reuses Wave4 write helper after Sol, not Wave4 English", () => {
    expect(pendingOpen).toContain("shouldAttemptSolSavedReplaceAwaitingCandidateHallway");
    expect(pendingOpen).toContain("openedAsAwaitingCandidateShell: true");
    expect(pendingOpen).toContain('intent: "sms_replace_request"');
    expect(pendingOpen).toContain("New first-turn Wave4 tighten/raise-bar English is intentionally NOT restored");
    expect(src).toContain("const openCommitmentChangeHandoff = false");
    expect(src).not.toMatch(
      /openCommitmentChangeHandoff\s*=\s*legacyOpenCommitmentChangeHandoff/
    );
  });

  it("writer-failure after confirmable pending may render proven pending, not regex English", () => {
    expect(src).toContain("tryBuildAuthorizedGoalChangeWriterFailureFallback");
    expect(src).toContain("inbound_sol_main_pending_ask_fallback");
    const fnStart = src.indexOf("async function processV2NormalInboundOutcome");
    const noSend = src.indexOf("inbound_sol_main_no_send", fnStart);
    const fallback = src.indexOf("tryBuildAuthorizedGoalChangeWriterFailureFallback", fnStart);
    expect(fallback).toBeGreaterThan(fnStart);
    expect(fallback).toBeLessThan(noSend);
  });
});

describe("Slice 5 change vs revise / fragment / collision canaries", () => {
  it("legacy Wave4 extraction can still produce a 10:30 fragment — Slice 5 must not use that first", () => {
    const extracted = extractCandidateBarsFromSms("I want to change my goal to 10:30");
    expect(extracted.candidateNewBar).toBe("10:30");
    expect(trySubstituteClockFragmentIntoCanonical(ANGELA_CANONICAL, "10:30")).toBe(
      ANGELA_NORMALIZED
    );
  });

  it("non-Goal-Change turns are not phrase-routed into Wave4 pending", () => {
    for (const inbound of [
      "Had a great workout",
      "Thanks Coach",
      "I'm struggling today",
      "I'm traveling tonight",
    ]) {
      expect(isLikelyCommitmentChangeIntentTurn(inbound)).toBe(false);
    }
    expect(isLikelyCommitmentChangeIntentTurn("STOP")).toBe(false);
  });

  it("new first-turn Wave4 tighten is intentionally not restored; overlay remains live elsewhere", () => {
    const src = fs.readFileSync(ROUTE, "utf8");
    const pendingOpen = fs.readFileSync(PENDING_OPEN, "utf8");
    expect(src).toContain("const openCommitmentChangeHandoff = false");
    expect(pendingOpen).toContain(
      "New first-turn Wave4 tighten/raise-bar English is intentionally NOT restored"
    );
    expect(pendingOpen).toContain("Overlay remains live via adaptive / guided / refresh / predeploy tighten pending");
  });

  it("goal abandonment defers to normal coaching; app exit does not", () => {
    const doneGoal = detectSmsRelationshipExitIntent("I'm done with this goal");
    const doneApp = detectSmsRelationshipExitIntent("I'm done with this app");

    expect(doneGoal.goalAbandonment).toBe(true);
    expect(
      shouldDeferRelationshipExitToGoalHandoff({
        detection: doneGoal,
        plannedInterruptionActionable: false,
      })
    ).toBe(true);

    expect(doneApp.goalAbandonment).toBe(false);
    expect(doneApp.detected).toBe(true);
    expect(
      shouldDeferRelationshipExitToGoalHandoff({
        detection: doneApp,
        plannedInterruptionActionable: false,
      })
    ).toBe(false);
  });

  it("exclusive lanes skip pending-open; goal-only abandonment still reaches it; PI does not skip", () => {
    const src = fs.readFileSync(ROUTE, "utf8");
    const fnStart = src.indexOf("async function processV2NormalInboundOutcome");
    const exclusiveSkip = src.indexOf(
      "if (relationshipExitLaneActive || identityEditLaneActive)",
      fnStart
    );
    const openIdx = src.indexOf("await runSolGoalChangePendingOpenForInbound", fnStart);
    expect(exclusiveSkip).toBeGreaterThan(fnStart);
    expect(openIdx).toBeGreaterThan(exclusiveSkip);
    const skipBlock = src.slice(exclusiveSkip, openIdx);
    expect(skipBlock).toContain("skipped_exclusive_lane");
    expect(skipBlock).not.toContain("plannedInterruptionActionable");
    const call = src.slice(openIdx, openIdx + 500);
    expect(call).toContain("plannedInterruptionKnown: plannedInterruptionActionable");

    const doneGoal = detectSmsRelationshipExitIntent("I'm done with this goal.");
    expect(
      shouldDeferRelationshipExitToGoalHandoff({
        detection: doneGoal,
        plannedInterruptionActionable: false,
      })
    ).toBe(true);
    expect(
      isRelationshipExitLaneActive({
        detection: doneGoal,
        deferToGoalHandoff: true,
      })
    ).toBe(false);

    const mixed = detectSmsRelationshipExitIntent(
      "I'm done with this goal and I'm done with this app."
    );
    expect(
      isRelationshipExitLaneActive({
        detection: mixed,
        deferToGoalHandoff: false,
      })
    ).toBe(true);

    const billing = detectSmsRelationshipExitIntent(
      "Cancel my membership and change my goal."
    );
    expect(billing.category).toBe("subscription_billing");
    expect(
      isRelationshipExitLaneActive({
        detection: billing,
        deferToGoalHandoff: false,
      })
    ).toBe(true);

    const stopTexting = detectSmsRelationshipExitIntent(
      "Stop texting me and change my goal."
    );
    expect(stopTexting.category).toBe("texting_soft_opt_out");
    expect(
      isRelationshipExitLaneActive({
        detection: stopTexting,
        deferToGoalHandoff: false,
      })
    ).toBe(true);
  });
});
