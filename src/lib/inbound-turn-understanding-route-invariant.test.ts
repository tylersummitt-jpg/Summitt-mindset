import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");
const DAILY_ROUTE = path.join(process.cwd(), "src/app/api/cron/daily-sms/route.ts");
const WEEKLY_ROUTE = path.join(process.cwd(), "src/app/api/cron/weekly-sms/route.ts");

describe("inbound turn understanding route invariants", () => {
  const src = fs.readFileSync(ROUTE, "utf8");

  it("every tryPersist passes turnUnderstandingContext", () => {
    const calls = [...src.matchAll(/tryPersistInboundAccountabilityOutcomeBeforeSend\(\{[\s\S]*?\}\);/g)];
    expect(calls.length).toBeGreaterThanOrEqual(8);
    for (const m of calls) {
      const hasTuContext =
        m[0].includes("turnUnderstandingContext:") ||
        (m[0].includes("...args") &&
          src.includes("async function attemptPreWriterExplicitOutcomePersist"));
      expect(hasTuContext).toBe(true);
    }
  });

  it("main path runs unified final product-law guard before persisting reply body", () => {
    const idx = src.indexOf("const finalGuardsMain = await applyUnifiedSmsFinalProductLawGuard");
    expect(idx).toBeGreaterThan(0);
    const block = src.slice(idx, idx + 12000);
    expect(block).toContain("finalReplyBody = finalGuardsMain.body");
    const replyBodyIdx = block.indexOf("reply_body:");
    if (replyBodyIdx >= 0) {
      expect(block.indexOf("finalGuardsMain")).toBeLessThan(replyBodyIdx);
    }
  });

  it("final guard no-send paths persist explicit outcomes before cancel", () => {
    expect(src).toContain("persistExplicitOutcomeBeforeReplyNoSend");
    expect(src).toContain("buildExplicitOutcomeBeforeNoSendTelemetry");
    const mainBlock = src.slice(
      src.indexOf("if (!finalGuardsMain.shouldSend)"),
      src.indexOf("if (!finalGuardsMain.shouldSend)") + 1200
    );
    expect(mainBlock).toContain("persistExplicitOutcomeBeforeReplyNoSend");
  });

  it("lane no-send paths persist explicit outcomes before cancel", () => {
    expect(src).toContain("cancelInboundV3LaneNoSendWithExplicitOutcomePersist");
    expect(src).toContain("lane_no_send_before_final_guard");

    const mainLaneIdx = src.indexOf('logKey: "inbound_relationship_lane_no_send"');
    expect(mainLaneIdx).toBeGreaterThan(0);
    const mainLaneBlock = src.slice(mainLaneIdx - 800, mainLaneIdx + 200);
    expect(mainLaneBlock).toContain("cancelInboundV3LaneNoSendWithExplicitOutcomePersist");

    const oqIdx = src.indexOf('logKey: "open_question_inbound_relationship_lane_no_send"');
    expect(oqIdx).toBeGreaterThan(0);
    const oqBlock = src.slice(oqIdx - 800, oqIdx + 200);
    expect(oqBlock).toContain("cancelInboundV3LaneNoSendWithExplicitOutcomePersist");
  });

  it("main path attempts pre-writer persist before inbound lane writer", () => {
    const mainPreWriterIdx = src.indexOf('const preWriterTelemetryMain = await attemptPreWriterExplicitOutcomePersist({');
    expect(mainPreWriterIdx).toBeGreaterThan(0);
    const block = src.slice(mainPreWriterIdx, mainPreWriterIdx + 1200);
    expect(block).toContain('branch: "main"');
    expect(block).toContain("produceInboundV3RelationshipSms");
    expect(block.indexOf("produceInboundV3RelationshipSms")).toBeGreaterThan(
      block.indexOf("attemptPreWriterExplicitOutcomePersist")
    );
    expect(block).toContain("preWriterTelemetryMain");
  });

  it("main lane cancel merges pre-writer telemetry into last_error", () => {
    const idx = src.indexOf("preWriterTelemetry: preWriterTelemetryMain");
    expect(idx).toBeGreaterThan(0);
    const helperIdx = src.indexOf("preWriterTelemetry?: Record<string, unknown> | null");
    expect(helperIdx).toBeGreaterThan(0);
    const helperBlock = src.slice(helperIdx, helperIdx + 900);
    expect(helperBlock).toContain("...(args.preWriterTelemetry ?? {})");
  });

  it("open question FVG-only no-send persists explicit outcome before cancel", () => {
    const warnIdx = src.indexOf("v3_open_question_final_voice_suppressed");
    expect(warnIdx).toBeGreaterThan(0);
    const block = src.slice(warnIdx - 2200, warnIdx + 200);
    expect(block).toContain("persistExplicitOutcomeBeforeReplyNoSend");
    expect(block).toContain("final_voice_gate_no_send");
    expect(block).toContain("markJobFinal");
  });

  it("G: open-question path uses applyUnifiedSmsFinalProductLawGuard", () => {
    expect(src).toContain("const finalGuardsOq = await applyUnifiedSmsFinalProductLawGuard");
    expect(src).not.toContain("const finalGuardsOq = await applyInboundCoachFinalBodyGuards");
  });

  it("H/I/J/K: central pivot, arc, legacy fallback use unified guard", () => {
    expect(src).toContain("const finalGuardsPivot = await applyUnifiedSmsFinalProductLawGuard");
    expect(src).toContain("const finalGuardsArc = await applyUnifiedSmsFinalProductLawGuard");
    expect(src).toContain("const finalGuardsLegacy = await applyUnifiedSmsFinalProductLawGuard");
    expect(src).not.toMatch(/const finalGuardsPivot = await applyInboundCoachFinalBodyGuards/);
    expect(src).not.toMatch(/const finalGuardsArc = await applyInboundCoachFinalBodyGuards/);
    expect(src).not.toMatch(/const finalGuardsLegacy = await applyInboundCoachFinalBodyGuards/);
  });

  it("legacy fallback path runs unified guard before reply_ready and send", () => {
    const idx = src.indexOf("const finalGuardsLegacy = await applyUnifiedSmsFinalProductLawGuard");
    expect(idx).toBeGreaterThan(0);
    const block = src.slice(idx, idx + 4500);
    expect(block).toContain("legacyFinalBody");
    expect(block).toContain('status: "reply_ready"');
  });

  it("L: PR 2.1b-pr2a/pr2b wires memory confirmation via opt-in helper guard + shared no-send truth", () => {
  const helperBlock = src.slice(
    src.indexOf("type InboundLaneUnifiedFinalGuardConfig"),
    src.indexOf("async function processV2MemoryConfirmationInbound")
  );
    expect(helperBlock).toContain("if (args.unifiedFinalGuard)");
    expect(helperBlock).toContain("applyUnifiedSmsFinalProductLawGuard");
    expect(helperBlock).toContain("runMemoryConfirmationNoSendTruthPolicyIfConfigured");
    expect(helperBlock).toContain("runPendingResolutionNoSendTruthPolicyIfConfigured");
    expect(src).toContain("memoryNoSendTruthPolicy?: MemoryConfirmationNoSendTruthPolicyContext");

    expect(src).toContain('branch: "ambiguous"');
    expect(src).toContain('branch: "decline"');
    expect(src).toContain('branch: "yes"');

    expect(src).toContain("const unifiedGuardBlockerAck = await applyUnifiedSmsFinalProductLawGuard");
    expect(src).toContain("const unifiedGuardBlockerPivot = await applyUnifiedSmsFinalProductLawGuard");
    expect(src).not.toContain("const nearDupAckGuard = await applyRapidNearDuplicateCoachReplyGuard");
    expect(src).not.toContain("applyRapidNearDuplicateCoachReplyGuard");
  });

  it("M: daily C1 wired; weekly route wired to outbound_weekly", () => {
    expect(src).not.toContain('surface: "daily"');
    expect(src).not.toContain('surface: "weekly"');
    const dailySrc = fs.readFileSync(DAILY_ROUTE, "utf8");
    const weeklySrc = fs.readFileSync(WEEKLY_ROUTE, "utf8");
    expect(dailySrc).toContain('mode: "outbound_daily"');
    expect(dailySrc).toContain("isOutboundDailyWiredRoutePurpose");
    expect(weeklySrc).toContain('mode: "outbound_weekly"');
    expect(weeklySrc).not.toContain('mode: "outbound_daily"');
  });

  it("conversation brain control defers when TU is authoritative", () => {
    expect(src).toContain("isInboundTurnUnderstandingContextAuthoritative(inboundTurnUnderstandingCtx)");
    expect(src).toContain("brain_gate_skipped_turn_understanding_authoritative");
  });

  it("N: Phase 2.2.0 blocker pending runs TU gate before processV2BlockerCapture", () => {
    const start = src.indexOf("if (isBlockerCapturePendingActive(c))");
    expect(start).toBeGreaterThan(0);
    const slice = src.slice(start, start + 5500);
    expect(slice).toContain("runBlockerPendingPreCaptureGate");
    expect(slice).toContain("routeDecision.shouldRunProcessV2BlockerCapture");
    const gateIdx = slice.indexOf("runBlockerPendingPreCaptureGate");
    const captureIdx = slice.indexOf("processV2BlockerCapture");
    expect(gateIdx).toBeGreaterThan(0);
    expect(captureIdx).toBeGreaterThan(gateIdx);
    expect(slice).not.toContain("isStrongV2YesNoOutcome");
  });

  it("O: normal inbound accepts precomputed TU from blocker gate", () => {
    expect(src).toContain("precomputedTurnUnderstandingCtx");
    expect(src).toContain("blockerRouteTelemetry");
    expect(src).toContain("blocker_tu_reused_in_normal_path");
  });

  it("P: refresh/pending/contract/memory ordering unchanged after blocker branch", () => {
    const refreshIdx = src.indexOf("if (await processV2CoachingRefreshInbound");
    const pendingIdx = src.indexOf("if (await processV2SmsInboundPendingResolution");
    const contractIdx = src.indexOf("if (await processV2ContractProposalConsent");
    const memoryIdx = src.indexOf("if (await processV2MemoryConfirmationInbound");
    const blockerBranchEnd = src.indexOf("await clearStaleAdaptiveContractColumns");
    expect(blockerBranchEnd).toBeGreaterThan(0);
    expect(refreshIdx).toBeGreaterThan(blockerBranchEnd);
    expect(pendingIdx).toBeGreaterThan(refreshIdx);
    expect(contractIdx).toBeGreaterThan(pendingIdx);
    expect(memoryIdx).toBeGreaterThan(contractIdx);
  });

  it("Q: Phase 2.2.1 defers non-blocker gate to transactional dispatch before normal", () => {
    expect(src).toContain("deferredBlockerGate");
    expect(src).toContain("blocker_gate_deferred_to_transactional_dispatch");
    expect(src).toContain("logBlockerGateTransactionalHandlerConsumed");
    expect(src).toContain("did_normal_inbound_run_after_blocker_deferral");
    expect(src).toContain("transactional_handler_consumed_after_blocker_gate");

    const start = src.indexOf("if (isBlockerCapturePendingActive(c))");
    expect(start).toBeGreaterThan(0);
    const slice = src.slice(start, start + 4500);
    expect(slice).toContain("deferredBlockerGate = {");
    expect(slice).not.toMatch(
      /deferredBlockerGate[\s\S]{0,1200}await processV2NormalInboundOutcome/
    );

    const refreshIdx = src.indexOf("if (await processV2CoachingRefreshInbound");
    const deferredIdx = src.indexOf("let deferredBlockerGate");
    expect(deferredIdx).toBeGreaterThan(0);
    expect(refreshIdx).toBeGreaterThan(deferredIdx);

    const memoryHandlerIdx = src.indexOf("if (await processV2MemoryConfirmationInbound");
    const finalDeferredNormalIdx = src.indexOf(
      "if (deferredBlockerGate) {\n    const normalCommitment ="
    );
    expect(finalDeferredNormalIdx).toBeGreaterThan(memoryHandlerIdx);
  });

  it("R: Phase 2.1c pending resolution uses opt-in unified guard + pending no-send truth policy", () => {
    expect(src).toContain("persistPendingResolutionTruthOnNoSend");
    expect(src).toContain("runPendingResolutionNoSendTruthPolicyIfConfigured");
    expect(src).toContain("evaluatePostUnifiedGuardPendingTruthRecheck");
    expect(src).toContain("pendingNoSendTruthPolicy");

    const pendingIdx = src.indexOf("async function processV2SmsInboundPendingResolution");
    expect(pendingIdx).toBeGreaterThan(0);
    const pendingBlock = src.slice(
      pendingIdx,
      src.indexOf("async function processV2CoachingRefreshInbound")
    );
    expect(pendingBlock).toContain("unifiedFinalGuard:");
    expect(pendingBlock).toContain('routePurpose: "pending_resolution"');
    expect(pendingBlock).toContain("pendingNoSendTruthPolicy");
  });

  it("S: Phase 2.1d-A1 contract consent uses unified guard + contract no-send truth in ack path", () => {
    expect(src).toContain("persistContractConsentTruthOnNoSend");
    expect(src).toContain("evaluatePostUnifiedGuardContractTruthRecheck");
    expect(src).toContain("buildContractConsentNoSendTruthPolicyContext");

    const contractIdx = src.indexOf("async function runContractConsentNoSendTruthPolicy");
    expect(contractIdx).toBeGreaterThan(0);
    const contractBlock = src.slice(
      contractIdx,
      src.indexOf("async function persistAdaptiveProposalConsentClarificationAndSend")
    );
    expect(contractBlock).toContain("applyUnifiedSmsFinalProductLawGuard");
    expect(contractBlock).toContain("trySendContractConsentBodyAfterUnifiedGuard");
    expect(contractBlock).not.toContain("unifiedFinalGuard:");
  });

  it("T: Phase 2.1d-A2 adaptive clarify uses dedicated unified guard + adaptive post-unified recheck", () => {
    const adaptiveIdx = src.indexOf("async function persistAdaptiveProposalConsentClarificationAndSend");
    expect(adaptiveIdx).toBeGreaterThan(0);
    const adaptiveBlock = src.slice(
      adaptiveIdx,
      src.indexOf("async function persistCommitmentChangeHandoffLaneAndSend")
    );
    expect(adaptiveBlock).toContain("applyUnifiedSmsFinalProductLawGuard");
    expect(adaptiveBlock).toContain("evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck");
    expect(adaptiveBlock).toContain("adaptive_clarify_no_send: true");
    expect(adaptiveBlock).not.toContain("unifiedFinalGuard:");
    expect(adaptiveBlock).not.toContain("persistContractConsentTruthOnNoSend");
  });

  it("U: Phase 2.1e commitment handoff uses dedicated unified guard + handoff no-send truth", () => {
    expect(src).toContain("persistCommitmentHandoffTruthOnNoSend");
    expect(src).toContain("evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck");
    expect(src).toContain("buildCommitmentHandoffNoSendTruthPolicyContext");

    const handoffIdx = src.indexOf("async function persistCommitmentChangeHandoffLaneAndSend");
    expect(handoffIdx).toBeGreaterThan(0);
    const handoffBlock = src.slice(
      handoffIdx,
      src.indexOf("async function handleAdaptiveProposalConsentAmbiguousInbound")
    );
    expect(handoffBlock).toContain("applyUnifiedSmsFinalProductLawGuard");
    expect(handoffBlock).toContain('mode: "transactional_coaching_limited"');
    expect(handoffBlock).toContain("cancelCommitmentHandoffNoSend");
    expect(handoffBlock).not.toContain("unifiedFinalGuard:");
    expect(handoffBlock).not.toContain("persistContractConsentTruthOnNoSend");
    expect(handoffBlock).not.toContain("evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck");
  });
});

describe("Phase 2.1g-B2 normal coaching — engagement-on-no-send cleanup", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const normalFnStart = src.indexOf("async function processV2NormalInboundOutcome");
  const normalFnEnd = src.indexOf("async function processV2BlockerCapture");
  const normalBlock = src.slice(normalFnStart, normalFnEnd);

  it("1: main outcome path does not call engagement inside spineInsertSucceeded before FVG", () => {
    const idx = normalBlock.indexOf("if (spineInsertSucceeded)");
    expect(idx).toBeGreaterThan(-1);
    const fvgIdx = normalBlock.indexOf("if (!finalVoiceGate.shouldSend)", idx);
    const spineBlock = normalBlock.slice(idx, fvgIdx);
    expect(spineBlock).not.toContain("recordV2SendTimeProfileInboundEngagement");
    expect(spineBlock).toContain("maybeLogCentralBrainDisagreement");
  });

  it("2: main non-outcome path does not call engagement before FVG", () => {
    const elseIdx = normalBlock.indexOf("} else {\n    const nonOutcomeNotebook");
    expect(elseIdx).toBeGreaterThan(-1);
    const fvgIdx = normalBlock.indexOf("if (!finalVoiceGate.shouldSend)", elseIdx);
    const elseBlock = normalBlock.slice(elseIdx, fvgIdx);
    expect(elseBlock).not.toContain("recordV2SendTimeProfileInboundEngagement");
  });

  it("3: main FVG no-send block has no engagement", () => {
    const idx = normalBlock.indexOf("if (!finalVoiceGate.shouldSend)");
    const retIdx = normalBlock.indexOf("return;", idx);
    const fvgBlock = normalBlock.slice(idx, retIdx + "return;".length);
    expect(fvgBlock).not.toContain("recordV2SendTimeProfileInboundEngagement");
    expect(fvgBlock).toContain("normal_inbound_final_voice_suppressed");
  });

  it("4: main unified guard no-send path has no engagement", () => {
    const idx = normalBlock.indexOf("if (!finalGuardsMain.shouldSend)");
    const retIdx = normalBlock.indexOf("return;", idx);
    const guardBlock = normalBlock.slice(idx, retIdx + "return;".length);
    expect(guardBlock).not.toContain("recordV2SendTimeProfileInboundEngagement");
    expect(guardBlock).toContain("persistExplicitOutcomeBeforeReplyNoSend");
  });

  it("5: main successful send records engagement after commitAndSend", () => {
    const sendIdx = normalBlock.indexOf(
      "await commitAndSendInboundCoachReply(fresh, userId, inboundV3ThreadMemory)"
    );
    expect(sendIdx).toBeGreaterThan(-1);
    const engIdx = normalBlock.indexOf("recordV2SendTimeProfileInboundEngagement", sendIdx);
    expect(engIdx).toBeGreaterThan(sendIdx);
    expect(engIdx - sendIdx).toBeLessThan(120);
  });

  it("6: main duplicate reply_ready path records engagement after commitAndSend", () => {
    const dupIdx = normalBlock.indexOf(
      "await commitAndSendInboundCoachReply(j2, userId, inboundV3ThreadMemory)"
    );
    expect(dupIdx).toBeGreaterThan(-1);
    const engIdx = normalBlock.indexOf("recordV2SendTimeProfileInboundEngagement", dupIdx);
    expect(engIdx).toBeGreaterThan(dupIdx);
    expect(engIdx - dupIdx).toBeLessThan(120);
  });

  it("7: pivot does not call engagement before commitAndSend", () => {
    const freshPivotIdx = normalBlock.indexOf("const freshPivot = (await loadJob(job.message_sid))");
    const freshSendIdx = normalBlock.indexOf(
      "await commitAndSendInboundRelationshipCoachReply(freshPivot, userId, centralBrainPivotThreadMemoryCtx)",
      freshPivotIdx
    );
    expect(freshPivotIdx).toBeGreaterThan(-1);
    expect(freshSendIdx).toBeGreaterThan(freshPivotIdx);
    expect(normalBlock.slice(freshPivotIdx, freshSendIdx)).not.toContain(
      "recordV2SendTimeProfileInboundEngagement"
    );
  });

  it("8: pivot guard/FVG no-send paths have no engagement", () => {
    const fvgIdx = normalBlock.indexOf("pivot_final_voice_suppressed");
    const fvgBlock = normalBlock.slice(fvgIdx - 600, fvgIdx + 200);
    expect(fvgBlock).not.toContain("recordV2SendTimeProfileInboundEngagement");
    const guardIdx = normalBlock.indexOf("pivot_unified_final_guard_blocked");
    const guardBlock = normalBlock.slice(guardIdx - 600, guardIdx + 200);
    expect(guardBlock).not.toContain("recordV2SendTimeProfileInboundEngagement");
  });

  it("9: pivot successful send records engagement after commitAndSend", () => {
    const sendIdx = normalBlock.indexOf(
      "await commitAndSendInboundRelationshipCoachReply(freshPivot, userId, centralBrainPivotThreadMemoryCtx)"
    );
    expect(sendIdx).toBeGreaterThan(-1);
    const engIdx = normalBlock.indexOf("recordV2SendTimeProfileInboundEngagement", sendIdx);
    expect(engIdx).toBeGreaterThan(sendIdx);
    expect(engIdx - sendIdx).toBeLessThan(120);
  });

  it("10: pivot duplicate reply_ready path records engagement after commitAndSend", () => {
    const sendIdx = normalBlock.indexOf(
      "await commitAndSendInboundRelationshipCoachReply(j2, userId, centralBrainPivotThreadMemoryCtx)"
    );
    expect(sendIdx).toBeGreaterThan(-1);
    const engIdx = normalBlock.indexOf("recordV2SendTimeProfileInboundEngagement", sendIdx);
    expect(engIdx).toBeGreaterThan(sendIdx);
    expect(engIdx - sendIdx).toBeLessThan(120);
  });

  it("11: arc does not call engagement before commitAndSend", () => {
    const freshArcIdx = normalBlock.indexOf("const freshArc = (await loadJob(job.message_sid))");
    const freshSendIdx = normalBlock.indexOf(
      "await commitAndSendInboundRelationshipCoachReply(freshArc, userId, arcClarifyThreadMemoryCtx)",
      freshArcIdx
    );
    expect(freshArcIdx).toBeGreaterThan(-1);
    expect(freshSendIdx).toBeGreaterThan(freshArcIdx);
    expect(normalBlock.slice(freshArcIdx, freshSendIdx)).not.toContain(
      "recordV2SendTimeProfileInboundEngagement"
    );
  });

  it("12: arc guard/FVG no-send paths have no engagement", () => {
    const guardIdx = normalBlock.indexOf("if (!finalGuardsArc.shouldSend)");
    const retIdx = normalBlock.indexOf("return;", guardIdx);
    expect(normalBlock.slice(guardIdx, retIdx + "return;".length)).not.toContain(
      "recordV2SendTimeProfileInboundEngagement"
    );
    const fvgIdx = normalBlock.indexOf("arc_clarify_final_voice_suppressed");
    expect(normalBlock.slice(fvgIdx - 600, fvgIdx + 200)).not.toContain(
      "recordV2SendTimeProfileInboundEngagement"
    );
  });

  it("13: arc successful send records engagement after commitAndSend", () => {
    const sendIdx = normalBlock.indexOf(
      "await commitAndSendInboundRelationshipCoachReply(freshArc, userId, arcClarifyThreadMemoryCtx)"
    );
    expect(sendIdx).toBeGreaterThan(-1);
    const engIdx = normalBlock.indexOf("recordV2SendTimeProfileInboundEngagement", sendIdx);
    expect(engIdx).toBeGreaterThan(sendIdx);
    expect(engIdx - sendIdx).toBeLessThan(120);
  });

  it("14: arc duplicate reply_ready path records engagement after commitAndSend", () => {
    const dupIdx = normalBlock.lastIndexOf(
      "await commitAndSendInboundRelationshipCoachReply(j2, userId, arcClarifyThreadMemoryCtx)"
    );
    expect(dupIdx).toBeGreaterThan(-1);
    const engIdx = normalBlock.indexOf("recordV2SendTimeProfileInboundEngagement", dupIdx);
    expect(engIdx).toBeGreaterThan(dupIdx);
    expect(engIdx - dupIdx).toBeLessThan(120);
  });

  it("15: legacy persistence helper no longer records engagement", () => {
    const helperStart = src.indexOf("const persistConversationBrainLegacyDisabledServerOutcome = async");
    const helperEnd = src.indexOf("if (!cbLaneRes.shouldSend", helperStart);
    const helperBlock = src.slice(helperStart, helperEnd);
    expect(helperBlock).toContain("tryPersistInboundAccountabilityOutcomeBeforeSend");
    expect(helperBlock).not.toContain("recordV2SendTimeProfileInboundEngagement");
  });

  it("16: legacy lane/FVG/guard no-send paths have no engagement", () => {
    const laneIdx = src.indexOf("conversation_brain_legacy_disabled_lane_no_send");
    expect(src.slice(laneIdx - 800, laneIdx + 200)).not.toContain(
      "recordV2SendTimeProfileInboundEngagement"
    );
    const fvgIdx = src.indexOf("legacy_fallback_final_voice_suppressed");
    expect(src.slice(fvgIdx - 800, fvgIdx + 200)).not.toContain(
      "recordV2SendTimeProfileInboundEngagement"
    );
    const guardIdx = src.indexOf("legacy_fallback_final_body_guard_blocked");
    expect(src.slice(guardIdx - 800, guardIdx + 200)).not.toContain(
      "recordV2SendTimeProfileInboundEngagement"
    );
  });

  it("17: legacy successful send records engagement after commitAndSend", () => {
    const sendIdx = src.indexOf(
      "await commitAndSendInboundRelationshipCoachReply(freshFb, userId, legacyFallbackThreadMemoryCtx)"
    );
    expect(sendIdx).toBeGreaterThan(-1);
    const engIdx = src.indexOf("recordV2SendTimeProfileInboundEngagement", sendIdx);
    expect(engIdx).toBeGreaterThan(sendIdx);
    expect(engIdx - sendIdx).toBeLessThan(120);
  });

  it("18: legacy duplicate reply_ready path records engagement after commitAndSend", () => {
    const sendIdx = src.indexOf(
      "await commitAndSendInboundRelationshipCoachReply(jfb, userId, legacyFallbackThreadMemoryCtx)"
    );
    expect(sendIdx).toBeGreaterThan(-1);
    const engIdx = src.indexOf("recordV2SendTimeProfileInboundEngagement", sendIdx);
    expect(engIdx).toBeGreaterThan(sendIdx);
    expect(engIdx - sendIdx).toBeLessThan(120);
  });

  it("19: outcome persistence still present before send where designed", () => {
    expect(normalBlock).toContain("tryPersistInboundAccountabilityOutcomeBeforeSend");
    expect(normalBlock).toContain("persistExplicitOutcomeBeforeReplyNoSend");
    const mainPersistIdx = normalBlock.indexOf('branch: "main"');
    const sendIdx = normalBlock.indexOf("commitAndSendInboundCoachReply(fresh, userId");
    expect(mainPersistIdx).toBeLessThan(sendIdx);
  });

  it("20: recomputeV2CoachingMemory still present where designed", () => {
    const fvgIdx = normalBlock.indexOf("if (!finalVoiceGate.shouldSend)");
    const preFvg = normalBlock.slice(0, fvgIdx);
    expect(preFvg).toContain("recomputeV2CoachingMemory");
    expect(preFvg).toContain('reasonCode: "inbound_user_outcome"');
  });

  it("21: setBlockerCapturePending unchanged before FVG", () => {
    const fvgIdx = normalBlock.indexOf("if (!finalVoiceGate.shouldSend)");
    const preFvg = normalBlock.slice(0, fvgIdx);
    expect(preFvg).toContain("setBlockerCapturePending");
    expect(preFvg).toContain("should_open_blocker_capture");
  });

  it("22: memory/pending g-A behavior unchanged", () => {
    const memoryStart = src.indexOf("async function processV2MemoryConfirmationInbound");
    const memoryBlock = src.slice(memoryStart, src.indexOf("async function processV2SmsInboundPendingResolution"));
    const ambNoSend = memoryBlock.indexOf("if (!sendAmb.ok)");
    expect(memoryBlock.slice(ambNoSend, memoryBlock.indexOf("}", ambNoSend) + 1)).not.toContain(
      "recordV2SendTimeProfileInboundEngagement"
    );
  });

  it("23: contract/blocker B1 behavior unchanged", () => {
    expect(src).toContain("const sendContractYes = await persistContractConsentInboundLaneAckAndSend");
    expect(src).toContain("if (sendContractYes.ok)");
    const blockerFnStart = src.indexOf("async function processV2BlockerCapture");
    const blockerFnEnd = src.indexOf("async function processV2ContractProposalConsent");
    const blockerBlock = src.slice(blockerFnStart, blockerFnEnd);
    expect(blockerBlock).toContain("if (visibleSent)");
  });

  it("24: refresh B1/B2 behavior unchanged", () => {
    const refreshIdx = src.indexOf('laneIntent: "commitment_keep_ack"');
    const keepSlice = src.slice(refreshIdx, refreshIdx + 2500);
    const noSendReturn = keepSlice.indexOf("if (!sendKeep.ok)");
    expect(keepSlice.slice(0, noSendReturn)).not.toContain("recordV2SendTimeProfileInboundEngagement");
  });

  it("25: handoff behavior unchanged", () => {
    const handoffIdx = src.indexOf("async function persistCommitmentChangeHandoffLaneAndSend");
    expect(handoffIdx).toBeGreaterThan(-1);
    const handoffEnd = src.indexOf("async function handleAdaptiveProposalConsentAmbiguousInbound", handoffIdx);
    const handoffBlock = src.slice(handoffIdx, handoffEnd);
    const sendIdx = handoffBlock.indexOf("commitAndSendInboundRelationshipCoachReply");
    expect(sendIdx).toBeGreaterThan(-1);
    const engIdx = handoffBlock.indexOf("recordV2SendTimeProfileInboundEngagement", sendIdx);
    expect(engIdx).toBeGreaterThan(sendIdx);
  });

  it("26: adaptive behavior unchanged", () => {
    const adaptiveIdx = src.indexOf("async function handleAdaptiveProposalConsentAmbiguousInbound");
    const adaptiveEnd = src.indexOf("async function finalizeMeaningShadowAfterJobTerminal", adaptiveIdx);
    const adaptiveBlock = src.slice(adaptiveIdx, adaptiveEnd);
    expect(adaptiveBlock).toContain("if (r.ok)");
    expect(adaptiveBlock).toContain("recordV2SendTimeProfileInboundEngagement");
  });

  it("27: no Twilio/send mechanics changes", () => {
    expect(src).toContain("sendSMSChunked");
    expect(normalBlock).not.toContain("twilioClient");
    expect(normalBlock).not.toContain("async function commitAndSendInboundCoachReply");
  });

  it("28: no persistence enum changes in normal block", () => {
    expect(normalBlock).not.toMatch(/event_type:\s*"/);
  });

  it("29: no hard-coded SMS in B2 paths", () => {
    expect(normalBlock).not.toContain("reply_body: \"");
    const legacySendIdx = src.indexOf("legacyFallbackThreadMemoryCtx");
    expect(src.slice(legacySendIdx, legacySendIdx + 2000)).not.toContain('reply_body: "');
  });
});

describe("Phase 2.1g-B2.1 duplicate reply_ready engagement micro-gaps", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const dailySrc = fs.readFileSync(DAILY_ROUTE, "utf8");
  const weeklySrc = fs.readFileSync(WEEKLY_ROUTE, "utf8");
  const normalFnStart = src.indexOf("async function processV2NormalInboundOutcome");
  const normalFnEnd = src.indexOf("async function processV2BlockerCapture");
  const normalBlock = src.slice(normalFnStart, normalFnEnd);
  const blockerFnStart = src.indexOf("async function processV2BlockerCapture");
  const blockerFnEnd = src.indexOf("async function processV2ContractProposalConsent");
  const blockerBlock = src.slice(blockerFnStart, blockerFnEnd);

  it("1: Open Question duplicate reply_ready records engagement after commitAndSend", () => {
    const sendIdx = src.indexOf(
      "await commitAndSendInboundRelationshipCoachReply(j3, userId, openQuestionThreadMemoryCtx)"
    );
    expect(sendIdx).toBeGreaterThan(-1);
    const engIdx = src.indexOf("recordV2SendTimeProfileInboundEngagement", sendIdx);
    expect(engIdx).toBeGreaterThan(sendIdx);
    expect(engIdx - sendIdx).toBeLessThan(120);
  });

  it("2: Open Question unified guard no-send does not record engagement", () => {
    const idx = src.indexOf("open_question_final_body_guard_blocked");
    const guardIdx = src.lastIndexOf("if (!finalGuardsOq.shouldSend)", idx);
    const noSendBlock = src.slice(guardIdx, idx + 200);
    expect(noSendBlock).not.toContain("recordV2SendTimeProfileInboundEngagement");
    expect(noSendBlock).toContain("persistExplicitOutcomeBeforeReplyNoSend");
  });

  it("3: Open Question fresh path remains post-send engagement", () => {
    const sendIdx = src.indexOf(
      "await commitAndSendInboundRelationshipCoachReply(freshV3, userId, openQuestionThreadMemoryCtx)"
    );
    expect(sendIdx).toBeGreaterThan(-1);
    const engIdx = src.indexOf("recordV2SendTimeProfileInboundEngagement", sendIdx);
    expect(engIdx).toBeGreaterThan(sendIdx);
    expect(engIdx - sendIdx).toBeLessThan(120);
  });

  it("4: blocker pivot duplicate reply_ready records engagement after commitAndSend", () => {
    const sendIdx = blockerBlock.indexOf(
      "await commitAndSendInboundRelationshipCoachReply(j2, userId, blockerPivotThreadMemoryCtx)"
    );
    expect(sendIdx).toBeGreaterThan(-1);
    const engIdx = blockerBlock.indexOf("recordV2SendTimeProfileInboundEngagement", sendIdx);
    expect(engIdx).toBeGreaterThan(sendIdx);
    expect(engIdx - sendIdx).toBeLessThan(120);
  });

  it("5: blocker pivot unified guard no-send does not record engagement", () => {
    const idx = blockerBlock.indexOf("blocker_pivot_unified_final_guard_blocked");
    const guardIdx = blockerBlock.lastIndexOf("if (!unifiedGuardBlockerPivot.shouldSend)", idx);
    const noSendBlock = blockerBlock.slice(guardIdx, idx + 200);
    expect(noSendBlock).not.toContain("recordV2SendTimeProfileInboundEngagement");
  });

  it("6: blocker pivot fresh path remains post-send engagement", () => {
    const sendIdx = blockerBlock.indexOf(
      "await commitAndSendInboundRelationshipCoachReply(freshPv, userId, blockerPivotThreadMemoryCtx)"
    );
    expect(sendIdx).toBeGreaterThan(-1);
    const engIdx = blockerBlock.indexOf("recordV2SendTimeProfileInboundEngagement", sendIdx);
    expect(engIdx).toBeGreaterThan(sendIdx);
    expect(engIdx - sendIdx).toBeLessThan(120);
  });

  it("7: B2 normal main / pivot / arc / legacy engagement ordering unchanged", () => {
    const mainFreshIdx = normalBlock.indexOf(
      "await commitAndSendInboundCoachReply(fresh, userId, inboundV3ThreadMemory)"
    );
    expect(normalBlock.indexOf("recordV2SendTimeProfileInboundEngagement", mainFreshIdx)).toBeGreaterThan(
      mainFreshIdx
    );
    const pivotFreshIdx = normalBlock.indexOf(
      "await commitAndSendInboundRelationshipCoachReply(freshPivot, userId, centralBrainPivotThreadMemoryCtx)"
    );
    expect(normalBlock.indexOf("recordV2SendTimeProfileInboundEngagement", pivotFreshIdx)).toBeGreaterThan(
      pivotFreshIdx
    );
    const arcFreshIdx = normalBlock.indexOf(
      "await commitAndSendInboundRelationshipCoachReply(freshArc, userId, arcClarifyThreadMemoryCtx)"
    );
    expect(normalBlock.indexOf("recordV2SendTimeProfileInboundEngagement", arcFreshIdx)).toBeGreaterThan(
      arcFreshIdx
    );
    const legacyFreshIdx = src.indexOf(
      "await commitAndSendInboundRelationshipCoachReply(freshFb, userId, legacyFallbackThreadMemoryCtx)"
    );
    expect(src.indexOf("recordV2SendTimeProfileInboundEngagement", legacyFreshIdx)).toBeGreaterThan(
      legacyFreshIdx
    );
  });

  it("8: contract/adaptive/pending/memory/handoff/refresh/blocker ack untouched", () => {
    expect(src).toContain("if (sendContractYes.ok)");
    expect(src).toContain("if (visibleSent)");
    const memoryStart = src.indexOf("async function processV2MemoryConfirmationInbound");
    const memoryBlock = src.slice(memoryStart, src.indexOf("async function processV2SmsInboundPendingResolution"));
    const ambNoSend = memoryBlock.indexOf("if (!sendAmb.ok)");
    expect(memoryBlock.slice(ambNoSend, memoryBlock.indexOf("}", ambNoSend) + 1)).not.toContain(
      "recordV2SendTimeProfileInboundEngagement"
    );
    const handoffIdx = src.indexOf("async function persistCommitmentChangeHandoffLaneAndSend");
    const handoffEnd = src.indexOf("async function handleAdaptiveProposalConsentAmbiguousInbound", handoffIdx);
    expect(src.slice(handoffIdx, handoffEnd)).toContain("recordV2SendTimeProfileInboundEngagement");
  });

  it("9: daily/weekly inbound engagement untouched; weekly uses outbound_weekly guard", () => {
    expect(dailySrc).not.toContain("recordV2SendTimeProfileInboundEngagement");
    expect(weeklySrc).not.toContain("recordV2SendTimeProfileInboundEngagement");
    expect(weeklySrc).toContain('mode: "outbound_weekly"');
  });

  it("10: no Twilio/send mechanics changes in B2.1 scope", () => {
    expect(src).toContain("sendSMSChunked");
    expect(blockerBlock).not.toContain("async function commitAndSendInboundCoachReply");
  });

  it("11: no persistence enum changes in blocker pivot duplicate/fresh slice", () => {
    const pivotSliceStart = blockerBlock.indexOf("const blockerPivotThreadMemoryCtx");
    const pivotSlice = blockerBlock.slice(pivotSliceStart, pivotSliceStart + 1200);
    expect(pivotSlice).not.toMatch(/event_type:\s*"/);
  });

  it("12: no hard-coded SMS in OQ/pivot duplicate paths", () => {
    const oqDupIdx = src.indexOf("openQuestionThreadMemoryCtx");
    const oqSlice = src.slice(oqDupIdx, oqDupIdx + 2500);
    expect(oqSlice).not.toContain('reply_body: "');
    const pivotDupIdx = blockerBlock.indexOf("blockerPivotThreadMemoryCtx");
    expect(blockerBlock.slice(pivotDupIdx, pivotDupIdx + 800)).not.toContain('reply_body: "');
  });
});
