import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  assertRequiredVerbatimSubstringsPresent,
  contractConsentYesBindingVerbatimSubstring,
} from "@/lib/v3-inbound-relationship-lane";

describe("contract consent binding substring (3F-2)", () => {
  it("uses full trimmed proposal when short enough for verbatim SMS", () => {
    expect(contractConsentYesBindingVerbatimSubstring("  Morning walk  ")).toBe("Morning walk");
  });

  it("uses exact 28-char head slice when proposal is long", () => {
    const p = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    expect(contractConsentYesBindingVerbatimSubstring(p)).toBe(p.slice(0, 28));
  });
});

describe("assertRequiredVerbatimSubstringsPresent (3F-2)", () => {
  it("returns ok when required list is empty", () => {
    const r = assertRequiredVerbatimSubstringsPresent("post_north_star", "any body", []);
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.stage).toBe("post_north_star");
  });

  it("detects missing substrings at post_final_voice_gate stage", () => {
    const r = assertRequiredVerbatimSubstringsPresent(
      "post_final_voice_gate",
      "Thanks — accepted.",
      ["BINDING_XYZ"]
    );
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["BINDING_XYZ"]);
    expect(r.stage).toBe("post_final_voice_gate");
  });
});

describe("sms-inbound-coach route — Phase 3F-2 contract consent (static)", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const routePath = join(__dirname, "../app/api/cron/sms-inbound-coach/route.ts");
  const route = readFileSync(routePath, "utf8");

  it("processV2ContractProposalConsent calls overlay RPC before lane persist (state-first)", () => {
    const start = route.indexOf("async function processV2ContractProposalConsent");
    const end = route.indexOf("async function fetchPreferredNameForInboundLane");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = route.slice(start, end);
    const actIdx = body.indexOf("await activateAdaptiveOverlayFromProposal");
    const persistIdx = body.indexOf("await persistContractConsentInboundLaneAckAndSend");
    expect(actIdx).toBeGreaterThan(-1);
    expect(persistIdx).toBeGreaterThan(-1);
    expect(persistIdx).toBeGreaterThan(actIdx);
  });

  it("NO branch calls declineAdaptiveProposal before lane persist", () => {
    const start = route.indexOf("async function processV2ContractProposalConsent");
    const end = route.indexOf("async function fetchPreferredNameForInboundLane");
    const body = route.slice(start, end);
    const noBlock = body.indexOf('if (classification.eventType === "user_no")');
    expect(noBlock).toBeGreaterThan(-1);
    const fromNo = body.slice(noBlock);
    const decIdx = fromNo.indexOf("await declineAdaptiveProposal");
    const persistIdx = fromNo.indexOf("await persistContractConsentInboundLaneAckAndSend");
    expect(decIdx).toBeGreaterThan(-1);
    expect(persistIdx).toBeGreaterThan(decIdx);
  });

  it("does not use legacy contract ACK writers as final body path", () => {
    const start = route.indexOf("async function processV2ContractProposalConsent");
    const end = route.indexOf("async function fetchPreferredNameForInboundLane");
    const body = route.slice(start, end);
    expect(body).not.toContain("tryGenerateV2ContractConsentAckMessage");
    expect(body).not.toContain("finalizePhase1HumanSms");
    expect(body).not.toContain("refineInboundSmsMachineDraft");
    expect(body).not.toContain("northStarGatePersistBodyAsync");
    expect(body).not.toContain("v3_contract_consent_refined");
  });

  it("persistContractConsentInboundLaneAckAndSend runs unified guard before send (Phase 2.1d-A1)", () => {
    const start = route.indexOf("async function runContractConsentNoSendTruthPolicy");
    const end = route.indexOf("async function persistAdaptiveProposalConsentClarificationAndSend");
    const body = route.slice(start, end);
    expect(body).toContain("applyUnifiedSmsFinalProductLawGuard");
    expect(body).toContain("evaluatePostUnifiedGuardContractTruthRecheck");
    expect(body).toContain("persistContractConsentTruthOnNoSend");
    expect(body).toContain("trySendContractConsentBodyAfterUnifiedGuard");
  });

  it("persistContractConsentInboundLaneAckAndSend uses isolated Sol writer, not V3 mini or fallback mini", () => {
    const start = route.indexOf("async function persistContractConsentInboundLaneAckAndSend");
    const end = route.indexOf("async function persistAdaptiveProposalConsentClarificationAndSend");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = route.slice(start, end);
    expect(body).toContain("writeContractConsentSolAckBody");
    expect(body).toContain("contract_consent_sol_ack_sent");
    expect(body).toContain("contract_consent_ack_sol_failed");
    expect(body).not.toContain("produceInboundV3RelationshipSms");
    expect(body).not.toContain("prepareContractConsentHumanVoiceAckForSend");
    expect(body).not.toContain("generateContractConsentAckBodyWithOpenAI");
    expect(body).not.toContain("prepareDeterministicContractConsentAckForSend");
    expect(body).not.toContain("buildDeterministicContractConsentAckBody");
    expect(body).not.toContain("gpt-4o-mini");
    expect(body).not.toContain("V2_SMS_CONVERSATION_BRAIN_MODEL");
    expect(body).not.toContain("runInboundSolRelationshipTurn");
    expect(body).not.toContain("writeInboundSolBody");
  });

  it("processV2ContractProposalConsent logs outbound gate miss without mutating state", () => {
    const start = route.indexOf("async function processV2ContractProposalConsent");
    const end = route.indexOf("async function fetchPreferredNameForInboundLane");
    const body = route.slice(start, end);
    expect(body).toContain("diagnoseContractConsentOutboundGateAsync");
    expect(body).toContain("contract_consent_outbound_gate_miss");
    const missIdx = body.indexOf("contract_consent_outbound_gate_miss");
    const rpcIdx = body.indexOf("await activateAdaptiveOverlayFromProposal");
    expect(missIdx).toBeGreaterThan(-1);
    expect(rpcIdx).toBeGreaterThan(missIdx);
  });

  it("persistContractConsentInboundLaneAckAndSend checks verbatim after Sol writer, without NS/FVG mini polish", () => {
    const start = route.indexOf("async function persistContractConsentInboundLaneAckAndSend");
    const end = route.indexOf("async function persistAdaptiveProposalConsentClarificationAndSend");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = route.slice(start, end);
    const solIdx = body.indexOf("await writeContractConsentSolAckBody");
    const postSolIdx = body.indexOf("contract_required_verbatim_missing_post_sol_writer");
    expect(solIdx).toBeGreaterThan(-1);
    expect(postSolIdx).toBeGreaterThan(solIdx);
    expect(body).not.toContain("await finalizeNorthStarCoachSmsAsync");
    expect(body).not.toContain("await applyFinalVoiceOwnershipGate");
  });

  it("structured last_error tag for verbatim loss after Sol writer", () => {
    const start = route.indexOf("async function persistContractConsentInboundLaneAckAndSend");
    const end = route.indexOf("async function persistAdaptiveProposalConsentClarificationAndSend");
    const body = route.slice(start, end);
    expect(body).toContain("contract_required_verbatim_missing_post_sol_writer");
    expect(body).not.toContain("contract_required_verbatim_missing_post_north_star");
    expect(body).not.toContain("contract_required_verbatim_missing_post_final_voice_gate");
  });

  it("documents state-first: no rollback helpers in contract consent path", () => {
    const start = route.indexOf("async function processV2ContractProposalConsent");
    const end = route.indexOf("async function fetchPreferredNameForInboundLane");
    const body = route.slice(start, end);
    expect(body).not.toMatch(/rollback/i);
  });

  it("passes inbound MessageSid into overlay RPC for idempotency", () => {
    const start = route.indexOf("async function processV2ContractProposalConsent");
    const end = route.indexOf("async function fetchPreferredNameForInboundLane");
    const body = route.slice(start, end);
    expect(body).toContain("inboundMessageSid: job.message_sid");
    expect(body.split("inboundMessageSid: job.message_sid").length - 1).toBeGreaterThanOrEqual(2);
  });

  it("one persist path: one Sol writer and one send attempt, no normal Sol relationship turn", () => {
    const start = route.indexOf("async function persistContractConsentInboundLaneAckAndSend");
    const end = route.indexOf("async function persistAdaptiveProposalConsentClarificationAndSend");
    const body = route.slice(start, end);
    expect(body.split("await writeContractConsentSolAckBody").length - 1).toBe(1);
    expect(body.split("trySendContractConsentBodyAfterUnifiedGuard").length - 1).toBe(1);
    expect(body).not.toContain("runInboundSolRelationshipTurn");
    expect(body).not.toContain("runInboundSolBriefInterpreter");
  });
});
