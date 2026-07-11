import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import type { InboundV3SeasonTransitionFacts } from "@/lib/v2-sms-goal-season-mutation";

export type { InboundV3SeasonTransitionFacts };

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

const FALSE_SEASON_TRANSITION_PATTERNS: RegExp[] = [
  /\bchapter (?:is )?(?:closed|over|done|ended)\b/i,
  /\bseason (?:is )?(?:closed|started|over|ended|complete)\b/i,
  /\bnew season\b/i,
  /\bnew chapter\b/i,
  /\bstarted a (?:new )?season\b/i,
  /\bclosed (?:this|your|the) season\b/i,
  /\bclosed (?:this|your|the) chapter\b/i,
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

/**
 * Awaiting-candidate hallway with no concrete candidate yet: old goal is suspended.
 * Block assigning it as today's action or asking how the new idea "fits" the old goal.
 */
export function bodyCoachesSuspendedCanonicalInHallway(
  body: string,
  canonical: string
): boolean {
  const bodyL = normalizeText(body);
  if (
    /\b(fit(?:s)?\s+with\s+(?:your\s+)?(?:current\s+)?(?:commitment|goal)|clarify how (?:this|that) fits|how (?:does |can )?(?:this|that|lifting|it) fit|integrat(?:e|ing).{0,60}(?:current|running|cardio|routine))\b/i.test(
      body
    )
  ) {
    return true;
  }
  const canonTokens = significantTokens(canonical).filter((t) => t.length >= 5);
  if (canonTokens.length === 0) return false;
  const tokenHits = canonTokens.filter((t) => bodyL.includes(t)).length;
  if (
    /\bfor today\b/i.test(body) &&
    tokenHits >= 1
  ) {
    return true;
  }
  if (tokenHits < Math.min(2, canonTokens.length)) return false;
  if (/\b(new goal|instead|replac|what (?:new |do you want)|hold you to)\b/i.test(bodyL)) {
    return false;
  }
  return /\b(focus on|keep doing|continue|do one|without being asked|current commitment)\b/i.test(
    body
  );
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
    } else if (
      canonical &&
      facts.pending_resolution_sms_state === "awaiting_candidate" &&
      bodyCoachesSuspendedCanonicalInHallway(norm, canonical)
    ) {
      hits.push("pending_replace_coaches_stale_canonical_bar");
    }
  }

  return hits;
}

export function seasonChapterChanged(
  facts: InboundV3SeasonTransitionFacts | null | undefined
): boolean {
  if (!facts) return false;
  if (facts.chapter_changed === true) return true;
  return facts.user_facing_transition === "new_chapter";
}

export function detectSeasonTransitionTruthViolations(
  body: string,
  facts: InboundV3SeasonTransitionFacts | null | undefined
): string[] {
  const hits: string[] = [];
  const norm = body.trim();
  if (!norm || seasonChapterChanged(facts)) return hits;

  for (const re of FALSE_SEASON_TRANSITION_PATTERNS) {
    if (re.test(norm)) {
      hits.push("season_transition_false_chapter_language");
      break;
    }
  }
  return hits;
}

export function seasonTransitionTruthNoSendReason(violations: string[]): string {
  if (violations.includes("season_transition_false_chapter_language")) {
    return "season_transition_false_chapter_language";
  }
  return "season_transition_truth_blocked";
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

const PENDING_REPLACE_TRUTH_FALLBACK_VIOLATIONS = new Set([
  "pending_replace_candidate_not_represented",
  "pending_replace_coaches_stale_canonical_bar",
  "pending_replace_false_applied_language",
]);

/** Human-safe clarify copy when pending replace is still active (no Reply YES/NO menu). */
export function buildPendingReplaceSafeClarificationFallback(candidate: string): string {
  const cand = candidate.trim();
  if (!cand) {
    return "Got it. What new goal do you want me to hold you to?";
  }
  return `Do you want your new goal to be: ${cand}?`;
}

export function tryPendingReplaceActiveTruthFallback(args: {
  pendingReplacementFacts: InboundV3PendingReplacementFacts;
  legacyPendingReplyPreview?: string | null;
  stateTransitionSummary?: string | null;
  truthViolations: string[];
}): {
  ok: true;
  body: string;
  reason: string;
  candidatePresent: true;
} | {
  ok: false;
  reason: string;
  candidatePresent: boolean;
} {
  const pr = args.pendingReplacementFacts;
  if (!pr.pending_resolution_active || pr.pending_resolution_applied) {
    return { ok: false, reason: "pending_not_active_or_applied", candidatePresent: false };
  }

  if (
    !args.truthViolations.some((v) => PENDING_REPLACE_TRUTH_FALLBACK_VIOLATIONS.has(v))
  ) {
    return { ok: false, reason: "violations_not_fallback_eligible", candidatePresent: false };
  }

  const summary = (args.stateTransitionSummary ?? "").trim();
  const pendingStillActive =
    pr.pending_resolution_sms_state === "awaiting_confirmation" ||
    pr.pending_resolution_sms_state === "awaiting_candidate" ||
    /awaiting_confirmation|pending remains|still awaiting|ambiguous|not applied|clarify|active_clarify/i.test(
      summary
    );
  if (!pendingStillActive) {
    return { ok: false, reason: "pending_not_active_after_phase1", candidatePresent: false };
  }

  const candidate =
    pr.pending_candidate_behavior_statement.trim() ||
    pr.pending_candidate_new_bar?.trim() ||
    "";
  if (!candidate) {
    if (pr.pending_resolution_sms_state !== "awaiting_candidate") {
      return { ok: false, reason: "missing_candidate", candidatePresent: false };
    }
    let hallwayBody = (args.legacyPendingReplyPreview ?? "").trim();
    if (
      !hallwayBody ||
      bodyCoachesSuspendedCanonicalInHallway(hallwayBody, pr.canonical_behavior_statement) ||
      /\b(the lock|locked in|i'?m still holding|let'?s confirm)\b/i.test(hallwayBody)
    ) {
      hallwayBody = buildPendingReplaceSafeClarificationFallback("");
    }
    const hallwayViolations = detectPendingReplacementStateTruthViolations(hallwayBody, pr);
    if (hallwayViolations.length > 0) {
      return { ok: false, reason: "fallback_still_violates_truth", candidatePresent: false };
    }
    return {
      ok: true,
      body: hallwayBody,
      reason: "awaiting_candidate_hallway_fallback",
      candidatePresent: true,
    };
  }

  let fallbackBody = (args.legacyPendingReplyPreview ?? "").trim();
  const legacyHasInternalJargon =
    /\b(the lock|locked in|i'?m still holding:|let'?s confirm)\b/i.test(fallbackBody);
  if (
    !fallbackBody ||
    !bodyRepresentsPendingCandidate(fallbackBody, candidate) ||
    legacyHasInternalJargon
  ) {
    fallbackBody = buildPendingReplaceSafeClarificationFallback(candidate);
  } else if (/reply\s+yes/i.test(fallbackBody)) {
    fallbackBody = buildPendingReplaceSafeClarificationFallback(candidate);
  }

  if (!bodyRepresentsPendingCandidate(fallbackBody, candidate)) {
    return { ok: false, reason: "fallback_lacks_candidate", candidatePresent: false };
  }

  const fallbackViolations = detectPendingReplacementStateTruthViolations(fallbackBody, pr);
  if (fallbackViolations.length > 0) {
    return {
      ok: false,
      reason: "fallback_still_violates_truth",
      candidatePresent: bodyRepresentsPendingCandidate(fallbackBody, candidate),
    };
  }

  const legacyTrim = (args.legacyPendingReplyPreview ?? "").trim();
  let reason: string;
  if (legacyTrim && fallbackBody === legacyTrim) {
    reason = "legacy_pending_reply_preview";
  } else if (/reply\s+yes/i.test(legacyTrim)) {
    reason = "legacy_had_robot_menu_replaced";
  } else {
    reason = "constructed_safe_fallback";
  }

  return { ok: true, body: fallbackBody, reason, candidatePresent: true };
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
  // Goal-change hallway: awaiting_candidate with no concrete candidate still outranks
  // normal old-goal coaching. awaiting_confirmation without a candidate is invalid — skip.
  if (!candidate && smsState !== "awaiting_candidate") return null;

  const applied = options?.pendingResolutionApplied === true;
  const requiredMeaning = applied
    ? "Canonical commitment was updated on the server — you may acknowledge the new bar honestly. Do not contradict updated_commitment_snapshot or pending_resolution_facts."
    : candidate
      ? [
          "pending_replacement_facts: the pending candidate is the user-facing goal truth for this SMS.",
          "canonical_behavior_statement is background only — do NOT coach it as today's action or current daily goal.",
          "Do NOT say goal/commitment updated, changed, locked in, or applied unless pending_resolution_applied is true.",
          "Do NOT ask how the new goal fits with the old/current commitment.",
          "Ask naturally whether they want the pending candidate as their new goal. Prefer: Do you want your new goal to be: [candidate]?",
          "Forbidden user-visible words: lock, locked in, bar, Let's confirm, candidate bar.",
        ].join(" ")
      : [
          "pending_replacement_facts: goal-change hallway is open (awaiting_candidate, no concrete candidate yet).",
          "The old/canonical goal is suspended for coaching — do NOT assign it as today's action.",
          "Do NOT coach canonical_behavior_statement. Do NOT ask how a new idea fits with the old goal.",
          "Stay in the replacement hallway: ask what new goal to hold them to, or one narrowing question about the replacement direction.",
          "If grief/emotion is present, respond humanly and keep the ask gentle.",
          "Do NOT say goal/commitment updated, changed, locked in, or applied.",
          "Forbidden user-visible words: lock, locked in, bar, Let's confirm, candidate bar, align with your current needs.",
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
