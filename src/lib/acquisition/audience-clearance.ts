import { instantlyDeliveryStop, type InstantlyLeadView } from "@/lib/acquisition/instantly-existing-leads";
import type { MembershipClearance, ProspectLead, VerificationClearance } from "@/lib/acquisition/video-first-prep";

export type AudienceSkipKind = "excluded" | "unverified";

export type AudienceGate =
  | { ok: true; lead: ProspectLead & { instantly: InstantlyLeadView }; verification: VerificationClearance }
  | { ok: false; email: string; reason: string; kind: AudienceSkipKind };

/** Instantly delivery + verification gates before local membership and journey checks. */
export function gateInstantlyLead(
  lead: InstantlyLeadView,
  expectedCampaignId: string,
): AudienceGate {
  if (lead.campaignId !== expectedCampaignId) {
    return { ok: false, email: lead.email, kind: "excluded", reason: "This lead is not in the selected source audience." };
  }
  const stopped = instantlyDeliveryStop(lead.status);
  if (stopped === "bounced") {
    return { ok: false, email: lead.email, kind: "excluded", reason: "Instantly has this lead as bounced." };
  }
  if (stopped === "unsubscribed") {
    return { ok: false, email: lead.email, kind: "excluded", reason: "Instantly has this lead as unsubscribed." };
  }
  if (lead.verification === "exclude") {
    return {
      ok: false,
      email: lead.email,
      kind: "excluded",
      reason: "Instantly marked this address invalid, risky, catch-all, or a job change.",
    };
  }
  if (lead.verification === "unverified") {
    return {
      ok: false,
      email: lead.email,
      kind: "unverified",
      reason: "Instantly has not verified this address. They were left unverified.",
    };
  }
  return {
    ok: true,
    verification: "verified",
    lead: {
      email: lead.email,
      firstName: lead.firstName,
      lastName: lead.lastName,
      instantly: lead,
    },
  };
}

export function foldSkipKinds(
  skips: ReadonlyArray<{ kind?: AudienceSkipKind }>,
): { excluded: number; unverified: number } {
  let excluded = 0;
  let unverified = 0;
  for (const skip of skips) {
    if (skip.kind === "unverified") unverified += 1;
    else excluded += 1;
  }
  return { excluded, unverified };
}

export function membershipMapOrUnverified(
  emails: readonly string[],
  map: ReadonlyMap<string, MembershipClearance> | null,
): Map<string, MembershipClearance> {
  const out = new Map<string, MembershipClearance>();
  for (const email of emails) {
    out.set(email, map?.get(email) ?? "unverified");
  }
  return out;
}
