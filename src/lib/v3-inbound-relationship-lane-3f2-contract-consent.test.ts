import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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

  it("persistContractConsentInboundLaneAckAndSend runs post-NS then post-FVG verbatim checks when binding-critical", () => {
    const start = route.indexOf("async function persistContractConsentInboundLaneAckAndSend");
    const end = route.indexOf("async function markJobFinal");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = route.slice(start, end);
    const nsIdx = body.indexOf("await finalizeNorthStarCoachSmsAsync");
    const postNsIdx = body.indexOf('"post_north_star"');
    const fvgIdx = body.indexOf("await applyFinalVoiceOwnershipGate");
    const postFvgIdx = body.indexOf('"post_final_voice_gate"');
    expect(nsIdx).toBeGreaterThan(-1);
    expect(postNsIdx).toBeGreaterThan(nsIdx);
    expect(fvgIdx).toBeGreaterThan(postNsIdx);
    expect(postFvgIdx).toBeGreaterThan(fvgIdx);
  });

  it("structured last_error tags for verbatim loss after NS / FVG", () => {
    const start = route.indexOf("async function persistContractConsentInboundLaneAckAndSend");
    const end = route.indexOf("async function markJobFinal");
    const body = route.slice(start, end);
    expect(body).toContain("contract_required_verbatim_missing_post_north_star");
    expect(body).toContain("contract_required_verbatim_missing_post_final_voice_gate");
  });

  it("documents state-first: no rollback helpers in contract consent path", () => {
    const start = route.indexOf("async function processV2ContractProposalConsent");
    const end = route.indexOf("async function fetchPreferredNameForInboundLane");
    const body = route.slice(start, end);
    expect(body).not.toMatch(/rollback/i);
  });
});
