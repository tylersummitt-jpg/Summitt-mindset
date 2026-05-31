/**
 * Relationship Packet v1.9 — compact repair snapshots for freshness + memory repeat (read-only, no schema).
 */

import type { DailyV3RelationshipFacts } from "@/lib/v3-daily-relationship-lane";
import type { InboundV3RelationshipFacts } from "@/lib/v3-inbound-relationship-lane";
import type { ThreadFreshnessFacts } from "@/lib/sms-thread-freshness";
import type { ThreadFreshnessViolation } from "@/lib/sms-thread-freshness";
import type { MemoryRepeatRepairContext } from "@/lib/sms-memory-repeat-repair-types";

export const REPAIR_RECENT_THREAD_WINDOW_HOURS = 72 as const;

export const REPAIR_SNAPSHOT_VERSION = "1.0" as const;
export const DEFAULT_REPAIR_SNAPSHOT_MAX_CHARS = 3_500;
export const REPAIR_THREAD_EXCERPT_MAX_MESSAGES = 8;
export const REPAIR_THREAD_BODY_FLOOR_CHARS = 120;
export const REPAIR_THREAD_MIN_MESSAGES = 4;

export type RepairSnapshotKind =
  | "thread_freshness"
  | "memory_repeat"
  | "lane_post_validate"
  | "robot_consent_menu";

export type RepairSnapshotThreadMessage = {
  at: string;
  role: "coach" | "user" | "system_no_send";
  body: string;
};

type Thread72hMessageLike = {
  at: string;
  role: "coach" | "user" | "system_no_send";
  body: string;
};

type Thread72hResultLike = {
  messages: Thread72hMessageLike[];
};

export type RepairRelationshipSnapshotV1 = {
  repair_snapshot_version: typeof REPAIR_SNAPSHOT_VERSION;
  repair_kind: RepairSnapshotKind;
  violation: {
    blocked_reasons: string[];
    blocked_body: string;
    lane_blocked_reasons?: string[];
    rejected_time_candidates?: string[];
    robot_menu_blocked_reasons?: string[];
    stale_topic?: string | null;
    repeated_question?: string | null;
    repeated_phrases?: string[];
    overlap_tokens?: string[];
    temporal_conflict?: string | null;
    forced_repair_strategy?: string | null;
  };
  current_turn: {
    route_kind?: string;
    route_purpose?: string;
    current_user_inbound?: string | null;
    local_time_iso?: string | null;
    daily_purpose?: string | null;
    server_strategy?: string | null;
    accountability_day_key?: string | null;
  };
  structured_recent_truth: {
    thread_freshness?: ThreadFreshnessFacts | null;
    latest_open_question?: string | null;
    latest_answer_after_open_question?: string | null;
    open_question_pending?: boolean | null;
    projection_used?: boolean | null;
    last_5_coach_questions?: string[];
    last_5_user_answers?: string[];
  };
  recent_exact_thread_excerpt: {
    window_hours: typeof REPAIR_RECENT_THREAD_WINDOW_HOURS;
    messages: RepairSnapshotThreadMessage[];
    message_count: number;
  };
  canonical_state_min: {
    commitment_id?: string | null;
    behavior_statement?: string | null;
    effective_ask?: string | null;
    accountability_phase?: string | null;
    route_purpose?: string | null;
    required_constraints?: {
      max_chars?: number;
      required_verbatim_substrings?: string[];
      required_meaning_summary?: string | null;
      forbidden_substrings?: string[];
      rejected_time_candidates?: string[];
      binding_text_verbatim?: string | null;
    };
  };
  proof_victory_permission?: {
    can_reference_victory_room?: boolean | null;
    can_say_saved_as_proof?: boolean | null;
  };
  memory_repeat?: {
    prior_outbound_full_body: string | null;
    recommended_repair_strategy: string;
    forced_repair_strategy?: string | null;
    forbidden_coaching_frames: string[];
    forbidden_content_tokens: string[];
    strategy_examples: string[];
  };
};

export type RepairSnapshotMeta = {
  repair_snapshot_version: typeof REPAIR_SNAPSHOT_VERSION;
  repair_snapshot_kind: RepairSnapshotKind;
  repair_snapshot_chars: number;
  repair_snapshot_truncated: boolean;
};

function compactStrings(items: string[] | null | undefined, max: number): string[] {
  if (!items?.length) return [];
  return items.map((s) => s.trim()).filter(Boolean).slice(0, max);
}

function isInboundFacts(facts: unknown): facts is InboundV3RelationshipFacts {
  if (facts == null || typeof facts !== "object") return false;
  const f = facts as Record<string, unknown>;
  return typeof f.route_purpose === "string" && f.thread != null && typeof f.thread === "object";
}

function isDailyFacts(facts: unknown): facts is DailyV3RelationshipFacts {
  if (facts == null || typeof facts !== "object") return false;
  const f = facts as Record<string, unknown>;
  return typeof f.route_kind === "string" && f.thread_memory != null && typeof f.thread_memory === "object";
}

function thread72hFromFacts(facts: unknown): Thread72hResultLike | null {
  if (isInboundFacts(facts)) {
    return facts.thread.memory_packet?.recent_exact_thread_72h ?? null;
  }
  if (isDailyFacts(facts)) {
    return facts.thread_memory.recent_exact_thread_72h ?? null;
  }
  return null;
}

function toExcerptMessage(m: Thread72hMessageLike): RepairSnapshotThreadMessage {
  return {
    at: m.at,
    role: m.role,
    body: m.body,
  };
}

function buildThreadExcerpt(
  thread72h: Thread72hResultLike | null,
  maxMessages = REPAIR_THREAD_EXCERPT_MAX_MESSAGES
): RepairRelationshipSnapshotV1["recent_exact_thread_excerpt"] {
  const messages = (thread72h?.messages ?? []).slice(-maxMessages).map(toExcerptMessage);
  return {
    window_hours: REPAIR_RECENT_THREAD_WINDOW_HOURS,
    messages,
    message_count: messages.length,
  };
}

function buildCurrentTurn(
  facts: unknown,
  routeKind: "inbound" | "daily",
  routePurpose: string
): RepairRelationshipSnapshotV1["current_turn"] {
  if (isInboundFacts(facts)) {
    return {
      route_purpose: facts.route_purpose ?? routePurpose,
      current_user_inbound: facts.thread.coalesced_inbound_text || facts.thread.latest_inbound_raw || null,
      local_time_iso: facts.user.local_time_iso ?? null,
    };
  }
  if (isDailyFacts(facts)) {
    return {
      route_kind: facts.route_kind,
      route_purpose: routePurpose,
      daily_purpose: facts.accountability.daily_purpose ?? null,
      server_strategy: facts.accountability.server_strategy ?? null,
      accountability_day_key: facts.accountability_day_key ?? null,
      local_time_iso: facts.user.local_time_iso ?? null,
    };
  }
  return {
    route_kind: routeKind,
    route_purpose: routePurpose,
  };
}

function buildStructuredRecentTruth(facts: unknown): RepairRelationshipSnapshotV1["structured_recent_truth"] {
  if (isInboundFacts(facts)) {
    const mp = facts.thread.memory_packet;
    return {
      thread_freshness: facts.thread_freshness ?? null,
      latest_open_question: facts.thread.latest_open_question ?? mp?.latest_open_question ?? null,
      latest_answer_after_open_question:
        facts.thread.latest_answer_after_open_question ?? mp?.latest_answer_after_open_question ?? null,
      open_question_pending: mp?.open_question_pending ?? null,
      projection_used: mp?.projection_used ?? facts.thread.memory_authority?.projection_used ?? null,
      last_5_coach_questions: compactStrings(mp?.last_5_coach_questions, 3),
      last_5_user_answers: compactStrings(mp?.last_5_user_answers, 3),
    };
  }
  if (isDailyFacts(facts)) {
    const tm = facts.thread_memory;
    return {
      thread_freshness: facts.thread_freshness ?? null,
      latest_open_question: tm.latest_open_question ?? null,
      latest_answer_after_open_question: tm.latest_answer_after_open_question ?? null,
      open_question_pending: tm.open_question_pending ?? null,
      projection_used: tm.projection_used ?? null,
      last_5_coach_questions: compactStrings(tm.last_5_coach_questions, 3),
      last_5_user_answers: compactStrings(tm.last_5_user_answers, 3),
    };
  }
  return {
    thread_freshness: extractLooseThreadFreshness(facts),
  };
}

function extractLooseThreadFreshness(facts: unknown): ThreadFreshnessFacts | null {
  if (facts == null || typeof facts !== "object") return null;
  const tf = (facts as Record<string, unknown>).thread_freshness;
  if (tf != null && typeof tf === "object") return tf as ThreadFreshnessFacts;
  return null;
}

function buildCanonicalStateMin(
  facts: unknown,
  routePurpose: string
): RepairRelationshipSnapshotV1["canonical_state_min"] {
  if (isInboundFacts(facts)) {
    return {
      commitment_id: facts.commitment.id ?? null,
      behavior_statement: facts.commitment.behavior_statement ?? null,
      effective_ask: facts.commitment.effective_ask ?? null,
      accountability_phase: facts.commitment.accountability_phase ?? null,
      route_purpose: facts.route_purpose ?? routePurpose,
      required_constraints: {
        max_chars: facts.constraints.max_chars,
        required_verbatim_substrings: facts.constraints.required_verbatim_substrings,
        required_meaning_summary: facts.constraints.required_meaning_summary ?? null,
        forbidden_substrings: facts.constraints.forbidden_substrings?.slice(0, 8),
        rejected_time_candidates: compactStrings(facts.thread.rejected_time_candidates, 6),
      },
    };
  }
  if (isDailyFacts(facts)) {
    return {
      commitment_id: facts.commitment.id ?? null,
      behavior_statement: facts.commitment.behavior_statement ?? null,
      effective_ask: facts.commitment.effective_ask ?? null,
      accountability_phase: facts.commitment.accountability_phase ?? null,
      route_purpose: routePurpose,
      required_constraints: {
        max_chars: facts.constraints.max_chars,
        required_verbatim_substrings: facts.constraints.required_verbatim_substrings,
      },
    };
  }
  const loose = facts as Record<string, unknown> | null;
  const commitment =
    loose?.commitment != null && typeof loose.commitment === "object"
      ? (loose.commitment as Record<string, unknown>)
      : null;
  return {
    behavior_statement:
      typeof commitment?.behavior_statement === "string" ? commitment.behavior_statement : null,
    effective_ask: typeof commitment?.effective_ask === "string" ? commitment.effective_ask : null,
    route_purpose: routePurpose,
  };
}

function buildProofVictoryPermission(facts: unknown): RepairRelationshipSnapshotV1["proof_victory_permission"] {
  if (isInboundFacts(facts)) {
    const hint = facts.v2_accountability?.proof_callout_hint;
    return {
      can_reference_victory_room: hint?.eligible === true ? true : hint ? false : null,
      can_say_saved_as_proof: hint?.proof_callout_claim_saved_allowed === true ? true : false,
    };
  }
  if (isDailyFacts(facts)) {
    return {
      can_reference_victory_room: facts.victory_background != null ? true : null,
      can_say_saved_as_proof: false,
    };
  }
  return {
    can_reference_victory_room: null,
    can_say_saved_as_proof: false,
  };
}

function staleTopicFromFreshness(freshness: ThreadFreshnessFacts | null | undefined): string | null {
  if (!freshness) return null;
  const topics = freshness.do_not_reask_topics?.filter(Boolean) ?? [];
  if (topics.length) return topics.slice(0, 2).join("; ");
  const completed = freshness.completed_actions?.[0]?.text?.trim();
  return completed || null;
}

export function buildRepairRelationshipSnapshotV1(args: {
  repairKind: RepairSnapshotKind;
  routeKind: "inbound" | "daily";
  routePurpose: string;
  blockedBody: string;
  blockedReasons: string[];
  laneFacts: unknown;
  freshness?: ThreadFreshnessFacts | null;
  freshnessViolation?: ThreadFreshnessViolation | null;
  memoryRepeatContext?: MemoryRepeatRepairContext | null;
  forcedRepairStrategy?: string | null;
  overlapTokens?: string[];
  laneBlockedReasons?: string[];
  robotMenuBlockedReasons?: string[];
  bindingTextVerbatim?: string | null;
}): RepairRelationshipSnapshotV1 {
  const structuredTruth = buildStructuredRecentTruth(args.laneFacts);
  const freshness = args.freshness ?? structuredTruth.thread_freshness ?? null;

  const violation: RepairRelationshipSnapshotV1["violation"] = {
    blocked_reasons: args.blockedReasons,
    blocked_body: args.blockedBody,
  };

  if (args.repairKind === "thread_freshness") {
    violation.stale_topic = staleTopicFromFreshness(freshness);
    violation.temporal_conflict =
      freshness?.active_temporal_frame && args.freshnessViolation?.reason
        ? `${freshness.active_temporal_frame} vs ${args.freshnessViolation.reason}`
        : freshness?.active_temporal_frame ?? null;
  }

  if (args.repairKind === "memory_repeat" && args.memoryRepeatContext) {
    const ctx = args.memoryRepeatContext;
    violation.repeated_question = ctx.repeated_question;
    violation.repeated_phrases = ctx.repeated_phrases?.length ? ctx.repeated_phrases : undefined;
    violation.overlap_tokens = args.overlapTokens?.length ? args.overlapTokens : undefined;
    violation.forced_repair_strategy = args.forcedRepairStrategy ?? null;
  }

  if (args.repairKind === "lane_post_validate") {
    violation.lane_blocked_reasons = args.laneBlockedReasons?.length
      ? args.laneBlockedReasons
      : args.blockedReasons;
    if (isInboundFacts(args.laneFacts)) {
      const rejectedTimes = compactStrings(args.laneFacts.thread.rejected_time_candidates, 6);
      if (rejectedTimes.length) {
        violation.rejected_time_candidates = rejectedTimes;
      }
    }
  }

  if (args.repairKind === "robot_consent_menu") {
    violation.robot_menu_blocked_reasons = args.robotMenuBlockedReasons?.length
      ? args.robotMenuBlockedReasons
      : args.blockedReasons;
  }

  const snapshot: RepairRelationshipSnapshotV1 = {
    repair_snapshot_version: REPAIR_SNAPSHOT_VERSION,
    repair_kind: args.repairKind,
    violation,
    current_turn: buildCurrentTurn(args.laneFacts, args.routeKind, args.routePurpose),
    structured_recent_truth: {
      ...structuredTruth,
      thread_freshness: freshness,
    },
    recent_exact_thread_excerpt: buildThreadExcerpt(thread72hFromFacts(args.laneFacts)),
    canonical_state_min: buildCanonicalStateMin(args.laneFacts, args.routePurpose),
    proof_victory_permission: buildProofVictoryPermission(args.laneFacts),
  };

  if (args.repairKind === "robot_consent_menu") {
    const binding = args.bindingTextVerbatim?.trim();
    if (binding) {
      snapshot.canonical_state_min.required_constraints = {
        ...snapshot.canonical_state_min.required_constraints,
        binding_text_verbatim: binding,
      };
    }
  }

  if (args.repairKind === "memory_repeat" && args.memoryRepeatContext) {
    snapshot.memory_repeat = {
      prior_outbound_full_body: args.memoryRepeatContext.prior_outbound_full_body,
      recommended_repair_strategy: args.memoryRepeatContext.recommended_repair_strategy,
      forced_repair_strategy: args.forcedRepairStrategy ?? null,
      forbidden_coaching_frames: args.memoryRepeatContext.forbidden_coaching_frames,
      forbidden_content_tokens: args.memoryRepeatContext.forbidden_content_tokens,
      strategy_examples: args.memoryRepeatContext.strategy_examples,
    };
  }

  return snapshot;
}

function truncateMessageBodies(
  excerpt: RepairRelationshipSnapshotV1["recent_exact_thread_excerpt"],
  maxBodyChars: number
): RepairRelationshipSnapshotV1["recent_exact_thread_excerpt"] {
  return {
    ...excerpt,
    messages: excerpt.messages.map((m) => {
      if (m.body.length <= maxBodyChars) return m;
      return { ...m, body: `${m.body.slice(0, maxBodyChars - 1)}…` };
    }),
  };
}

function dropOldestThreadMessage(
  excerpt: RepairRelationshipSnapshotV1["recent_exact_thread_excerpt"]
): RepairRelationshipSnapshotV1["recent_exact_thread_excerpt"] {
  if (excerpt.messages.length <= REPAIR_THREAD_MIN_MESSAGES) return excerpt;
  const messages = excerpt.messages.slice(1);
  return { ...excerpt, messages, message_count: messages.length };
}

function trimCoachAnswers(snapshot: RepairRelationshipSnapshotV1): RepairRelationshipSnapshotV1 {
  return {
    ...snapshot,
    structured_recent_truth: {
      ...snapshot.structured_recent_truth,
      last_5_coach_questions: snapshot.structured_recent_truth.last_5_coach_questions?.slice(0, 2),
      last_5_user_answers: snapshot.structured_recent_truth.last_5_user_answers?.slice(0, 2),
    },
  };
}

/** Trim snapshot to fit budget; thread messages drop before structured_recent_truth. */
export function trimRepairSnapshotToBudget(
  snapshot: RepairRelationshipSnapshotV1,
  maxChars: number
): { snapshot: RepairRelationshipSnapshotV1; truncated: boolean } {
  let working = snapshot;
  let truncated = false;

  const size = () => JSON.stringify(working).length;
  if (size() <= maxChars) {
    return { snapshot: working, truncated: false };
  }

  const steps: Array<() => boolean> = [
    () => {
      if (!working.proof_victory_permission) return false;
      working = { ...working, proof_victory_permission: undefined };
      truncated = true;
      return true;
    },
    () => {
      const before = working.recent_exact_thread_excerpt.messages.length;
      working = {
        ...working,
        recent_exact_thread_excerpt: dropOldestThreadMessage(working.recent_exact_thread_excerpt),
      };
      if (working.recent_exact_thread_excerpt.messages.length < before) {
        truncated = true;
        return true;
      }
      return false;
    },
    () => {
      const oldest = working.recent_exact_thread_excerpt.messages[0];
      if (!oldest || oldest.body.length <= REPAIR_THREAD_BODY_FLOOR_CHARS) return false;
      const nextMax = Math.max(
        REPAIR_THREAD_BODY_FLOOR_CHARS,
        Math.floor(oldest.body.length * 0.65)
      );
      working = {
        ...working,
        recent_exact_thread_excerpt: truncateMessageBodies(
          working.recent_exact_thread_excerpt,
          nextMax
        ),
      };
      truncated = true;
      return true;
    },
    () => {
      working = trimCoachAnswers(working);
      truncated = true;
      return true;
    },
  ];

  let guard = 0;
  while (size() > maxChars && guard < 40) {
    guard += 1;
    const prev = size();
    let progressed = false;
    for (const step of steps) {
      if (step()) {
        progressed = true;
        break;
      }
    }
    if (!progressed || size() >= prev) break;
  }

  return { snapshot: working, truncated };
}

export function serializeRepairSnapshotForOpenAI(
  snapshot: RepairRelationshipSnapshotV1,
  maxChars = DEFAULT_REPAIR_SNAPSHOT_MAX_CHARS
): { json: string; meta: RepairSnapshotMeta } {
  const trimmed = trimRepairSnapshotToBudget(snapshot, maxChars);
  const json = JSON.stringify(trimmed.snapshot);
  return {
    json: json.length > maxChars ? `${json.slice(0, maxChars - 1)}…` : json,
    meta: {
      repair_snapshot_version: REPAIR_SNAPSHOT_VERSION,
      repair_snapshot_kind: trimmed.snapshot.repair_kind,
      repair_snapshot_chars: Math.min(json.length, maxChars),
      repair_snapshot_truncated: trimmed.truncated || json.length > maxChars,
    },
  };
}

export function buildRepairSnapshotPromptGuidance(): string {
  return `
REPAIR_SNAPSHOT_AUTHORITY (repair_relationship_snapshot_v1 — fix the violation only):
- Fix only the violation in violation.blocked_reasons; do not rewrite unrelated coaching purpose.
- Do not invent facts, proof, outcomes, or patterns beyond the snapshot.
- structured_recent_truth and recent_exact_thread_excerpt beat all other snapshot fields on conflict.
- Preserve canonical_state_min and required_constraints (verbatim substrings, max chars, meaning summary).
- Do not use hard-coded templates or copy strategy_examples verbatim.
- Do not mention Victory Room unless proof_victory_permission.can_reference_victory_room === true.
- If uncertain or constraints cannot be satisfied, return an empty body (fail closed).`;
}

export function repairSnapshotSupportedForRouteKind(routeKind: "inbound" | "daily" | "weekly"): boolean {
  return routeKind === "inbound" || routeKind === "daily";
}

/** Build and trim a repair snapshot for OpenAI repair calls. */
export function prepareRepairSnapshotForOpenAI(
  args: Parameters<typeof buildRepairRelationshipSnapshotV1>[0]
): {
  snapshot: RepairRelationshipSnapshotV1;
  meta: RepairSnapshotMeta;
} {
  const built = buildRepairRelationshipSnapshotV1(args);
  const { snapshot, truncated } = trimRepairSnapshotToBudget(built, DEFAULT_REPAIR_SNAPSHOT_MAX_CHARS);
  const { meta } = serializeRepairSnapshotForOpenAI(snapshot);
  return {
    snapshot,
    meta: {
      ...meta,
      repair_snapshot_truncated: truncated || meta.repair_snapshot_truncated,
    },
  };
}
