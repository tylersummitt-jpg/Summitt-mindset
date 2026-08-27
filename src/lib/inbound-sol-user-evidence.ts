/**
 * Mechanical persist of Sol durable user evidence.
 * No English interpretation. No overwrite on duplicate SID.
 */

import { supabaseServer } from "@/lib/supabase-server";
import type { InboundSolDurableUserEvidence } from "@/lib/inbound-sol-coaching-brief";

export const DURABLE_USER_EVIDENCE_MAX_CHARS = 400 as const;

export type PersistSolInboundUserEvidenceStatus =
  | "none"
  | "inserted"
  | "existing"
  | "validation_rejected"
  | "failed";

export type PersistSolInboundUserEvidenceResult = {
  status: PersistSolInboundUserEvidenceStatus;
  reason: string | null;
};

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("duplicate key") || msg.includes("unique constraint");
}

/**
 * Raw JS contiguous substring. No case/whitespace/Unicode/quote normalization.
 */
export function isExactContiguousSubstring(haystack: string, needle: string): boolean {
  return needle.length > 0 && haystack.includes(needle);
}

export function persistableExactUserEvidence(
  capture: InboundSolDurableUserEvidence | null | undefined,
  latestInboundText: string
): { ok: true; exact_user_evidence: string } | { ok: false; reason: string } {
  if (capture == null) {
    return { ok: false, reason: "null_capture" };
  }
  const excerpt = capture.exact_user_evidence;
  if (typeof excerpt !== "string" || excerpt.length === 0) {
    return { ok: false, reason: "empty_excerpt" };
  }
  if (excerpt.length > DURABLE_USER_EVIDENCE_MAX_CHARS) {
    return { ok: false, reason: "excerpt_too_long" };
  }
  if (!isExactContiguousSubstring(latestInboundText, excerpt)) {
    return { ok: false, reason: "not_latest_inbound_substring" };
  }
  return { ok: true, exact_user_evidence: excerpt };
}

export async function persistSolInboundUserEvidence(args: {
  clerkUserId: string;
  messageSid: string;
  latestInboundText: string;
  occurredAtIso: string;
  durableUserEvidence: InboundSolDurableUserEvidence | null | undefined;
}): Promise<PersistSolInboundUserEvidenceResult> {
  if (args.durableUserEvidence == null) {
    return { status: "none", reason: "null_capture" };
  }

  const clerkUserId = args.clerkUserId.trim();
  if (!clerkUserId) {
    return { status: "validation_rejected", reason: "missing_clerk_user_id" };
  }
  const messageSid = args.messageSid.trim();
  if (!messageSid) {
    return { status: "validation_rejected", reason: "missing_message_sid" };
  }

  const grounded = persistableExactUserEvidence(
    args.durableUserEvidence,
    args.latestInboundText
  );
  if (!grounded.ok) {
    return { status: "validation_rejected", reason: grounded.reason };
  }

  const { error } = await supabaseServer.from("v2_durable_user_evidence").insert({
    clerk_user_id: clerkUserId,
    occurred_at: args.occurredAtIso,
    source_message_sid: messageSid,
    exact_user_evidence: grounded.exact_user_evidence,
    status: "active",
  });

  if (!error) {
    return { status: "inserted", reason: null };
  }
  if (isUniqueViolation(error)) {
    return { status: "existing", reason: "source_message_sid" };
  }
  console.warn("[inbound-sol-user-evidence-persist-failed]", {
    message_sid: messageSid,
    code: (error as { code?: string }).code ?? null,
    error: error.message.slice(0, 160),
  });
  return { status: "failed", reason: error.message.slice(0, 120) };
}
