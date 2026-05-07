import { classifyV2InboundReply } from "@/lib/v2-sms-accountability";

function norm(s: string): string {
  return (s || "").trim().replace(/\s+/g, " ").toLowerCase();
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
  const proposal = typeof args.proposalText === "string" ? args.proposalText.trim() : "";
  if (!proposal) return false;

  const latest = typeof args.latestOutboundBody === "string" ? args.latestOutboundBody : "";
  const needle = norm(proposal).slice(0, 32);
  if (!needle) return false;
  if (!norm(latest).includes(needle)) return false;

  const classification = classifyV2InboundReply((args.inboundBody || "").trim());
  return classification.eventType === "user_yes" || classification.eventType === "user_no";
}

