/**
 * Sol Goal Change semantic result — structured interpretation only.
 *
 * AUTHORITY LAW:
 * Conversation context can explain what the member means. It cannot manufacture
 * server state. A prior Coach SMS such as "Do you want 10:30 to replace 9:30?"
 * is not actionable Goal Change pending. Only authoritative server pending
 * (passed in on the input) can be confirmed, rejected, or modified.
 *
 * Concurrent meanings are allowed: planned interruption and saved replace are
 * not mutually exclusive.
 *
 * This module does not write pending_resolution, mutate Current Goal, send SMS,
 * persist thread memory, or call the Goal Change RPC.
 */

import type { InboundRelationshipPacket } from "@/lib/inbound-relationship-packet";

export const SOL_GOAL_CHANGE_SEMANTIC_VERSION = "sol_goal_change_semantic_v1" as const;

export const SOL_GOAL_CHANGE_INTENTS = [
  "none",
  "possible_saved_replace",
  "saved_replace",
  "temporary_adjustment",
] as const;

export type SolGoalChangeIntent = (typeof SOL_GOAL_CHANGE_INTENTS)[number];

export const SOL_GOAL_CHANGE_PENDING_KINDS = [
  "commitment_replace",
  "commitment_tighten",
] as const;

export type SolGoalChangePendingKind = (typeof SOL_GOAL_CHANGE_PENDING_KINDS)[number];

export const SOL_GOAL_CHANGE_PENDING_SMS_STATES = [
  "awaiting_candidate",
  "awaiting_confirmation",
] as const;

export type SolGoalChangePendingSmsState =
  (typeof SOL_GOAL_CHANGE_PENDING_SMS_STATES)[number];

export const SOL_GOAL_CHANGE_CANDIDATE_MAX_CHARS = 280 as const;
export const SOL_GOAL_CHANGE_MEANING_SUMMARY_MAX_CHARS = 400 as const;
export const SOL_GOAL_CHANGE_THREAD_MAX_MESSAGES = 8 as const;
export const SOL_GOAL_CHANGE_THREAD_BODY_MAX_CHARS = 500 as const;

export type SolGoalChangeSemanticThreadMessage = {
  sender: "coach" | "user";
  body: string;
};

/**
 * Server-owned pending snapshot. Exact thread never substitutes for this.
 * `actionable` must already reflect SMS inbound pending rules (kind, source,
 * expiry, sms_state). This interpreter does not re-query the database.
 */
export type SolGoalChangeAuthoritativePending = {
  actionable: boolean;
  kind: SolGoalChangePendingKind | null;
  sms_state: SolGoalChangePendingSmsState | null;
  candidate_behavior_statement: string | null;
  /** Server pending source. Exact thread never substitutes. Optional for older callers. */
  source?: "sms_inbound" | null;
};

export type SolGoalChangeSemanticInput = {
  canonical_saved_behavior_statement: string;
  /** Effective coaching ask when it differs from canonical; otherwise null. */
  effective_coaching_ask: string | null;
  authoritative_pending: SolGoalChangeAuthoritativePending | null;
  latest_inbound_text: string;
  recent_exact_thread: SolGoalChangeSemanticThreadMessage[];
  /** Deterministic PI already known to the server for this turn, if any. */
  planned_interruption_known: boolean;
  timezone: string | null;
  local_daypart: string | null;
};

export type SolGoalChangeSemanticGoalChange = {
  intent: SolGoalChangeIntent;
  candidate_behavior_statement: string | null;
  needs_clarification: boolean;
  requires_confirmation: boolean;
  confirms_existing_pending: boolean;
  rejects_existing_pending: boolean;
  modifies_existing_pending_candidate: boolean;
  member_meaning_summary: string | null;
};

export type SolGoalChangeSemanticConcurrentMeaning = {
  planned_interruption: boolean;
  accountability_update: boolean;
};

export type SolGoalChangeSemanticResult = {
  version: typeof SOL_GOAL_CHANGE_SEMANTIC_VERSION;
  goal_change: SolGoalChangeSemanticGoalChange;
  concurrent_meaning: SolGoalChangeSemanticConcurrentMeaning;
};

export type SolGoalChangeSemanticParseFailure = {
  ok: false;
  result: null;
  error: "invalid_json" | "schema_validation_failed";
};

export type SolGoalChangeSemanticParseSuccess = {
  ok: true;
  result: SolGoalChangeSemanticResult;
};

export type SolGoalChangeSemanticParseResult =
  | SolGoalChangeSemanticParseSuccess
  | SolGoalChangeSemanticParseFailure;

const BARE_CONFIRMATION_RE =
  /^(yes|yep|yeah|yup|y|absolutely|sounds\s+good|ok|okay|sure|i\s+agree)\.?!?$/i;

/**
 * Conservative qualification / alteration signals on latest_inbound_text.
 * Vetoes CLEAN confirmation of the existing pending candidate only.
 * Not a Goal Change interpreter: does not set modify/reject/intent.
 */
const PENDING_CONFIRM_QUALIFICATION_RES: RegExp[] = [
  /\bbut\b/i,
  /\binstead\b/i,
  /\bexcept\b/i,
  /\bonly\b/i,
  /\bjust\s+not\b/i,
  /\bchange\s+it\s+to\b/i,
  /\bactually\b/i,
  /\bmake\s+it\b/i,
  /\brather\b/i,
];

function trimOrNull(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim().replace(/\s+/g, " ");
  if (!t) return null;
  return t.length <= maxChars ? t : t.slice(0, maxChars);
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isIntent(value: unknown): value is SolGoalChangeIntent {
  return (
    typeof value === "string" &&
    (SOL_GOAL_CHANGE_INTENTS as readonly string[]).includes(value)
  );
}

function capThread(
  messages: SolGoalChangeSemanticThreadMessage[] | null | undefined
): SolGoalChangeSemanticThreadMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const sliced = messages.slice(-SOL_GOAL_CHANGE_THREAD_MAX_MESSAGES);
  const out: SolGoalChangeSemanticThreadMessage[] = [];
  for (const m of sliced) {
    if (!m || (m.sender !== "coach" && m.sender !== "user")) continue;
    const body = trimOrNull(m.body, SOL_GOAL_CHANGE_THREAD_BODY_MAX_CHARS);
    if (!body) continue;
    out.push({ sender: m.sender, body });
  }
  return out;
}

export function isBareGoalChangeConfirmationTurn(raw: string): boolean {
  return BARE_CONFIRMATION_RE.test(raw.trim());
}

/**
 * True when inbound introduces a material qualification, modification,
 * contradiction, or alternative to a pending candidate (new bar, exception,
 * restriction, "instead", "but make it …").
 *
 * Safety veto only: prefer not to clean-confirm so the server can clarify.
 * Ordinary confirmations including extra agreement words ("Yes, that sounds
 * perfect") stay false here.
 */
export function inboundHasMaterialGoalChangeConfirmationQualification(
  raw: string
): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (isBareGoalChangeConfirmationTurn(t)) return false;
  return PENDING_CONFIRM_QUALIFICATION_RES.some((re) => re.test(t));
}

/**
 * True only when the server already has Goal Change pending that can be
 * confirmed, rejected, or modified. Exact thread never satisfies this.
 */
export function hasAuthoritativeGoalChangePending(
  pending: SolGoalChangeAuthoritativePending | null | undefined
): boolean {
  if (!pending || pending.actionable !== true) return false;
  if (pending.kind !== "commitment_replace" && pending.kind !== "commitment_tighten") {
    return false;
  }
  return (
    pending.sms_state === "awaiting_candidate" ||
    pending.sms_state === "awaiting_confirmation"
  );
}

export function pendingHasConfirmableCandidate(
  pending: SolGoalChangeAuthoritativePending | null | undefined
): boolean {
  if (!hasAuthoritativeGoalChangePending(pending) || !pending) return false;
  if (pending.sms_state !== "awaiting_confirmation") return false;
  return Boolean(pending.candidate_behavior_statement?.trim());
}

/**
 * Canonical mutation authority exists only after confirming server pending.
 * Conversational agreement with a prior Coach question is not authority.
 */
export function hasCanonicalGoalChangeMutationAuthority(
  result: SolGoalChangeSemanticResult
): boolean {
  return result.goal_change.confirms_existing_pending === true;
}

export function buildSolGoalChangeSemanticInput(args: {
  canonicalSavedBehaviorStatement: string;
  effectiveCoachingAsk?: string | null;
  authoritativePending?: SolGoalChangeAuthoritativePending | null;
  latestInboundText: string;
  recentExactThread?: SolGoalChangeSemanticThreadMessage[] | null;
  plannedInterruptionKnown?: boolean;
  timezone?: string | null;
  localDaypart?: string | null;
}): SolGoalChangeSemanticInput {
  const canonical = args.canonicalSavedBehaviorStatement.trim();
  const effective = (args.effectiveCoachingAsk ?? "").trim();
  return {
    canonical_saved_behavior_statement: canonical,
    effective_coaching_ask:
      effective && effective !== canonical ? effective : null,
    authoritative_pending: args.authoritativePending ?? null,
    latest_inbound_text: args.latestInboundText.trim(),
    recent_exact_thread: capThread(args.recentExactThread),
    planned_interruption_known: args.plannedInterruptionKnown === true,
    timezone: args.timezone?.trim() || null,
    local_daypart: args.localDaypart?.trim() || null,
  };
}

/**
 * Compact input from an existing inbound packet plus server extras.
 * Does not build a new relationship packet.
 */
export function buildSolGoalChangeSemanticInputFromPacket(args: {
  packet: Pick<
    InboundRelationshipPacket,
    "latest_inbound_text" | "exact_thread" | "current_goal" | "hard_state" | "message_for"
  >;
  canonicalBehaviorStatement: string;
  authoritativePending?: SolGoalChangeAuthoritativePending | null;
  plannedInterruptionKnown?: boolean;
}): SolGoalChangeSemanticInput {
  const packetPending = args.packet.hard_state.pending_goal_change;
  const fromPacket: SolGoalChangeAuthoritativePending | null = packetPending
    ? {
        actionable: true,
        kind: "commitment_replace",
        sms_state: "awaiting_confirmation",
        candidate_behavior_statement: packetPending.candidate_text,
      }
    : null;

  const thread = args.packet.exact_thread.messages.map((m) => ({
    sender: m.sender,
    body: m.body,
  }));

  return buildSolGoalChangeSemanticInput({
    canonicalSavedBehaviorStatement: args.canonicalBehaviorStatement,
    effectiveCoachingAsk: args.packet.current_goal.text,
    authoritativePending: args.authoritativePending ?? fromPacket,
    latestInboundText: args.packet.latest_inbound_text,
    recentExactThread: thread,
    plannedInterruptionKnown: args.plannedInterruptionKnown,
    timezone: args.packet.message_for.timezone,
    localDaypart: args.packet.message_for.daypart,
  });
}

function emptyResult(): SolGoalChangeSemanticResult {
  return {
    version: SOL_GOAL_CHANGE_SEMANTIC_VERSION,
    goal_change: {
      intent: "none",
      candidate_behavior_statement: null,
      needs_clarification: false,
      requires_confirmation: false,
      confirms_existing_pending: false,
      rejects_existing_pending: false,
      modifies_existing_pending_candidate: false,
      member_meaning_summary: null,
    },
    concurrent_meaning: {
      planned_interruption: false,
      accountability_update: false,
    },
  };
}

function parseRawShape(raw: unknown): SolGoalChangeSemanticResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== SOL_GOAL_CHANGE_SEMANTIC_VERSION) return null;

  const gc = o.goal_change;
  const cm = o.concurrent_meaning;
  if (!gc || typeof gc !== "object" || Array.isArray(gc)) return null;
  if (!cm || typeof cm !== "object" || Array.isArray(cm)) return null;

  const g = gc as Record<string, unknown>;
  const c = cm as Record<string, unknown>;
  if (!isIntent(g.intent)) return null;

  const needsClarification = asBoolean(g.needs_clarification);
  const requiresConfirmation = asBoolean(g.requires_confirmation);
  const confirms = asBoolean(g.confirms_existing_pending);
  const rejects = asBoolean(g.rejects_existing_pending);
  const modifies = asBoolean(g.modifies_existing_pending_candidate);
  const interruption = asBoolean(c.planned_interruption);
  const accountability = asBoolean(c.accountability_update);
  if (
    needsClarification == null ||
    requiresConfirmation == null ||
    confirms == null ||
    rejects == null ||
    modifies == null ||
    interruption == null ||
    accountability == null
  ) {
    return null;
  }

  if (g.candidate_behavior_statement != null && typeof g.candidate_behavior_statement !== "string") {
    return null;
  }
  if (g.member_meaning_summary != null && typeof g.member_meaning_summary !== "string") {
    return null;
  }

  return {
    version: SOL_GOAL_CHANGE_SEMANTIC_VERSION,
    goal_change: {
      intent: g.intent,
      candidate_behavior_statement: trimOrNull(
        g.candidate_behavior_statement,
        SOL_GOAL_CHANGE_CANDIDATE_MAX_CHARS
      ),
      needs_clarification: needsClarification,
      requires_confirmation: requiresConfirmation,
      confirms_existing_pending: confirms,
      rejects_existing_pending: rejects,
      modifies_existing_pending_candidate: modifies,
      member_meaning_summary: trimOrNull(
        g.member_meaning_summary,
        SOL_GOAL_CHANGE_MEANING_SUMMARY_MAX_CHARS
      ),
    },
    concurrent_meaning: {
      planned_interruption: interruption,
      accountability_update: accountability,
    },
  };
}

/**
 * Deterministic authority overlay. Model output may describe conversation;
 * these flags cannot invent pending that the server did not supply.
 * A qualified / modified inbound cannot survive as clean pending confirmation
 * even if the model set confirms_existing_pending true.
 */
export function applySolGoalChangeSemanticAuthorityLaws(
  parsed: SolGoalChangeSemanticResult,
  input: SolGoalChangeSemanticInput
): SolGoalChangeSemanticResult {
  const pending = input.authoritative_pending;
  const hasPending = hasAuthoritativeGoalChangePending(pending);
  const confirmable = pendingHasConfirmableCandidate(pending);
  const inbound = input.latest_inbound_text.trim();
  const bareYes = isBareGoalChangeConfirmationTurn(inbound);

  const next: SolGoalChangeSemanticResult = {
    version: SOL_GOAL_CHANGE_SEMANTIC_VERSION,
    goal_change: { ...parsed.goal_change },
    concurrent_meaning: {
      planned_interruption:
        parsed.concurrent_meaning.planned_interruption ||
        input.planned_interruption_known === true,
      accountability_update: parsed.concurrent_meaning.accountability_update,
    },
  };

  if (!hasPending) {
    next.goal_change.confirms_existing_pending = false;
    next.goal_change.rejects_existing_pending = false;
    next.goal_change.modifies_existing_pending_candidate = false;
    if (
      bareYes &&
      (next.goal_change.intent === "saved_replace" ||
        next.goal_change.intent === "possible_saved_replace")
    ) {
      next.goal_change.intent = "none";
      next.goal_change.candidate_behavior_statement = null;
      next.goal_change.requires_confirmation = false;
      next.goal_change.needs_clarification = false;
    }
    return next;
  }

  if (!confirmable) {
    next.goal_change.confirms_existing_pending = false;
  }

  if (inboundHasMaterialGoalChangeConfirmationQualification(inbound)) {
    next.goal_change.confirms_existing_pending = false;
  }

  if (next.goal_change.modifies_existing_pending_candidate) {
    next.goal_change.confirms_existing_pending = false;
    next.goal_change.rejects_existing_pending = false;
  }

  if (next.goal_change.rejects_existing_pending) {
    next.goal_change.confirms_existing_pending = false;
    next.goal_change.modifies_existing_pending_candidate = false;
    next.goal_change.candidate_behavior_statement = null;
  }

  if (
    next.goal_change.confirms_existing_pending &&
    !next.goal_change.candidate_behavior_statement &&
    pending?.candidate_behavior_statement
  ) {
    next.goal_change.candidate_behavior_statement =
      pending.candidate_behavior_statement.trim();
  }

  return next;
}

export function parseSolGoalChangeSemanticResult(
  raw: unknown,
  input: SolGoalChangeSemanticInput
): SolGoalChangeSemanticParseResult {
  const parsed = parseRawShape(raw);
  if (!parsed) {
    return { ok: false, result: null, error: "schema_validation_failed" };
  }
  return {
    ok: true,
    result: applySolGoalChangeSemanticAuthorityLaws(parsed, input),
  };
}

export function parseSolGoalChangeSemanticJson(
  text: string,
  input: SolGoalChangeSemanticInput
): SolGoalChangeSemanticParseResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, result: null, error: "invalid_json" };
  }
  let json: unknown;
  try {
    json = JSON.parse(trimmed) as unknown;
  } catch {
    return { ok: false, result: null, error: "invalid_json" };
  }
  return parseSolGoalChangeSemanticResult(json, input);
}

export function emptySolGoalChangeSemanticResult(): SolGoalChangeSemanticResult {
  return emptyResult();
}
