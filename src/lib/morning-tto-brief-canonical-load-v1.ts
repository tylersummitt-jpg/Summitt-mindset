/**
 * Phase 2C — narrow read-only loads for Morning Brief interpreter input.
 * Does not mutate MorningRelationshipPacket. No DB writes.
 */

import { supabaseServer } from "@/lib/supabase-server";
import {
  assembleMorningBriefInterpreterInputV1,
  type AssembleMorningBriefInterpreterInputArgs,
  type MorningBriefExactThreadMessage,
  type MorningBriefInterpreterInputV1,
  type MorningBriefLifeContextType,
  type MorningBriefSpineOutcome,
  MORNING_BRIEF_IMPORTANT_PEOPLE_MAX,
  MORNING_BRIEF_LIFE_CONTEXT_TYPES,
} from "@/lib/morning-tto-brief-canonical-input-v1";
import type { MorningRelationshipPacket } from "@/lib/morning-tto-relationship-packet";
import { loadV2CommitmentSmsThreadMemory } from "@/lib/v2-commitment-sms-thread-memory";

const OUTCOME_EVENT_TYPES = ["user_yes", "user_no", "user_partial"] as const;
const OUTCOME_LOOKBACK_LIMIT = 25;

export type MorningBriefCanonicalPeopleRow = {
  display_name: string;
  relationship_type: string;
  is_active?: boolean;
  removed_at?: string | null;
};

export type MorningBriefCanonicalOutcomeSpine = {
  latestOutcome: MorningBriefSpineOutcome | null;
  latestOutcomeAt: string | null;
  latestOutcomeMessage: string | null;
  matchingOutcomeCount: number;
  /** Always false unless a genuine verified-proof signal exists (none in Phase 2C). */
  hasVerifiedProofMetadata: false;
};

export type MorningBriefCanonicalExtrasV1 = {
  importantPeople: MorningBriefCanonicalPeopleRow[];
  outcomeSpine: MorningBriefCanonicalOutcomeSpine;
  threadMemoryHint: AssembleMorningBriefInterpreterInputArgs["threadMemoryHint"];
};

/**
 * Mechanical unanswered-outbound count from the exact-thread snapshot only.
 * Counts consecutive coach messages after the most recent user message.
 * Does not choose coaching posture.
 */
export function countRecentUnansweredOutboundFromExactThread(
  messages: Array<{ sender: "coach" | "user" }>
): number {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m) continue;
    if (m.sender === "user") break;
    if (m.sender === "coach") count += 1;
  }
  return count;
}

function isSpineOutcome(value: string): value is MorningBriefSpineOutcome {
  return value === "user_yes" || value === "user_no" || value === "user_partial";
}

function extractOutcomeMessage(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  for (const key of ["message", "raw_body", "user_message", "body"] as const) {
    const v = payload[key];
    if (typeof v === "string" && v.trim()) return v.trim().replace(/\s+/g, " ");
  }
  return null;
}

/**
 * Count consecutive newest outcomes matching the latest outcome type.
 * Pure spine counting — no English interpretation.
 */
export function countMatchingLeadingOutcomesFromNewest(
  eventsNewestFirst: Array<{ event_type: string }>
): number {
  if (!eventsNewestFirst.length) return 0;
  const latest = eventsNewestFirst[0]?.event_type;
  if (!latest || !isSpineOutcome(latest)) return 0;
  let n = 0;
  for (const e of eventsNewestFirst) {
    if (e.event_type === latest) n += 1;
    else break;
  }
  return n;
}

export function deriveOutcomeSpineFromEvents(
  eventsNewestFirst: Array<{
    event_type: string;
    occurred_at: string;
    payload_json?: Record<string, unknown> | null;
  }>
): MorningBriefCanonicalOutcomeSpine {
  const latest = eventsNewestFirst[0];
  if (!latest || !isSpineOutcome(latest.event_type)) {
    return {
      latestOutcome: null,
      latestOutcomeAt: null,
      latestOutcomeMessage: null,
      matchingOutcomeCount: 0,
      hasVerifiedProofMetadata: false,
    };
  }
  return {
    latestOutcome: latest.event_type,
    latestOutcomeAt: latest.occurred_at,
    latestOutcomeMessage: extractOutcomeMessage(latest.payload_json ?? null),
    matchingOutcomeCount: countMatchingLeadingOutcomesFromNewest(eventsNewestFirst),
    hasVerifiedProofMetadata: false,
  };
}

/** Read-only: active important people for interpreter (cap 8). */
export async function loadMorningBriefImportantPeopleReadOnly(args: {
  clerkUserId: string;
}): Promise<MorningBriefCanonicalPeopleRow[]> {
  const { data, error } = await supabaseServer
    .from("important_people")
    .select("display_name, relationship_type, is_active, removed_at")
    .eq("clerk_user_id", args.clerkUserId)
    .eq("is_active", true)
    .is("removed_at", null)
    .limit(MORNING_BRIEF_IMPORTANT_PEOPLE_MAX);

  if (error) {
    console.error("[morning-tto-brief-canonical-load] important_people read failed", {
      clerk_user_id: args.clerkUserId,
      message: error.message,
    });
    return [];
  }

  const out: MorningBriefCanonicalPeopleRow[] = [];
  for (const row of data ?? []) {
    if (out.length >= MORNING_BRIEF_IMPORTANT_PEOPLE_MAX) break;
    const display_name = typeof row.display_name === "string" ? row.display_name.trim() : "";
    if (!display_name) continue;
    if (row.is_active === false) continue;
    if (row.removed_at != null && String(row.removed_at).trim()) continue;
    const relationship_type =
      typeof row.relationship_type === "string" ? row.relationship_type.trim() : "";
    out.push({
      display_name,
      relationship_type,
      is_active: true,
      removed_at: null,
    });
  }
  return out;
}

/** Read-only: recent accountability outcomes for evidence/count rules. */
export async function loadMorningBriefOutcomeEventsReadOnly(args: {
  commitmentId: string;
}): Promise<
  Array<{
    event_type: string;
    occurred_at: string;
    payload_json: Record<string, unknown>;
  }>
> {
  const { data, error } = await supabaseServer
    .from("v2_commitment_event")
    .select("event_type, occurred_at, payload_json")
    .eq("commitment_id", args.commitmentId)
    .in("event_type", [...OUTCOME_EVENT_TYPES])
    .order("occurred_at", { ascending: false })
    .limit(OUTCOME_LOOKBACK_LIMIT);

  if (error) {
    console.error("[morning-tto-brief-canonical-load] outcome events read failed", {
      commitment_id: args.commitmentId,
      message: error.message,
    });
    return [];
  }

  return (data ?? []).map((row) => ({
    event_type: String(row.event_type),
    occurred_at: String(row.occurred_at),
    payload_json:
      row.payload_json != null &&
      typeof row.payload_json === "object" &&
      !Array.isArray(row.payload_json)
        ? (row.payload_json as Record<string, unknown>)
        : {},
  }));
}

/**
 * Bundle extras for interpreter assembly. READ ONLY.
 * Thread memory uses loadV2CommitmentSmsThreadMemory only (no upserts).
 */
export async function loadMorningBriefCanonicalExtrasV1(args: {
  clerkUserId: string;
  commitmentId: string;
}): Promise<MorningBriefCanonicalExtrasV1> {
  const [importantPeople, outcomeEvents, threadMemory] = await Promise.all([
    loadMorningBriefImportantPeopleReadOnly({ clerkUserId: args.clerkUserId }),
    loadMorningBriefOutcomeEventsReadOnly({ commitmentId: args.commitmentId }),
    loadV2CommitmentSmsThreadMemory({ commitmentId: args.commitmentId }),
  ]);

  let threadMemoryHint: MorningBriefCanonicalExtrasV1["threadMemoryHint"] = null;
  if (threadMemory) {
    threadMemoryHint = {
      open_question_pending: threadMemory.open_question_pending === true,
      open_question_text: threadMemory.open_question_text,
      open_question_answer_text: threadMemory.open_question_answer_text,
    };
  }

  return {
    importantPeople,
    outcomeSpine: deriveOutcomeSpineFromEvents(outcomeEvents),
    threadMemoryHint,
  };
}

function lifeContextFromPacket(
  packet: MorningRelationshipPacket
): Partial<Record<MorningBriefLifeContextType, string | null | undefined>> {
  const out: Partial<Record<MorningBriefLifeContextType, string | null | undefined>> = {};
  const allowed = new Set<string>(MORNING_BRIEF_LIFE_CONTEXT_TYPES);
  for (const item of packet.personal_context) {
    if (item.type === "important_person") continue;
    if (!allowed.has(item.type)) continue;
    out[item.type as MorningBriefLifeContextType] = item.value;
  }
  return out;
}

/**
 * Side-channel assembly from packet + read-only extras.
 * Packet is not mutated. Identity: packet.current_identity.text is null or already
 * passed the quotable gate in loadMorningRelationshipPacket — use
 * identityAlreadyQuotableGated (no invented identity_source; no second DB read).
 */
export function assembleMorningBriefInterpreterInputFromPacket(args: {
  packet: MorningRelationshipPacket;
  extras: MorningBriefCanonicalExtrasV1;
  messageRequiredToday?: boolean;
  quietRelationshipEligible?: boolean;
}): MorningBriefInterpreterInputV1 | { ok: false; error: string } {
  const { packet, extras } = args;
  const identityText = packet.current_identity.text;
  const exactThreadMessages: MorningBriefExactThreadMessage[] = packet.exact_thread.messages.map(
    (m) => ({
      sender: m.sender,
      sent_at_utc: m.sent_at_utc,
      sent_at_local: m.sent_at_local,
      local_day_key: m.local_day_key,
      local_weekday: m.local_weekday,
      day_relation_to_message: m.day_relation_to_message,
      body: m.body,
    })
  );

  return assembleMorningBriefInterpreterInputV1({
    timezone: packet.message_for.timezone,
    localDate: packet.message_for.local_date,
    localWeekday: packet.message_for.local_weekday,
    daypart: packet.message_for.daypart,
    daysSinceLastUserResponse: packet.last_user_response.days_since,
    neverReplied: packet.last_user_response.never_replied,
    recentUnansweredOutboundCount:
      countRecentUnansweredOutboundFromExactThread(packet.exact_thread.messages),
    canonicalGoalText: packet.current_goal.text,
    pendingGoalChange: packet.hard_state.pending_goal_change,
    identityAnchorText: identityText,
    identitySource: null,
    identityAlreadyQuotableGated: true,
    importantPeople: extras.importantPeople,
    lifeContextProfile: lifeContextFromPacket(packet),
    latestOutcome: extras.outcomeSpine.latestOutcome,
    latestOutcomeAt: extras.outcomeSpine.latestOutcomeAt,
    latestOutcomeMessage: extras.outcomeSpine.latestOutcomeMessage,
    matchingOutcomeCount: extras.outcomeSpine.matchingOutcomeCount,
    hasVerifiedProofMetadata: extras.outcomeSpine.hasVerifiedProofMetadata,
    threadMemoryHint: extras.threadMemoryHint,
    exactThreadMessages,
    omittedOlderTurnCount: packet.exact_thread.omitted_older_turn_count,
    messageRequiredToday: args.messageRequiredToday === true,
    quietRelationshipEligible: args.quietRelationshipEligible === true,
    historicalEvidence: packet.historical_evidence,
  });
}
