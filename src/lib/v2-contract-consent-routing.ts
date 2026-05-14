import { classifyV2InboundReply } from "@/lib/v2-sms-accountability";

function norm(s: string): string {
  return (s || "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Same normalized first-32-char binding needle as {@link shouldConsumeInboundAsContractProposalConsent}.
 * Used for Phase 3F-3 ambiguous consent clarification so proposal-truth matches contract consent routing.
 */
export function latestOutboundBodyContainsAdaptiveProposalBindingNeedle(
  latestOutboundBody: string | null | undefined,
  proposalText: string | null | undefined
): boolean {
  const proposal = typeof proposalText === "string" ? proposalText.trim() : "";
  if (!proposal) return false;
  const latest = typeof latestOutboundBody === "string" ? latestOutboundBody : "";
  const needle = norm(proposal).slice(0, 32);
  if (!needle) return false;
  return norm(latest).includes(needle);
}

/**
 * Gate overlay/proposal consent consumption:
 * - Only YES/NO (deterministic classifier) can be consent
 * - Only when the latest outbound body is still the proposal prompt (contains the binding text)
 */
export function shouldConsumeInboundAsContractProposalConsent(args: {
  inboundBody: string;
  proposalText: string | null | undefined;
  latestOutboundBody: string | null | undefined;
}): boolean {
  if (!latestOutboundBodyContainsAdaptiveProposalBindingNeedle(args.latestOutboundBody, args.proposalText)) {
    return false;
  }

  const classification = classifyV2InboundReply((args.inboundBody || "").trim());
  return classification.eventType === "user_yes" || classification.eventType === "user_no";
}

