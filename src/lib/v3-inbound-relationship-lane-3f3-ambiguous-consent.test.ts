import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { latestOutboundBodyContainsAdaptiveProposalBindingNeedle } from "@/lib/v2-contract-consent-routing";

describe("latestOutboundBodyContainsAdaptiveProposalBindingNeedle", () => {
  const proposal = "Today only: 30 minutes of deep work";

  it("matches the same needle rule as contract consent routing", () => {
    expect(
      latestOutboundBodyContainsAdaptiveProposalBindingNeedle(
        `Let’s simplify: ${proposal} Are you good with that adjustment, or keep the current bar?`,
        proposal
      )
    ).toBe(true);
    expect(latestOutboundBodyContainsAdaptiveProposalBindingNeedle("How did it go?", proposal)).toBe(false);
  });
});

describe("sms-inbound-coach route — Phase 3F-3 ambiguous consent (static)", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const routePath = join(__dirname, "../app/api/cron/sms-inbound-coach/route.ts");
  const route = readFileSync(routePath, "utf8");

  it("runs handleAdaptiveProposalConsentAmbiguousInbound after processV2ContractProposalConsent and before memory confirmation", () => {
    const cIdx = route.indexOf("await processV2ContractProposalConsent");
    const aIdx = route.indexOf("await handleAdaptiveProposalConsentAmbiguousInbound");
    const memIdx = route.indexOf("await processV2MemoryConfirmationInbound");
    expect(cIdx).toBeGreaterThan(-1);
    expect(aIdx).toBeGreaterThan(-1);
    expect(memIdx).toBeGreaterThan(-1);
    expect(cIdx).toBeLessThan(aIdx);
    expect(aIdx).toBeLessThan(memIdx);
  });

  it("persistAdaptiveProposalConsentClarificationAndSend uses isolated Sol writer then unified guard", () => {
    const start = route.indexOf("async function persistAdaptiveProposalConsentClarificationAndSend");
    const end = route.indexOf("async function persistCommitmentChangeHandoffLaneAndSend");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = route.slice(start, end);
    expect(body).toContain("writeContractConsentSolClarifyBody");
    expect(body).toContain("applyUnifiedSmsFinalProductLawGuard");
    expect(body).toContain("evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck");
    expect(body).toContain("const gatedBody = unifiedGuard.body");
    expect(body).not.toContain("produceInboundV3RelationshipSms");
    expect(body).not.toContain("northStarGatePersistBodyAsync");
    expect(body).not.toContain("applyFinalVoiceOwnershipGate");
    expect(body).not.toContain("activateAdaptiveOverlayFromProposal");
    expect(body).not.toContain("declineAdaptiveProposal");
    expect(body).not.toContain("persistContractConsentTruthOnNoSend");
    expect(body).not.toContain("runInboundSolRelationshipTurn");
    expect(body).not.toContain("writeInboundSolBody");
    expect(body).not.toContain("gpt-4o-mini");
    expect(body.split("await writeContractConsentSolClarifyBody").length - 1).toBe(1);
    expect(body.split("applyUnifiedSmsFinalProductLawGuard").length - 1).toBe(1);
  });

  it("handleAdaptiveProposalConsentAmbiguousInbound does not call overlay RPCs and returns exclusive", () => {
    const start = route.indexOf("async function handleAdaptiveProposalConsentAmbiguousInbound");
    const end = route.indexOf("function recordInboundMeaningShadowSuppressedNoSend");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = route.slice(start, end);
    expect(body).not.toContain("activateAdaptiveOverlayFromProposal");
    expect(body).not.toContain("declineAdaptiveProposal");
    expect(body).not.toContain("setBlockerCapturePending");
    expect(body).toContain("if (!isV2PendingProposalValid(commitment)) return false");
    expect(body).toContain('if (classification.eventType === "user_yes" || classification.eventType === "user_no") return false');
    expect(body).toContain("return true");
  });
});
