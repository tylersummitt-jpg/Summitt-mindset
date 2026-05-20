import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";

export type V2SmsPendingWireState =
  | "awaiting_candidate"
  | "awaiting_confirmation"
  | "candidate_received"
  | "confirmed"
  | "cancelled";

type SmsInboundPendingPayloadSlice = {
  sms_state?: V2SmsPendingWireState;
  candidate_behavior_statement?: string | null;
  candidate_new_bar?: string | null;
  candidate_tightened_bar?: string | null;
};

function parseSmsInboundPendingPayload(raw: unknown): SmsInboundPendingPayloadSlice | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.source !== "sms_inbound") return null;
  const smsRaw = o.sms_state;
  const sms_state =
    smsRaw === "awaiting_candidate" ||
    smsRaw === "awaiting_confirmation" ||
    smsRaw === "candidate_received" ||
    smsRaw === "confirmed" ||
    smsRaw === "cancelled"
      ? smsRaw
      : undefined;
  return {
    ...(sms_state ? { sms_state } : {}),
    candidate_behavior_statement:
      typeof o.candidate_behavior_statement === "string" ? o.candidate_behavior_statement : null,
    candidate_new_bar: typeof o.candidate_new_bar === "string" ? o.candidate_new_bar : null,
    candidate_tightened_bar:
      typeof o.candidate_tightened_bar === "string" ? o.candidate_tightened_bar : null,
  };
}

function isPendingCommitmentReplaceActionable(
  row: ActiveV2CommitmentRow,
  nowMs: number = Date.now()
): boolean {
  if (row.pending_resolution_kind !== "commitment_replace") return false;
  const created =
    typeof row.pending_resolution_created_at === "string"
      ? row.pending_resolution_created_at.trim()
      : "";
  const expires =
    typeof row.pending_resolution_expires_at === "string"
      ? row.pending_resolution_expires_at.trim()
      : "";
  if (!created || !expires) return false;
  const expMs = new Date(expires).getTime();
  if (!Number.isFinite(expMs) || nowMs >= expMs) return false;
  const payload = parseSmsInboundPendingPayload(row.pending_resolution_payload);
  if (!payload) return false;
  const st = payload.sms_state ?? "awaiting_candidate";
  if (st === "confirmed" || st === "cancelled") return false;
  return true;
}

export type InboundV3PendingReplacementFacts = {
  pending_resolution_active: true;
  pending_resolution_kind: "commitment_replace";
  pending_resolution_sms_state: V2SmsPendingWireState;
  pending_candidate_behavior_statement: string;
  pending_candidate_new_bar: string | null;
  canonical_behavior_statement: string;
  pending_resolution_applied: boolean;
  required_meaning_summary: string;
};

const FALSE_APPLIED_UPDATE_PATTERNS: RegExp[] = [
  /\bgoal(?:'s)?\s+(?:has\s+been\s+)?(?:updated|changed|locked\s+in)\b/i,
  /\bgoal\b[^.!?]{0,100}\b(?:has\s+been\s+)?updated\b/i,
  /\bcommitment(?:'s)?\s+(?:has\s+been\s+)?(?:updated|changed|locked\s+in)\b/i,
  /\bcommitment\b[^.!?]{0,100}\b(?:has\s+been\s+)?updated\b/i,
  /\b(?:updated|changed)\s+your\s+goal\b/i,
  /\b(?:updated|changed)\s+your\s+commitment\b/i,
  /\bi(?:'ve| have)\s+(?:updated|changed)\s+(?:your\s+)?goal\b/i,
  /\bi(?:'ve| have)\s+(?:updated|changed)\s+(?:your\s+)?commitment\b/i,
  /\bgoal\s+is\s+updated\b/i,
  /\bcommitment\s+is\s+updated\b/i,
];

function normalizeText(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function significantTokens(text: string): string[] {
  const lower = normalizeText(text);
  const words = lower.match(/\b[a-z]{4,}\b/g) ?? [];
  const nums = lower.match(/\b\d[\d,]*\b/g) ?? [];
  return [...new Set([...words, ...nums.map((n) => n.replace(/,/g, ""))])].filter(Boolean);
}

/** True when the SMS body reflects the pending candidate more than incidental overlap. */
export function bodyRepresentsPendingCandidate(body: string, candidate: string): boolean {
  const candTokens = significantTokens(candidate);
  if (candTokens.length === 0) return true;
  const bodyL = normalizeText(body);
  let hits = 0;
  for (const t of candTokens) {
    if (t.length >= 4 && bodyL.includes(t)) hits += 1;
  }
  if (candTokens.length === 1) return hits >= 1;
  return hits >= Math.min(2, candTokens.length);
}

/** True when body leans on canonical bar language while ignoring the pending candidate. */
export function bodyCoachesStaleCanonicalBar(
  body: string,
  canonical: string,
  candidate: string
): boolean {
  if (bodyRepresentsPendingCandidate(body, candidate)) return false;
  const canonTokens = significantTokens(canonical).filter(
    (t) => !significantTokens(candidate).includes(t)
  );
  if (canonTokens.length === 0) return false;
  const bodyL = normalizeText(body);
  return canonTokens.some((t) => t.length >= 5 && bodyL.includes(t));
}

export function detectPendingReplacementStateTruthViolations(
  body: string,
  facts: InboundV3PendingReplacementFacts
): string[] {
  const hits: string[] = [];
  const norm = body.trim();
  if (!norm) return hits;

  if (!facts.pending_resolution_applied) {
    for (const re of FALSE_APPLIED_UPDATE_PATTERNS) {
      if (re.test(norm)) {
        hits.push("pending_replace_false_applied_language");
        break;
      }
    }
    const candidate =
      facts.pending_candidate_behavior_statement.trim() ||
      facts.pending_candidate_new_bar?.trim() ||
      "";
    const canonical = facts.canonical_behavior_statement.trim();
    if (candidate) {
      if (!bodyRepresentsPendingCandidate(norm, candidate)) {
        hits.push("pending_replace_candidate_not_represented");
      }
      if (canonical && bodyCoachesStaleCanonicalBar(norm, canonical, candidate)) {
        hits.push("pending_replace_coaches_stale_canonical_bar");
      }
    }
  }

  return hits;
}

export function pendingReplacementStateTruthNoSendReason(violations: string[]): string {
  if (violations.includes("pending_replace_false_applied_language")) {
    return "pending_replace_false_applied_language";
  }
  if (violations.includes("pending_replace_coaches_stale_canonical_bar")) {
    return "pending_replace_coaches_stale_canonical_bar";
  }
  return "pending_replace_state_truth_blocked";
}

/**
 * True when canonical commitment row reflects a successful replace mutation (pending cleared + bar matches candidate).
 */
export function computePendingCommitmentReplaceApplied(args: {
  commitmentBefore: ActiveV2CommitmentRow;
  commitmentAfter: ActiveV2CommitmentRow;
}): boolean {
  if (args.commitmentBefore.pending_resolution_kind !== "commitment_replace") return false;
  if (isPendingCommitmentReplaceActionable(args.commitmentAfter)) return false;
  const payload = parseSmsInboundPendingPayload(args.commitmentBefore.pending_resolution_payload);
  if (!payload) return false;
  const cand =
    payload.candidate_behavior_statement?.trim() ||
    payload.candidate_new_bar?.trim() ||
    payload.candidate_tightened_bar?.trim() ||
    "";
  if (!cand) return false;
  const after = (args.commitmentAfter.behavior_statement ?? "").trim();
  if (!after) return false;
  const candN = normalizeText(cand);
  const afterN = normalizeText(after);
  if (afterN === candN) return true;
  if (afterN.includes(candN) || candN.includes(afterN)) return true;
  return bodyRepresentsPendingCandidate(after, cand);
}

export function buildInboundPendingReplacementFactsFromCommitment(
  commitment: ActiveV2CommitmentRow,
  options?: { pendingResolutionApplied?: boolean }
): InboundV3PendingReplacementFacts | null {
  if (!isPendingCommitmentReplaceActionable(commitment)) return null;
  const payload = parseSmsInboundPendingPayload(commitment.pending_resolution_payload);
  if (!payload) return null;

  const smsState = payload.sms_state ?? "awaiting_candidate";
  if (smsState !== "awaiting_confirmation" && smsState !== "awaiting_candidate") {
    return null;
  }

  const candidate =
    payload.candidate_behavior_statement?.trim() ||
    payload.candidate_new_bar?.trim() ||
    "";
  if (!candidate) return null;

  const applied = options?.pendingResolutionApplied === true;
  const requiredMeaning = applied
    ? "Canonical commitment was updated on the server — you may acknowledge the new bar honestly. Do not contradict updated_commitment_snapshot or pending_resolution_facts."
    : [
        "pending_replacement_facts: the pending candidate bar is the user-facing truth for this SMS.",
        "canonical_behavior_statement is background only — do NOT coach it as the current daily bar.",
        "Do NOT say goal/commitment updated, changed, locked in, or applied unless pending_resolution_applied is true.",
        "If confirmation is still needed, ask naturally about the pending candidate (not the old bar).",
      ].join(" ");

  return {
    pending_resolution_active: true,
    pending_resolution_kind: "commitment_replace",
    pending_resolution_sms_state: smsState,
    pending_candidate_behavior_statement: candidate,
    pending_candidate_new_bar: payload.candidate_new_bar?.trim() || null,
    canonical_behavior_statement: (commitment.behavior_statement ?? "").trim(),
    pending_resolution_applied: applied,
    required_meaning_summary: requiredMeaning,
  };
}
