import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const REPO = path.join(__dirname, "..", "..");

function routeSrc(): string {
  return fs.readFileSync(path.join(REPO, "src/app/api/cron/sms-inbound-coach/route.ts"), "utf8");
}

function sliceBetween(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = src.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("inbound coach reply — durable thread memory projection wire (Slice 1)", () => {
  it("defines commitAndSendInboundRelationshipCoachReply delegating to commitAndSendInboundCoachReply", () => {
    const src = routeSrc();
    expect(src).toContain("async function commitAndSendInboundRelationshipCoachReply");
    expect(src).toMatch(
      /commitAndSendInboundRelationshipCoachReply[\s\S]*?await commitAndSendInboundCoachReply\(job, userId, \{/
    );
    expect(src).toContain("expectedAnswerType: ctx.expectedAnswerType ?? null");
    expect(src).toContain("clearBindingOpenQuestion: ctx.clearBindingOpenQuestion === true");
  });

  it("open-question answer branch uses relationship helper with northStarPktEarly semantics", () => {
    const src = routeSrc();
    const block = sliceBetween(
      src,
      "const openQuestionThreadMemoryCtx = {",
      "open_question_answer_lane_sent"
    );
    expect(block).toContain("northStarPktEarly.expectedReplySemantics");
    expect(block).toContain("commitAndSendInboundRelationshipCoachReply");
    expect(block).not.toMatch(/commitAndSendInboundCoachReply\(\s*\w+,\s*userId\s*\)/);
  });

  it("central brain pivot branch uses relationship helper with northStarPktForV3 semantics", () => {
    const src = routeSrc();
    const block = sliceBetween(
      src,
      "const centralBrainPivotThreadMemoryCtx = {",
      "commitAndSendInboundRelationshipCoachReply(freshPivot"
    );
    expect(block).toContain("northStarPktForV3.expectedReplySemantics");
    expect(block).toContain("commitAndSendInboundRelationshipCoachReply");
    expect(block).not.toMatch(/commitAndSendInboundCoachReply\(\s*\w+,\s*userId\s*\)/);
  });

  it("ARC clarify branch uses relationship helper with northStarPktForV3 semantics", () => {
    const src = routeSrc();
    const block = sliceBetween(
      src,
      "const arcClarifyThreadMemoryCtx = {",
      "commitAndSendInboundRelationshipCoachReply(freshArc"
    );
    expect(block).toContain("northStarPktForV3.expectedReplySemantics");
    expect(block).toContain("commitAndSendInboundRelationshipCoachReply");
    expect(block).not.toMatch(/commitAndSendInboundCoachReply\(\s*\w+,\s*userId\s*\)/);
  });

  it("conversation brain legacy fallback uses relationship helper with northStarPktCb semantics", () => {
    const src = routeSrc();
    const block = sliceBetween(
      src,
      "const legacyFallbackThreadMemoryCtx = {",
      "const needInterpretation = interpretationRequested"
    );
    expect(block).toContain("northStarPktCb.expectedReplySemantics");
    expect(block).toContain("commitAndSendInboundRelationshipCoachReply");
    expect(block).not.toMatch(/commitAndSendInboundCoachReply\(\s*\w+,\s*userId\s*\)/);
  });

  it("blocker pivot and ack branches use relationship helper with northStarBlockerPkt semantics", () => {
    const src = routeSrc();
    const pivotBlock = sliceBetween(
      src,
      "const blockerPivotThreadMemoryCtx = {",
      "const blockerAckTry = await tryGenerateV2BlockerAckMessage"
    );
    expect(pivotBlock).toContain("northStarBlockerPkt.expectedReplySemantics");
    expect(pivotBlock).toContain("commitAndSendInboundRelationshipCoachReply");

    const ackBlock = sliceBetween(
      src,
      "const blockerAckThreadMemoryCtx = {",
      "const afterSend = (await loadJob(job.message_sid)) ?? job"
    );
    expect(ackBlock).toContain("northStarBlockerPkt.expectedReplySemantics");
    expect(ackBlock).toContain("commitAndSendInboundRelationshipCoachReply");
    expect(ackBlock).not.toMatch(/commitAndSendInboundCoachReply\(\s*\w+,\s*userId\s*\)/);
  });

  it("safety short-circuit does not use relationship helper", () => {
    const src = routeSrc();
    const safety = sliceBetween(
      src,
      "async function processInboundSmsSafetyShortCircuit",
      "async function handleV2SmsInboundCoachJob"
    );
    expect(safety).toContain("sendSMSChunked");
    expect(safety).not.toContain("commitAndSendInboundRelationshipCoachReply");
    expect(safety).not.toContain("upsertCommitmentSmsThreadMemoryFromOutbound");
  });

  it("tapback suppression does not send or write projection", () => {
    const src = routeSrc();
    const tap = sliceBetween(
      src,
      "if (isAppleMessengerTapbackLine(rawInboundEarly))",
      "if (await processInboundSmsSafetyShortCircuit(job, userId))"
    );
    expect(tap).toContain("imessage_tapback_suppressed");
    expect(tap).not.toContain("commitAndSendInboundRelationshipCoachReply");
  });

  it("persistInboundV3RelationshipLaneReplyReadyAndSend still passes threadMemory to commitAndSend", () => {
    const src = routeSrc();
    const wrapper = sliceBetween(
      src,
      "async function persistInboundV3RelationshipLaneReplyReadyAndSend(args: {",
      "const REFRESH_LANE_SUMMARY = {"
    );
    expect(wrapper).toContain("commitAndSendInboundCoachReply");
    expect(wrapper).toContain("expectedAnswerType: args.relationshipFacts.thread.expected_reply_semantics");
  });

  it("Slice 2A contract ACK uses relationship helper with null expectedAnswerType and binding clear", () => {
    const src = routeSrc();
    const contract = sliceBetween(
      src,
      "async function persistContractConsentInboundLaneAckAndSend",
      "async function persistAdaptiveProposalConsentClarificationAndSend"
    );
    expect(contract).toContain("commitAndSendInboundRelationshipCoachReply");
    expect(contract).toContain("contractAckThreadMemoryCtx");
    expect(contract).toContain("resolveContractConsentAckExpectedAnswerType");
    expect(contract).toContain("shouldClearBindingOpenQuestionOnContractAck");
    expect(contract).toContain("clearBindingOpenQuestion:");
    expect(contract).not.toContain("legacy_contract_ack_preview");
    expect(contract).not.toMatch(
      /commitAndSendInboundCoachReply\(\s*\w+,\s*args\.userId\s*\)/
    );
    expect(contract).not.toContain("expectedAnswerType: \"proposal_yes_no\"");
  });

  it("Slice 2B adaptive clarification uses relationship helper with resolveAdaptiveClarificationExpectedAnswerType", () => {
    const src = routeSrc();
    const clarification = sliceBetween(
      src,
      "async function persistAdaptiveProposalConsentClarificationAndSend",
      "async function persistCommitmentChangeHandoffLaneAndSend"
    );
    expect(clarification).toContain("commitAndSendInboundRelationshipCoachReply");
    expect(clarification).toContain("adaptiveClarificationThreadMemoryCtx");
    expect(clarification).toContain("resolveAdaptiveClarificationExpectedAnswerType");
    expect(clarification).toContain("gatedBody");
    expect(clarification).not.toContain("legacy_clarification_preview");
    expect(clarification).not.toMatch(
      /commitAndSendInboundCoachReply\(\s*\w+,\s*args\.userId\s*\)/
    );
  });

  it("Slice 2C commitment-change handoff uses relationship helper with handoff thread memory context", () => {
    const src = routeSrc();
    const handoff = sliceBetween(
      src,
      "async function persistCommitmentChangeHandoffLaneAndSend",
      "async function handleAdaptiveProposalConsentAmbiguousInbound"
    );
    expect(handoff).toContain("commitAndSendInboundRelationshipCoachReply");
    expect(handoff).toContain("buildCommitmentChangeHandoffThreadMemoryContext");
    expect(handoff).toContain("deriveCommitmentChangeHandoffSmsStateFromFacts");
    expect(handoff).toContain("commitmentChangeHandoffThreadMemoryCtx");
    expect(handoff).toContain("const gatedBody = voicePack.voice.body");
    expect(handoff).not.toMatch(/commitAndSendInboundCoachReply\(\s*\w+,\s*args\.userId\s*\)/);
    expect(handoff).not.toContain("resolveAdaptiveClarificationExpectedAnswerType");
    expect(handoff).not.toContain("legacy_commitment_change_reply_preview");
    expect(handoff).not.toContain('expectedAnswerType: "proposal_yes_no"');
  });
});
