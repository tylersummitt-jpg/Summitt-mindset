/**
 * Pure parsing helpers for check_sent payload JSON (no Supabase).
 * Split from v2-outbound-check-sent so importers (e.g. north-star-sms-context-packet) avoid loading DB clients.
 */

export type V2ContractOverlayProposalKind = "shrink_ask" | "recommit_same";

/** Parses `contract_proposal` from check_sent snapshot payload (cron + replay). */
export function parseContractOverlayProposalFromCheckPayload(
  checkPayloadJson: Record<string, unknown>
): { proposalText: string; contractKind: V2ContractOverlayProposalKind } | null {
  const cp = checkPayloadJson.contract_proposal;
  if (cp == null || typeof cp !== "object" || Array.isArray(cp)) return null;
  const rec = cp as Record<string, unknown>;
  const proposalText = typeof rec.proposal_text === "string" ? rec.proposal_text.trim() : "";
  const contractKind =
    rec.contract_kind === "shrink_ask" || rec.contract_kind === "recommit_same"
      ? rec.contract_kind
      : null;
  if (!proposalText || !contractKind) return null;
  return { proposalText, contractKind };
}
