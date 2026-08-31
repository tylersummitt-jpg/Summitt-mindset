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

vi.mock("@/lib/victory-media/correlate-inbound-mms-c1", () => ({
  scheduleC1IfWinsDurable: vi.fn(),
}));

import {
  isInboundSolMainCoachingBranch,
  isLikelyInboundSolMainBeforeHandoff,
} from "@/lib/inbound-sol-relationship-turn";

const ROUTE = path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");
const SOL_TURN = path.join(process.cwd(), "src/lib/inbound-sol-relationship-turn.ts");
const PERSIST_ADVICE = path.join(process.cwd(), "src/lib/inbound-sol-persist-advice.ts");
const WINS = path.join(process.cwd(), "src/lib/inbound-sol-wins.ts");
const THREAD_MEMORY = path.join(process.cwd(), "src/lib/v2-commitment-sms-thread-memory.ts");

describe("inbound Sol main-branch wire", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const turn = fs.readFileSync(SOL_TURN, "utf8");
  const advice = fs.readFileSync(PERSIST_ADVICE, "utf8");
  const wins = fs.readFileSync(WINS, "utf8");
  const threadMemory = fs.readFileSync(THREAD_MEMORY, "utf8");

  it("wires Sol only after V3-ownership eligibility, then returns before V3 writer", () => {
    expect(src).toContain("runInboundSolRelationshipTurn");
    expect(src).toContain("isInboundSolMainCoachingBranch");
    const solIdx = src.indexOf("await runInboundSolRelationshipTurn");
    const v3Idx = src.indexOf("const laneRes = await produceInboundV3RelationshipSms");
    expect(solIdx).toBeGreaterThan(0);
    expect(v3Idx).toBeGreaterThan(solIdx);
  });

  it("Sol main send uses existing commitAndSendInboundCoachReply and does not call North Star / FVG rewrite", () => {
    const start = src.indexOf("if (\n      isInboundSolMainCoachingBranch");
    const ret = src.indexOf("inbound_sol_main_sent", start);
    expect(start).toBeGreaterThan(0);
    expect(ret).toBeGreaterThan(start);
    const block = src.slice(start, ret);
    expect(block).toContain("commitAndSendInboundCoachReply");
    expect(block).not.toContain("finalizeNorthStarInboundCoachReplyAsync");
    expect(block).not.toContain("applyFinalVoiceOwnershipGate");
    expect(block).not.toContain("produceInboundV3RelationshipSms");
    expect(block).not.toContain("produceInboundV3RelationshipSms");
    expect(block).not.toContain("recognizeWinsFromInboundV1");
  });

  it("skips win-recognition OpenAI and central/shadow minis on likely Sol main", () => {
    expect(src).toContain("if (!inboundWinRecognitionBundle && !inboundSolMainLikely)");
    expect(src).toContain("conversationBrainControlTurn != null || inboundSolMainLikely");
    expect(src).toContain("!inboundSolMainLikelyEarly && needInterpretation");
  });

  it("legacy classifier is unused by Sol persist advice", () => {
    expect(advice).toContain("void args.classifierEventType");
    expect(advice).not.toContain("shouldPersistInboundAccountabilityOutcome(");
    expect(advice).not.toContain("buildInboundMeaningFacts");
    expect(advice).not.toContain("ACCOUNTABILITY_OUTCOMES.has");
  });

  it("does not call win-recognition or win-equivalence OpenAI", () => {
    expect(wins).not.toContain("recognizeWinsFromInboundV1");
    expect(wins).not.toContain("classifyWinCandidatesEquivalenceV1");
    expect(turn).toContain("persistSolInboundWins");
    expect(turn).not.toContain("recognizeWinsFromInboundV1");
    expect(wins).toContain("persistInboundWinsWithAccountability");
    expect(wins).toContain("persistRecognizedWins(");
    expect(wins).toContain("scheduleC1IfWinsDurable");
    expect(wins).toContain("supportingQuoteOverrides");
    expect(wins).toContain("validateWinSupportingQuote");
    expect(wins).not.toContain("openai.chat");
  });

  it("does not add env flags, shadow mode, or a second writer", () => {
    expect(turn).not.toMatch(/process\.env\.[A-Z0-9_]*SOL/);
    expect(turn).not.toContain("FEATURE_");
    expect(turn).not.toContain("shadow");
    expect(src).not.toContain("INBOUND_SOL_ENABLED");
  });

  it("predicate excludes exit, identity, heuristic commitment-change, and conversation-brain takeover", () => {
    expect(
      isInboundSolMainCoachingBranch({
        normalInboundV3OwnershipEligible: true,
        relationshipExitLaneActive: false,
        identityEditLaneActive: false,
        commitmentChangeHeuristicContext: false,
        conversationBrainControlTurnActive: false,
      })
    ).toBe(true);
    expect(
      isInboundSolMainCoachingBranch({
        normalInboundV3OwnershipEligible: true,
        relationshipExitLaneActive: true,
        identityEditLaneActive: false,
        commitmentChangeHeuristicContext: false,
        conversationBrainControlTurnActive: false,
      })
    ).toBe(false);
    expect(
      isLikelyInboundSolMainBeforeHandoff({
        relationshipExitLaneActive: false,
        identityEditLaneActive: false,
        commitmentChangeIntentLikely: true,
        conversationBrainControlTurnActive: false,
      })
    ).toBe(false);
  });

  it("skips TU / open-question V3 intercept on Sol-likely normal turns", () => {
    const fnStart = src.indexOf("async function processV2NormalInboundOutcome");
    const solCall = src.indexOf("await runInboundSolRelationshipTurn", fnStart);
    expect(fnStart).toBeGreaterThan(0);
    expect(solCall).toBeGreaterThan(fnStart);
    const beforeSol = src.slice(fnStart, solCall);
    expect(beforeSol).toContain("persistInboundSmsThreadMemoryProjectionBestEffort");
    const memIdx = beforeSol.indexOf("persistInboundSmsThreadMemoryProjectionBestEffort");
    expect(memIdx).toBeGreaterThan(0);
    expect(solCall - fnStart).toBeGreaterThan(memIdx);
    expect(beforeSol).toContain("!isLikelyInboundSolMainBeforeHandoff({");
    const oqIf = beforeSol.indexOf("!isLikelyInboundSolMainBeforeHandoff({");
    const tryResolve = beforeSol.indexOf("tryResolveAnswerToOpenQuestionTurn");
    const tu = beforeSol.indexOf("await runInboundTurnUnderstandingContext");
    expect(tryResolve).toBeGreaterThan(oqIf);
    expect(tu).toBeGreaterThan(oqIf);
    expect(beforeSol).toContain("produceInboundV3RelationshipSms");
  });

  it("goal_change_clarification length>=8 cannot steal a Sol-normal turn", () => {
    const fnStart = src.indexOf("async function processV2NormalInboundOutcome");
    const solCall = src.indexOf("await runInboundSolRelationshipTurn", fnStart);
    const beforeSol = src.slice(fnStart, solCall);
    const oqIf = beforeSol.indexOf("!isLikelyInboundSolMainBeforeHandoff({");
    const tryResolve = beforeSol.indexOf("tryResolveAnswerToOpenQuestionTurn");
    expect(oqIf).toBeGreaterThan(0);
    expect(tryResolve).toBeGreaterThan(oqIf);
    expect(src).not.toMatch(/goal_change_clarification[\s\S]{0,80}length\s*>=\s*8/);
  });

  it("true exclusive pending confirmation still returns before Sol", () => {
    const handleStart = src.indexOf("async function handleV2SmsInboundCoachJob");
    const firstNormal = src.indexOf("await processV2NormalInboundOutcome", handleStart);
    expect(handleStart).toBeGreaterThan(0);
    expect(firstNormal).toBeGreaterThan(handleStart);
    const exclusive = src.slice(handleStart, firstNormal);
    expect(exclusive).toContain("processV2SmsInboundPendingResolution");
    expect(exclusive).toContain("processV2ContractProposalConsent");
    expect(exclusive).toContain("processV2MemoryConfirmationInbound");
    expect(exclusive).toContain("processV2CoachingRefreshInbound");
    expect(exclusive).toContain("processV2BlockerCapture");
    expect(exclusive).not.toContain("runInboundSolRelationshipTurn");
    const persistStart = src.indexOf("async function persistContractConsentInboundLaneAckAndSend");
    const persistEnd = src.indexOf("async function persistAdaptiveProposalConsentClarificationAndSend");
    const persist = src.slice(persistStart, persistEnd);
    expect(persist).toContain("writeContractConsentSolAckBody");
    expect(persist).not.toContain("writeInboundSolBody");
    expect(persist).not.toContain("runInboundSolBriefInterpreter");
    expect(persist).not.toContain("produceInboundV3RelationshipSms");
    const clarifyStart = src.indexOf("async function persistAdaptiveProposalConsentClarificationAndSend");
    const clarifyEnd = src.indexOf("async function persistCommitmentChangeHandoffLaneAndSend");
    const clarify = src.slice(clarifyStart, clarifyEnd);
    expect(clarify).toContain("writeContractConsentSolClarifyBody");
    expect(clarify).not.toContain("produceInboundV3RelationshipSms");
    expect(clarify).not.toContain("northStarGatePersistBodyAsync");
    expect(clarify).not.toContain("writeInboundSolBody");
    expect(clarify).not.toContain("runInboundSolRelationshipTurn");
    expect(exclusive).toContain("handleAdaptiveProposalConsentAmbiguousInbound");
  });

  it("true Sol normal turn is exactly 1 interpreter + 1 writer, no TU/mini/shadow/win models", () => {
    expect(turn).toContain("runInboundSolBriefInterpreter");
    expect(turn).toContain("writeInboundSolBody");
    expect(turn.split("runInboundSolBriefInterpreter({").length - 1).toBe(1);
    expect(turn.split("writeInboundSolBody({").length - 1).toBe(1);
    expect(turn).not.toContain("runInboundTurnUnderstandingContext");
    expect(turn).not.toContain("tryResolveAnswerToOpenQuestionTurn");
    expect(turn).not.toContain("produceInboundV3RelationshipSms");
    expect(turn).not.toContain("recognizeWinsFromInboundV1");
    expect(turn).not.toContain("classifyWinCandidatesEquivalenceV1");
    expect(turn).not.toContain("shadow");
  });

  it("writer-failure path is unchanged: cancel, no retry, no writer B", () => {
    const start = src.indexOf("if (\n      isInboundSolMainCoachingBranch");
    const sent = src.indexOf("inbound_sol_main_sent", start);
    const block = src.slice(start, sent);
    expect(block).toContain("inbound_sol_main_no_send");
    const genericStart = block.indexOf(
      'status: "cancelled",\n            lastError: JSON.stringify({\n              tag: "inbound_sol_main_no_send"'
    );
    expect(genericStart).toBeGreaterThan(0);
    const generic = block.slice(genericStart);
    expect(generic).toContain('status: "cancelled"');
    expect(generic).toContain("inbound_sol_main_no_send");
    expect(generic).not.toContain("notifyManualPatAnswerNeeded");
    expect(generic).not.toContain("replyBody: null");
    const noSendIdx = block.indexOf("inbound_sol_main_no_send");
    expect(block.slice(noSendIdx)).not.toContain("await runInboundSolRelationshipTurn");
    expect(block.slice(noSendIdx)).not.toContain("writeInboundSolBody");
    expect(turn.split("writeInboundSolBody(").length - 1).toBe(1);
  });

  it("restores outcome side effects after persist and before writer", () => {
    expect(turn).toContain("applySolInboundOutcomeSideEffects");
    const persistIdx = turn.indexOf("await persistInboundAccountabilityOutcomeEvent");
    const sideIdx = turn.indexOf("await applySolInboundOutcomeSideEffects");
    const writerIdx = turn.indexOf("await writeInboundSolBody");
    expect(persistIdx).toBeGreaterThan(0);
    expect(sideIdx).toBeGreaterThan(persistIdx);
    expect(writerIdx).toBeGreaterThan(sideIdx);
    const retrieveIdx = turn.indexOf("await getPatEvidenceForSms");
    expect(retrieveIdx).toBeGreaterThan(sideIdx);
    expect(writerIdx).toBeGreaterThan(retrieveIdx);
    expect(turn).not.toContain("v3LearningNotebookAppend");
    expect(turn).not.toContain("gatedDecision.should_open_blocker_capture");
  });

  it("applies Sol answered_question after interpreter and before persist/writer", () => {
    expect(turn).toContain("applySolAnsweredOpenCoachQuestion");
    const interpIdx = turn.indexOf("await runInboundSolBriefInterpreter");
    const applyIdx = turn.indexOf("await applySolAnsweredOpenCoachQuestion");
    const persistIdx = turn.indexOf("await persistInboundAccountabilityOutcomeEvent");
    const writerIdx = turn.indexOf("await writeInboundSolBody");
    expect(interpIdx).toBeGreaterThan(0);
    expect(applyIdx).toBeGreaterThan(interpIdx);
    expect(persistIdx).toBeGreaterThan(applyIdx);
    expect(writerIdx).toBeGreaterThan(persistIdx);
    expect(turn).not.toContain("sms_last_outbound_context");
  });

  it("safety returns before thread-memory projection and Sol", () => {
    const handleStart = src.indexOf("async function handleV2SmsInboundCoachJob");
    const safetyCall = src.indexOf("await processInboundSmsSafetyShortCircuit", handleStart);
    const firstNormal = src.indexOf("await processV2NormalInboundOutcome", handleStart);
    expect(safetyCall).toBeGreaterThan(handleStart);
    expect(firstNormal).toBeGreaterThan(safetyCall);
    const safetyFn = src.slice(
      src.indexOf("async function processInboundSmsSafetyShortCircuit"),
      src.indexOf("async function handleV2SmsInboundCoachJob")
    );
    expect(safetyFn).not.toContain("persistInboundSmsThreadMemoryProjectionBestEffort");
    expect(safetyFn).not.toContain("applySolAnsweredOpenCoachQuestion");
    expect(safetyFn).not.toContain("runInboundSolRelationshipTurn");
  });

  it("last-ask apply does not write Hallway or Notebook and uses identity match only", () => {
    expect(threadMemory).toContain("applySolAnsweredOpenCoachQuestion");
    expect(threadMemory).toContain("openCoachQuestionTextsMatch");
    expect(threadMemory).not.toContain("v2_hallway");
    expect(threadMemory).not.toContain("v3LearningNotebookAppend");
    expect(threadMemory).not.toContain("from(\"v2_coaching_notebook\")");
    const applyStart = threadMemory.indexOf("export async function applySolAnsweredOpenCoachQuestion");
    const applyFn = threadMemory.slice(applyStart);
    expect(applyFn).toContain('.eq("open_question_text", storedQuestionText)');
    expect(applyFn).toContain('.eq("open_question_asked_at", expectedAskedAt)');
    expect(applyFn).toContain('.select("commitment_id")');
    expect(applyFn).toContain('reason: "cas_miss"');
    expect(applyFn).toContain("canonicalHumanTurnText");
    expect(applyFn).toContain("durableHumanText");
    expect(applyFn).not.toContain("open_question_answer_text: reportedAnswer");
    expect(applyFn).not.toMatch(/new RegExp/);
    expect(applyFn).not.toContain(".test(");
    expect(applyFn).not.toContain("isSubstantiveInboundForThreadMemory");
  });

  it("passes receive-time and current-turn SIDs into Sol", () => {
    expect(src).toContain("receivedAt: job.created_at ?? null");
    expect(src).toContain("currentTurnMessageSids: [...splitSuppressedMessageSids, job.message_sid]");
  });
});
