/**
 * Morning Brief interpreter canonical input V1 — server-owned facts only.
 * No English interpretation. No coaching move / pressure / goal-role derivation.
 * Not wired into Morning generation in Phase 2B.
 */

import { isQuotableIdentitySource } from "@/lib/v2-identity-anchor-validation";
import {
  isImportantPeopleRelationshipType,
  type ImportantPeopleRelationshipType,
} from "@/lib/onboarding-people-summary";
import type {
  MorningBriefEvidenceStrength,
  MorningBriefProofClaimsAllowed,
} from "@/lib/morning-tto-coaching-brief-v1";

export const MORNING_BRIEF_INTERPRETER_INPUT_VERSION =
  "morning_brief_interpreter_input_v1" as const;

/** Match Morning relationship packet people cap. */
export const MORNING_BRIEF_IMPORTANT_PEOPLE_MAX = 8 as const;
export const MORNING_BRIEF_LIFE_CONTEXT_VALUE_MAX = 200 as const;
export const MORNING_BRIEF_THREAD_WINDOW_DAYS = 21 as const;
export const MORNING_BRIEF_THREAD_MAX_MESSAGES = 30 as const;

export type MorningBriefSpineOutcome = "user_yes" | "user_no" | "user_partial";

export type MorningBriefExactThreadMessage = {
  sender: "coach" | "user";
  sent_at_utc: string;
  sent_at_local: string;
  local_day_key: string;
  local_weekday: string;
  day_relation_to_message: string;
  body: string;
};

export type MorningBriefInterpreterInputV1 = {
  version: typeof MORNING_BRIEF_INTERPRETER_INPUT_VERSION;
  message_for: {
    timezone: string;
    local_date: string;
    local_weekday: string;
    daypart: "morning";
  };
  mechanical: {
    days_since_last_user_response: number | null;
    never_replied: boolean;
    recent_unanswered_outbound_count: number;
  };
  canonical_goal: {
    text: string;
  };
  pending_goal_change: {
    candidate_text: string;
    status: "awaiting_user_confirmation";
  } | null;
  available_identity: {
    text: string;
  } | null;
  available_important_people: Array<{
    name: string;
    relationship: string;
  }>;
  available_life_context: Array<{
    type: string;
    value: string;
  }>;
  truth_spine: {
    latest_outcome: MorningBriefSpineOutcome | null;
    latest_outcome_at: string | null;
    latest_outcome_message: string | null;
    evidence_strength: MorningBriefEvidenceStrength;
    consistency_supported: boolean;
    proof_claims_allowed: MorningBriefProofClaimsAllowed;
  };
  /** Projection hint only — exact_thread is authoritative for conversation. */
  thread_memory_hint: {
    authority: "non_authoritative_projection";
    open_question_pending: boolean;
    open_question_text: string | null;
    open_question_answer_text: string | null;
  } | null;
  exact_thread: {
    window_days: typeof MORNING_BRIEF_THREAD_WINDOW_DAYS;
    max_messages: typeof MORNING_BRIEF_THREAD_MAX_MESSAGES;
    messages: MorningBriefExactThreadMessage[];
    omitted_older_turn_count: number;
  };
};

export const MORNING_BRIEF_LIFE_CONTEXT_TYPES = [
  "responsibility",
  "partner_name",
  "children_summary",
  "relationship_status",
  "work_challenge",
  "physical_state",
  "health_goal",
  "energy_obstacles",
  "pressure_summary",
  "proud_of",
  "best_self_trigger",
] as const;

export type MorningBriefLifeContextType =
  (typeof MORNING_BRIEF_LIFE_CONTEXT_TYPES)[number];

/** Individual person labels (not plural people_summary mirror copy). */
const PERSON_RELATIONSHIP_LABELS: Record<ImportantPeopleRelationshipType, string> = {
  spouse_partner: "spouse/partner",
  child: "child",
  grandchild: "grandchild",
  team_player_staff: "team member",
  family_member: "family member",
  other: "other",
};

export function humanizeImportantPeopleRelationship(relationshipType: string): string {
  const t = relationshipType.trim();
  if (isImportantPeopleRelationshipType(t)) {
    return PERSON_RELATIONSHIP_LABELS[t];
  }
  return t.replace(/_/g, " ") || "other";
}

function trimOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim().replace(/\s+/g, " ");
  return t ? t : null;
}

function capValue(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export function mapSpineOutcomeToBriefOutcome(
  spine: MorningBriefSpineOutcome | null
): "completed" | "partial" | "missed" | "no_recent_evidence" {
  if (spine === "user_yes") return "completed";
  if (spine === "user_no") return "missed";
  if (spine === "user_partial") return "partial";
  return "no_recent_evidence";
}

export function buildProofClaimsAllowedFromSpine(
  latest: MorningBriefSpineOutcome | null,
  evidenceStrength: MorningBriefEvidenceStrength
): MorningBriefProofClaimsAllowed {
  return {
    completion: latest === "user_yes",
    miss: latest === "user_no",
    partial: latest === "user_partial",
    proof: latest === "user_yes" && evidenceStrength === "verified",
  };
}

/**
 * Evidence strength from spine counts only — never from plan/goal English.
 * verified requires explicit proof metadata flag from caller.
 */
export function deriveEvidenceStrengthFromSpine(args: {
  matchingOutcomeCount: number;
  hasVerifiedProofMetadata: boolean;
}): MorningBriefEvidenceStrength {
  if (args.matchingOutcomeCount <= 0) return "none";
  if (args.hasVerifiedProofMetadata) return "verified";
  if (args.matchingOutcomeCount >= 2) return "repeated";
  return "stated_once";
}

/** Consistency requires repeated matching outcomes — one completion is never enough. */
export function deriveConsistencySupportedFromSpine(matchingOutcomeCount: number): boolean {
  return matchingOutcomeCount >= 2;
}

export type AssembleMorningBriefInterpreterInputArgs = {
  timezone: string;
  localDate: string;
  localWeekday: string;
  daysSinceLastUserResponse: number | null;
  neverReplied: boolean;
  recentUnansweredOutboundCount: number;
  /** Effective coaching ask / behavior text — not goal title. */
  canonicalGoalText: string;
  pendingGoalChange: {
    candidate_text: string;
    status: "awaiting_user_confirmation";
  } | null;
  identityAnchorText: string | null;
  /**
   * Quotable-source gate for ungated callers. Ignored for inclusion when
   * identityAlreadyQuotableGated is true (do not invent a source string).
   */
  identitySource: string | null;
  /**
   * When true, identityAnchorText already passed the canonical quotable-identity
   * gate upstream (e.g. MorningRelationshipPacket). Accept text without a
   * fabricated identity_source. Ungated callers must leave this false/undefined
   * and satisfy isQuotableIdentitySource(identitySource).
   */
  identityAlreadyQuotableGated?: boolean;
  importantPeople: Array<{
    display_name: string;
    relationship_type: string;
    is_active?: boolean;
    removed_at?: string | null;
  }>;
  lifeContextProfile: Partial<Record<MorningBriefLifeContextType, string | null | undefined>>;
  latestOutcome: MorningBriefSpineOutcome | null;
  latestOutcomeAt: string | null;
  latestOutcomeMessage: string | null;
  matchingOutcomeCount: number;
  hasVerifiedProofMetadata: boolean;
  threadMemoryHint: {
    open_question_pending: boolean;
    open_question_text: string | null;
    open_question_answer_text: string | null;
  } | null;
  exactThreadMessages: MorningBriefExactThreadMessage[];
  omittedOlderTurnCount?: number;
};

/**
 * Pure assembler: mechanical + canonical facts only.
 * Does not interpret English, choose moves, pressure, or goal role.
 */
export function assembleMorningBriefInterpreterInputV1(
  args: AssembleMorningBriefInterpreterInputArgs
): MorningBriefInterpreterInputV1 | { ok: false; error: string } {
  const goalText = trimOrNull(args.canonicalGoalText);
  if (!goalText) {
    return { ok: false, error: "missing_canonical_goal" };
  }

  const localDate = trimOrNull(args.localDate);
  const localWeekday = trimOrNull(args.localWeekday);
  const timezone = trimOrNull(args.timezone);
  if (!localDate || !localWeekday || !timezone) {
    return { ok: false, error: "invalid_message_for" };
  }

  const unanswered = Math.max(0, Math.floor(args.recentUnansweredOutboundCount));
  if (!Number.isFinite(unanswered)) {
    return { ok: false, error: "invalid_unanswered_outbound_count" };
  }

  let available_identity: { text: string } | null = null;
  const identityText = trimOrNull(args.identityAnchorText);
  if (identityText) {
    if (args.identityAlreadyQuotableGated === true) {
      // Upstream already applied the canonical quotable gate — no source invented.
      available_identity = { text: identityText };
    } else if (isQuotableIdentitySource(args.identitySource)) {
      available_identity = { text: identityText };
    }
  }

  const available_important_people: Array<{ name: string; relationship: string }> = [];
  for (const person of args.importantPeople) {
    if (available_important_people.length >= MORNING_BRIEF_IMPORTANT_PEOPLE_MAX) break;
    if (person.is_active === false) continue;
    if (person.removed_at != null && String(person.removed_at).trim()) continue;
    const name = trimOrNull(person.display_name);
    if (!name) continue;
    const relationship = humanizeImportantPeopleRelationship(
      typeof person.relationship_type === "string" ? person.relationship_type : ""
    );
    available_important_people.push({
      name: capValue(name, 80),
      relationship: capValue(relationship, 80),
    });
  }

  const available_life_context: Array<{ type: string; value: string }> = [];
  for (const type of MORNING_BRIEF_LIFE_CONTEXT_TYPES) {
    const value = trimOrNull(args.lifeContextProfile[type]);
    if (!value) continue;
    available_life_context.push({
      type,
      value: capValue(value, MORNING_BRIEF_LIFE_CONTEXT_VALUE_MAX),
    });
  }

  const matching = Math.max(0, Math.floor(args.matchingOutcomeCount));
  const evidence_strength = deriveEvidenceStrengthFromSpine({
    matchingOutcomeCount: matching,
    hasVerifiedProofMetadata: args.hasVerifiedProofMetadata === true,
  });
  const consistency_supported = deriveConsistencySupportedFromSpine(matching);
  const proof_claims_allowed = buildProofClaimsAllowedFromSpine(
    args.latestOutcome,
    evidence_strength
  );

  let pending_goal_change: MorningBriefInterpreterInputV1["pending_goal_change"] = null;
  if (args.pendingGoalChange) {
    const candidate = trimOrNull(args.pendingGoalChange.candidate_text);
    if (
      candidate &&
      args.pendingGoalChange.status === "awaiting_user_confirmation"
    ) {
      pending_goal_change = {
        candidate_text: capValue(candidate, 400),
        status: "awaiting_user_confirmation",
      };
    }
  }

  let thread_memory_hint: MorningBriefInterpreterInputV1["thread_memory_hint"] = null;
  if (args.threadMemoryHint) {
    thread_memory_hint = {
      authority: "non_authoritative_projection",
      open_question_pending: args.threadMemoryHint.open_question_pending === true,
      open_question_text: trimOrNull(args.threadMemoryHint.open_question_text),
      open_question_answer_text: trimOrNull(
        args.threadMemoryHint.open_question_answer_text
      ),
    };
  }

  const messages: MorningBriefExactThreadMessage[] = [];
  for (const m of args.exactThreadMessages) {
    if (messages.length >= MORNING_BRIEF_THREAD_MAX_MESSAGES) break;
    if (m.sender !== "coach" && m.sender !== "user") continue;
    const body = typeof m.body === "string" ? m.body : "";
    // Assembler accepts only provided real messages; callers must not pass drafts.
    messages.push({
      sender: m.sender,
      sent_at_utc: String(m.sent_at_utc ?? ""),
      sent_at_local: String(m.sent_at_local ?? ""),
      local_day_key: String(m.local_day_key ?? ""),
      local_weekday: String(m.local_weekday ?? ""),
      day_relation_to_message: String(m.day_relation_to_message ?? ""),
      body,
    });
  }

  return {
    version: MORNING_BRIEF_INTERPRETER_INPUT_VERSION,
    message_for: {
      timezone,
      local_date: localDate,
      local_weekday: localWeekday,
      daypart: "morning",
    },
    mechanical: {
      days_since_last_user_response:
        args.daysSinceLastUserResponse == null
          ? null
          : Math.floor(args.daysSinceLastUserResponse),
      never_replied: args.neverReplied === true,
      recent_unanswered_outbound_count: unanswered,
    },
    canonical_goal: { text: capValue(goalText, 400) },
    pending_goal_change,
    available_identity,
    available_important_people,
    available_life_context,
    truth_spine: {
      latest_outcome: args.latestOutcome,
      latest_outcome_at: trimOrNull(args.latestOutcomeAt),
      latest_outcome_message: trimOrNull(args.latestOutcomeMessage),
      evidence_strength,
      consistency_supported,
      proof_claims_allowed,
    },
    thread_memory_hint,
    exact_thread: {
      window_days: MORNING_BRIEF_THREAD_WINDOW_DAYS,
      max_messages: MORNING_BRIEF_THREAD_MAX_MESSAGES,
      messages,
      omitted_older_turn_count: Math.max(0, Math.floor(args.omittedOlderTurnCount ?? 0)),
    },
  };
}

export function isMorningBriefInterpreterInputV1(
  value: unknown
): value is MorningBriefInterpreterInputV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as MorningBriefInterpreterInputV1;
  return (
    v.version === MORNING_BRIEF_INTERPRETER_INPUT_VERSION &&
    v.message_for?.daypart === "morning" &&
    typeof v.canonical_goal?.text === "string" &&
    Array.isArray(v.available_important_people) &&
    Array.isArray(v.exact_thread?.messages)
  );
}
