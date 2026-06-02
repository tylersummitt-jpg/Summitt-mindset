/**
 * Relationship Packet v1.7 — structured 7-day evidence-backed memory (read-only, no schema).
 */

import type { V2EventRowForAi } from "@/lib/v2-commitment";
import type { V2CommitmentSmsThreadMemory } from "@/lib/v2-commitment-sms-thread-memory";
import {
  allowedRelativeLabelForLocalDay,
  getLocalDayKeyForTimestamp,
  type TemporalContractV1,
  type TemporalRelativeLabel,
} from "@/lib/sms-temporal-contract-v1";

export const RELATIONSHIP_MEMORY_7D_WINDOW_DAYS = 7;
export const RELATIONSHIP_MEMORY_7D_WINDOW_MS =
  RELATIONSHIP_MEMORY_7D_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export const DEFAULT_MEMORY_7D_SECTION_CHAR_BUDGET = 1_000;
export const MAX_MEMORY_7D_ITEMS_PER_CATEGORY = 2;
export const MAX_MEMORY_7D_DIRECT_ANSWER_HISTORY = 3;
export const MAX_MEMORY_7D_EVIDENCE_CHARS = 120;

export type Memory7dItem = {
  summary: string;
  evidence: string;
  at: string;
  local_day_key?: string | null;
  allowed_relative_label?: TemporalRelativeLabel | null;
  source: string;
  message_sid: string | null;
  is_exact_body: boolean;
};

export type Memory7dBlockerItem = Memory7dItem & {
  count?: number;
};

export type Memory7dProofItem = {
  summary: string;
  proof_type: string;
  evidence: string;
  at: string;
  local_day_key?: string | null;
  allowed_relative_label?: TemporalRelativeLabel | null;
  source: string;
  message_sid: string | null;
  is_exact_body: false;
};

export type Memory7dOpenLoopItem = {
  question_or_plan: string;
  evidence: string;
  last_seen_at: string;
  source: string;
  message_sid: string | null;
};

export type Memory7dQaPair = {
  coach_question: string;
  user_answer: string;
  answer_type: string | null;
  at: string;
  source: string;
  message_sid: string | null;
};

export type RelationshipMemory7dContextFlags = {
  pending_plan_proof_active?: boolean;
  reentry_active?: boolean;
  silence_tier?: string | null;
  unanswered_checks?: number | null;
  days_since_last_user_outcome?: number | null;
};

export type RelationshipMemory7dData = {
  window_days: typeof RELATIONSHIP_MEMORY_7D_WINDOW_DAYS;
  built_at: string;
  outcome_counts: {
    yes: number;
    no: number;
    partial: number;
    blockers: number;
    checks_sent: number;
  };
  wins: Memory7dItem[];
  misses: Memory7dItem[];
  partials: Memory7dItem[];
  comebacks: Memory7dItem[];
  blockers: Memory7dBlockerItem[];
  proof_moments: Memory7dProofItem[];
  open_loops: Memory7dOpenLoopItem[];
  direct_answer_history: Memory7dQaPair[];
  context_flags: RelationshipMemory7dContextFlags;
};

export type RelationshipMemory7dResult = RelationshipMemory7dData & {
  meta: {
    item_count: number;
    sources_used: string[];
    truncated?: boolean;
  };
};

const PROOF_MOMENT_LABELS: Record<string, string> = {
  comeback_after_miss: "came back after a miss",
  followed_through: "followed through on the bar",
  streak_continued: "stacked honest yeses",
  first_completion: "first clear yes on this bar",
  meaningful_streak: "sustained honest yes streak",
  honest_miss: "answered honestly on a miss",
  partial_but_stayed_engaged: "stayed engaged on a partial",
  blocker_named: "named the obstacle instead of disappearing",
  repair_trust: "repaired clarity after friction",
  memory_updated: "confirmed coaching context on SMS",
  commitment_tightened: "tightened the bar with intention",
  commitment_replaced: "chose a clearer commitment",
};

function truncateEvidence(text: string, max = MAX_MEMORY_7D_EVIDENCE_CHARS): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function localDayKeyFromOutcomePayload(
  p: Record<string, unknown> | null,
  occurredAt: string,
  timezone: string
): string {
  const meaning = p?.inbound_meaning;
  if (meaning && typeof meaning === "object" && !Array.isArray(meaning)) {
    const m = meaning as Record<string, unknown>;
    const reported =
      typeof m.reported_for_day_key === "string" ? m.reported_for_day_key.trim() : "";
    if (reported) return reported;
    const spoken =
      typeof m.spoken_local_day_key === "string" ? m.spoken_local_day_key.trim() : "";
    if (spoken) return spoken;
  }
  return getLocalDayKeyForTimestamp(occurredAt, timezone);
}

export function applyMemory7dTemporalLabels(
  data: RelationshipMemory7dData,
  contract: Pick<TemporalContractV1, "today_key" | "yesterday_key" | "tomorrow_key">
): RelationshipMemory7dData {
  const labelItem = <T extends { local_day_key?: string | null; allowed_relative_label?: TemporalRelativeLabel | null }>(
    item: T
  ): T => {
    const key = item.local_day_key?.trim();
    if (!key) return item;
    return {
      ...item,
      allowed_relative_label: allowedRelativeLabelForLocalDay({
        eventLocalDayKey: key,
        todayKey: contract.today_key,
        yesterdayKey: contract.yesterday_key,
        tomorrowKey: contract.tomorrow_key,
      }),
    };
  };

  return {
    ...data,
    wins: data.wins.map(labelItem),
    misses: data.misses.map(labelItem),
    partials: data.partials.map(labelItem),
    comebacks: data.comebacks.map(labelItem),
    proof_moments: data.proof_moments.map(labelItem),
  };
}

function payloadRecord(payload: unknown): Record<string, unknown> | null {
  if (payload != null && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return null;
}

function messageSidFromPayload(p: Record<string, unknown> | null): string | null {
  if (!p) return null;
  const sid = p.message_sid ?? p.inbound_message_sid;
  if (typeof sid === "string" && sid.trim()) return sid.trim();
  return null;
}

function outcomeEvidence(p: Record<string, unknown> | null, eventType: string): string {
  const msg = typeof p?.message === "string" ? p.message.trim() : "";
  if (msg) return truncateEvidence(msg);
  return eventType.replace(/_/g, " ");
}

function proofLabel(proofType: string): string {
  return PROOF_MOMENT_LABELS[proofType] ?? proofType.replace(/_/g, " ");
}

function countMemory7dItems(data: RelationshipMemory7dData): number {
  return (
    data.wins.length +
    data.misses.length +
    data.partials.length +
    data.comebacks.length +
    data.blockers.length +
    data.proof_moments.length +
    data.open_loops.length +
    data.direct_answer_history.length
  );
}

function withinWindow(iso: string, cutoffMs: number): boolean {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= cutoffMs;
}

function detectComebacks(eventsAsc: V2EventRowForAi[], cutoffMs: number): Memory7dItem[] {
  const comebacks: Memory7dItem[] = [];
  let seenNegAt: string | null = null;
  let seenNegType: string | null = null;

  for (const e of eventsAsc) {
    if (!withinWindow(e.occurred_at, cutoffMs)) continue;

    if (e.event_type === "user_no" || e.event_type === "user_partial") {
      seenNegAt = e.occurred_at;
      seenNegType = e.event_type;
      continue;
    }

    if (e.event_type === "user_yes" && seenNegAt && seenNegType) {
      comebacks.push({
        summary: "comeback_after_miss_or_partial",
        evidence: truncateEvidence(`${seenNegType} at ${seenNegAt} → user_yes at ${e.occurred_at}`),
        at: e.occurred_at,
        source: "v2_commitment_event:comeback_chain",
        message_sid: messageSidFromPayload(payloadRecord(e.payload_json)),
        is_exact_body: false,
      });
      seenNegAt = null;
      seenNegType = null;
      if (comebacks.length >= MAX_MEMORY_7D_ITEMS_PER_CATEGORY) break;
    }
  }

  return comebacks;
}

function buildDirectAnswerHistory(
  projection: V2CommitmentSmsThreadMemory | null | undefined,
  cutoffMs: number
): Memory7dQaPair[] {
  if (!projection) return [];

  const answersByTime = [...projection.last_5_user_answers].sort(
    (a, b) => new Date(a.answered_at).getTime() - new Date(b.answered_at).getTime()
  );
  const questions = [...projection.last_5_coach_questions].sort(
    (a, b) => new Date(a.asked_at).getTime() - new Date(b.asked_at).getTime()
  );

  const pairs: Memory7dQaPair[] = [];
  for (const ans of answersByTime) {
    if (!withinWindow(ans.answered_at, cutoffMs)) continue;
    const q =
      [...questions].reverse().find((cq) => new Date(cq.asked_at).getTime() <= new Date(ans.answered_at).getTime()) ??
      null;
    if (!q) continue;
    pairs.push({
      coach_question: truncateEvidence(q.text, 160),
      user_answer: truncateEvidence(ans.text, 160),
      answer_type: projection.open_question_expected_answer_type?.trim() ?? null,
      at: ans.answered_at,
      source: "v2_commitment_sms_thread_memory",
      message_sid: ans.message_sid ?? q.message_sid,
    });
  }

  return pairs.slice(-MAX_MEMORY_7D_DIRECT_ANSWER_HISTORY);
}

function buildOpenLoops(
  projection: V2CommitmentSmsThreadMemory | null | undefined,
  cutoffMs: number
): Memory7dOpenLoopItem[] {
  if (!projection?.open_question_pending || !projection.open_question_text?.trim()) return [];
  const askedAt = projection.open_question_asked_at?.trim();
  if (!askedAt || !withinWindow(askedAt, cutoffMs)) return [];

  return [
    {
      question_or_plan: truncateEvidence(projection.open_question_text.trim(), 160),
      evidence: truncateEvidence(projection.open_question_text.trim(), 160),
      last_seen_at: askedAt,
      source: "v2_commitment_sms_thread_memory:open_question_pending",
      message_sid: projection.open_question_source_message_sid,
    },
  ];
}

export function buildRelationshipMemory7d(args: {
  clerkUserId: string;
  commitmentId: string;
  now?: Date;
  timezone?: string;
  preloadedEvents?: V2EventRowForAi[];
  preloadedProjection?: V2CommitmentSmsThreadMemory | null;
  dailyContextFlags?: RelationshipMemory7dContextFlags | null;
}): RelationshipMemory7dResult {
  void args.clerkUserId;

  const timezone =
    typeof args.timezone === "string" && args.timezone.trim() ? args.timezone.trim() : "America/New_York";

  const now = args.now ?? new Date();
  const cutoffMs = now.getTime() - RELATIONSHIP_MEMORY_7D_WINDOW_MS;
  const events = args.preloadedEvents ?? [];
  const sourcesUsed = new Set<string>();

  let yes = 0;
  let no = 0;
  let partial = 0;
  let blockers = 0;
  let checks = 0;

  const wins: Memory7dItem[] = [];
  const misses: Memory7dItem[] = [];
  const partials: Memory7dItem[] = [];
  const blockersList: Memory7dBlockerItem[] = [];
  const proofMoments: Memory7dProofItem[] = [];
  const proofTypesSeen = new Set<string>();

  const eventsAsc = [...events].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  );
  const eventsNewestFirst = [...eventsAsc].reverse();

  for (const e of eventsNewestFirst) {
    if (!withinWindow(e.occurred_at, cutoffMs)) continue;
    const p = payloadRecord(e.payload_json);
    const sid = messageSidFromPayload(p);
    const source = `v2_commitment_event:${e.event_type}`;

    switch (e.event_type) {
      case "user_yes":
        yes += 1;
        if (wins.length < MAX_MEMORY_7D_ITEMS_PER_CATEGORY) {
          wins.push({
            summary: "user_yes",
            evidence: outcomeEvidence(p, e.event_type),
            at: e.occurred_at,
            local_day_key: localDayKeyFromOutcomePayload(p, e.occurred_at, timezone),
            source,
            message_sid: sid,
            is_exact_body: Boolean(typeof p?.message === "string" && p.message.trim()),
          });
          sourcesUsed.add("v2_commitment_event");
        }
        break;
      case "user_no":
        no += 1;
        if (misses.length < MAX_MEMORY_7D_ITEMS_PER_CATEGORY) {
          misses.push({
            summary: "user_no",
            evidence: outcomeEvidence(p, e.event_type),
            at: e.occurred_at,
            source,
            message_sid: sid,
            is_exact_body: Boolean(typeof p?.message === "string" && p.message.trim()),
          });
          sourcesUsed.add("v2_commitment_event");
        }
        break;
      case "user_partial":
        partial += 1;
        if (partials.length < MAX_MEMORY_7D_ITEMS_PER_CATEGORY) {
          partials.push({
            summary: "user_partial",
            evidence: outcomeEvidence(p, e.event_type),
            at: e.occurred_at,
            source,
            message_sid: sid,
            is_exact_body: Boolean(typeof p?.message === "string" && p.message.trim()),
          });
          sourcesUsed.add("v2_commitment_event");
        }
        break;
      case "blocker_captured":
        blockers += 1;
        if (blockersList.length < MAX_MEMORY_7D_ITEMS_PER_CATEGORY) {
          const msg = typeof p?.message === "string" ? p.message.trim() : "";
          blockersList.push({
            summary: "blocker_captured",
            evidence: msg ? truncateEvidence(msg) : "blocker_captured",
            at: e.occurred_at,
            source,
            message_sid: sid,
            is_exact_body: Boolean(msg),
            count: 1,
          });
          sourcesUsed.add("v2_commitment_event");
        }
        break;
      case "check_sent":
        checks += 1;
        break;
      default:
        break;
    }

    if (p?.proof_moment === true) {
      const proofType = typeof p.proof_moment_type === "string" ? p.proof_moment_type.trim() : "";
      const proofLocalDay = localDayKeyFromOutcomePayload(p, e.occurred_at, timezone);
      if (proofType && !proofTypesSeen.has(proofType) && proofMoments.length < MAX_MEMORY_7D_ITEMS_PER_CATEGORY) {
        proofTypesSeen.add(proofType);
        proofMoments.push({
          summary: proofLabel(proofType),
          proof_type: proofType,
          evidence: proofLabel(proofType),
          at: e.occurred_at,
          local_day_key: proofLocalDay,
          source: `v2_commitment_event:proof_moment:${e.event_type}`,
          message_sid: sid,
          is_exact_body: false,
        });
        sourcesUsed.add("v2_commitment_event:proof_moment");
      }
    }
  }

  const comebacks = detectComebacks(eventsAsc, cutoffMs);
  if (comebacks.length) sourcesUsed.add("v2_commitment_event:comeback_chain");

  const projection = args.preloadedProjection ?? null;
  const direct_answer_history = buildDirectAnswerHistory(projection, cutoffMs);
  if (direct_answer_history.length) sourcesUsed.add("v2_commitment_sms_thread_memory");

  const open_loops = buildOpenLoops(projection, cutoffMs);
  if (open_loops.length) sourcesUsed.add("v2_commitment_sms_thread_memory:open_question");

  const data: RelationshipMemory7dData = {
    window_days: RELATIONSHIP_MEMORY_7D_WINDOW_DAYS,
    built_at: now.toISOString(),
    outcome_counts: {
      yes,
      no,
      partial,
      blockers,
      checks_sent: checks,
    },
    wins: wins.reverse(),
    misses: misses.reverse(),
    partials: partials.reverse(),
    comebacks,
    blockers: blockersList.reverse(),
    proof_moments: proofMoments,
    open_loops,
    direct_answer_history,
    context_flags: args.dailyContextFlags ?? {},
  };

  return {
    ...data,
    meta: {
      item_count: countMemory7dItems(data),
      sources_used: [...sourcesUsed],
      truncated: false,
    },
  };
}

function dropOldestFromArray<T>(arr: T[]): T[] {
  if (arr.length <= 1) return [];
  return arr.slice(1);
}

/** Trim section F data to fit budget before packet-level deletion. */
export function trimRelationshipMemory7dData(
  data: RelationshipMemory7dData,
  maxChars: number
): { data: RelationshipMemory7dData; truncated: boolean } {
  let working: RelationshipMemory7dData = { ...data };
  let truncated = false;

  const size = () => JSON.stringify(working).length;
  if (size() <= maxChars) {
    return { data: working, truncated: false };
  }

  const trimStep = (): boolean => {
    if (working.direct_answer_history.length > 0) {
      working = { ...working, direct_answer_history: dropOldestFromArray(working.direct_answer_history) };
      return true;
    }
    if (working.wins.length > 0) {
      working = { ...working, wins: dropOldestFromArray(working.wins) };
      return true;
    }
    if (working.misses.length > 0) {
      working = { ...working, misses: dropOldestFromArray(working.misses) };
      return true;
    }
    if (working.partials.length > 0) {
      working = { ...working, partials: dropOldestFromArray(working.partials) };
      return true;
    }
    if (working.proof_moments.length > 0) {
      working = { ...working, proof_moments: dropOldestFromArray(working.proof_moments) };
      return true;
    }
    if (working.comebacks.length > 0) {
      working = { ...working, comebacks: dropOldestFromArray(working.comebacks) };
      return true;
    }
    if (working.blockers.length > 0) {
      working = { ...working, blockers: dropOldestFromArray(working.blockers) };
      return true;
    }
    if (working.open_loops.length > 0) {
      working = { ...working, open_loops: [] };
      return true;
    }
    const flags = { ...working.context_flags };
    if (flags.unanswered_checks != null) {
      delete flags.unanswered_checks;
      working = { ...working, context_flags: flags };
      return true;
    }
    if (flags.days_since_last_user_outcome != null) {
      delete flags.days_since_last_user_outcome;
      working = { ...working, context_flags: flags };
      return true;
    }
    if (flags.silence_tier != null) {
      delete flags.silence_tier;
      working = { ...working, context_flags: flags };
      return true;
    }
    return false;
  };

  let guard = 0;
  while (size() > maxChars && guard < 40) {
    guard += 1;
    if (!trimStep()) break;
    truncated = true;
  }

  return { data: working, truncated };
}

export function countRelationshipMemory7dItems(data: RelationshipMemory7dData): number {
  return countMemory7dItems(data);
}
