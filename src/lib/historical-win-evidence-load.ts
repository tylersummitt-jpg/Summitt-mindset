/**
 * Read-only bounded v2_win candidates → source=win historical evidence.
 * Does not create, hide, rank, or mutate Wins.
 */

import { supabaseServer } from "@/lib/supabase-server";
import {
  type HistoricalEvidenceChronologyCarrier,
  type HistoricalEvidenceItem,
} from "@/lib/historical-evidence";
import { survivingMessageSidSet } from "@/lib/durable-user-evidence-load";
import { getDateKeyInTimezone } from "@/lib/timezone";

export const PRIOR_CLOSED_CHAPTER_LIMIT = 3 as const;
export const CHAPTER_WIN_CANDIDATE_MAX = 8 as const;
export const LIFE_IDENTITY_WIN_CANDIDATE_MAX = 2 as const;
export const HISTORICAL_WIN_CANDIDATE_MAX = 10 as const;
export const THEN_STANDARD_BEHAVIOR_CAP = 120 as const;

export const PRIOR_CLOSED_COMMITMENT_STATUSES = [
  "completed",
  "abandoned",
  "superseded",
] as const;

const LIFE_IDENTITY_RELATIONSHIP_TYPES = new Set(["whole_life", "identity"]);
const PRIOR_CLOSED_STATUS_SET = new Set<string>(PRIOR_CLOSED_COMMITMENT_STATUSES);

const PRIOR_SELECT =
  "id, behavior_statement, started_at, ended_at, status" as const;
const WIN_SELECT =
  "id, occurred_at, action_fact, supporting_quote, relationship_type, commitment_id, source_message_sid, sensitivity_caution" as const;

export type PriorClosedCommitmentRow = {
  id: string;
  behavior_statement: string;
  started_at: string;
  ended_at: string | null;
  status: string;
};

export type HistoricalWinRow = {
  id: string;
  occurred_at: string;
  action_fact: string;
  supporting_quote: string | null;
  relationship_type: string;
  commitment_id: string | null;
  source_message_sid: string | null;
  sensitivity_caution: boolean;
};

export type CurrentChapterForWinHistory = {
  id: string;
  behavior_statement: string;
};

export type HistoricalWinEvidenceSource = {
  priors: PriorClosedCommitmentRow[];
  wins: HistoricalWinRow[];
};

const EMPTY_SOURCE: HistoricalWinEvidenceSource = { priors: [], wins: [] };

function compareOccurredAtThenIdAsc(
  a: { occurred_at: string; id: string },
  b: { occurred_at: string; id: string }
): number {
  const aMs = Date.parse(a.occurred_at);
  const bMs = Date.parse(b.occurred_at);
  const aTime = Number.isFinite(aMs) ? aMs : 0;
  const bTime = Number.isFinite(bMs) ? bMs : 0;
  if (aTime !== bTime) return aTime - bTime;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function compareStartedAtDescThenId(
  a: PriorClosedCommitmentRow,
  b: PriorClosedCommitmentRow
): number {
  const aMs = Date.parse(a.started_at);
  const bMs = Date.parse(b.started_at);
  const aTime = Number.isFinite(aMs) ? aMs : 0;
  const bTime = Number.isFinite(bMs) ? bMs : 0;
  if (aTime !== bTime) return bTime - aTime;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

export function takePriorClosedChapters(
  rows: readonly PriorClosedCommitmentRow[]
): PriorClosedCommitmentRow[] {
  return [...rows]
    .filter((row) => PRIOR_CLOSED_STATUS_SET.has(row.status))
    .sort(compareStartedAtDescThenId)
    .slice(0, PRIOR_CLOSED_CHAPTER_LIMIT);
}

function uniqueBookends(rows: readonly HistoricalWinRow[]): HistoricalWinRow[] {
  if (rows.length === 0) return [];
  const sorted = [...rows].sort(compareOccurredAtThenIdAsc);
  const earliest = sorted[0]!;
  const latest = sorted[sorted.length - 1]!;
  if (earliest.id === latest.id) return [earliest];
  return [earliest, latest];
}

export function selectHistoricalWinCandidateRows(args: {
  currentChapterId: string | null;
  priorChapters: readonly PriorClosedCommitmentRow[];
  wins: readonly HistoricalWinRow[];
}): HistoricalWinRow[] {
  const chapterIds: string[] = [];
  const currentId = args.currentChapterId?.trim() || "";
  if (currentId) chapterIds.push(currentId);
  for (const prior of takePriorClosedChapters(args.priorChapters)) {
    if (!chapterIds.includes(prior.id)) chapterIds.push(prior.id);
  }

  const selected: HistoricalWinRow[] = [];
  const selectedIds = new Set<string>();

  for (const chapterId of chapterIds) {
    const chapterWins = args.wins.filter((row) => row.commitment_id === chapterId);
    for (const row of uniqueBookends(chapterWins)) {
      if (selectedIds.has(row.id)) continue;
      selected.push(row);
      selectedIds.add(row.id);
    }
  }

  const lifePool = args.wins.filter(
    (row) =>
      LIFE_IDENTITY_RELATIONSHIP_TYPES.has(row.relationship_type) && !selectedIds.has(row.id)
  );
  for (const row of uniqueBookends(lifePool)) {
    if (selectedIds.has(row.id)) continue;
    selected.push(row);
    selectedIds.add(row.id);
  }

  return selected;
}

function capThenStandardBehavior(behavior: string): string {
  if (behavior.length <= THEN_STANDARD_BEHAVIOR_CAP) return behavior;
  return behavior.slice(0, THEN_STANDARD_BEHAVIOR_CAP);
}

export function formatWinHistoricalEvidence(args: {
  action_fact: string;
  behavior_statement: string | null | undefined;
}): string {
  const fact = args.action_fact;
  const behavior =
    typeof args.behavior_statement === "string" ? args.behavior_statement.trim() : "";
  if (!behavior) return fact;
  if (fact.trim() === behavior) return fact;
  return `Then-standard: ${capThenStandardBehavior(behavior)}. Win: ${fact}`;
}

function winUserQuote(row: HistoricalWinRow): string | undefined {
  if (row.sensitivity_caution === true) return undefined;
  const quote = typeof row.supporting_quote === "string" ? row.supporting_quote.trim() : "";
  return quote ? quote : undefined;
}

function behaviorByChapterId(args: {
  currentChapter: CurrentChapterForWinHistory | null;
  priorChapters: readonly PriorClosedCommitmentRow[];
}): Map<string, string> {
  const map = new Map<string, string>();
  const currentId = args.currentChapter?.id.trim() || "";
  if (currentId && args.currentChapter) {
    map.set(currentId, args.currentChapter.behavior_statement);
  }
  for (const prior of takePriorClosedChapters(args.priorChapters)) {
    if (!map.has(prior.id)) map.set(prior.id, prior.behavior_statement);
  }
  return map;
}

export function projectHistoricalWinEvidenceCarriers(args: {
  currentChapter: CurrentChapterForWinHistory | null;
  priorChapters: readonly PriorClosedCommitmentRow[];
  wins: readonly HistoricalWinRow[];
  timezone: string;
  survivingExactThreadMessageSids: Iterable<string>;
}): HistoricalEvidenceChronologyCarrier[] {
  const inThread = survivingMessageSidSet(args.survivingExactThreadMessageSids);
  const behaviorById = behaviorByChapterId({
    currentChapter: args.currentChapter,
    priorChapters: args.priorChapters,
  });
  const selected = selectHistoricalWinCandidateRows({
    currentChapterId: args.currentChapter?.id ?? null,
    priorChapters: args.priorChapters,
    wins: args.wins,
  });

  const carriers: HistoricalEvidenceChronologyCarrier[] = [];
  for (const row of selected) {
    const sid = typeof row.source_message_sid === "string" ? row.source_message_sid.trim() : "";
    if (sid && inThread.has(sid)) continue;
    const occurred = new Date(row.occurred_at);
    const occurredAtMs = occurred.getTime();
    if (!Number.isFinite(occurredAtMs)) continue;
    const cid = row.commitment_id?.trim() || "";
    const behavior = cid ? behaviorById.get(cid) : undefined;
    const item: HistoricalEvidenceItem = {
      source: "win",
      occurred_at: getDateKeyInTimezone(occurred, args.timezone),
      evidence: formatWinHistoricalEvidence({
        action_fact: row.action_fact,
        behavior_statement: behavior,
      }),
    };
    const userQuote = winUserQuote(row);
    if (userQuote !== undefined) item.user_quote = userQuote;
    carriers.push({ occurred_at_ms: occurredAtMs, id: row.id, item });
  }
  return carriers;
}

function parsePriorRow(raw: unknown): PriorClosedCommitmentRow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id.trim()) return null;
  if (typeof r.status !== "string" || !PRIOR_CLOSED_STATUS_SET.has(r.status)) return null;
  if (typeof r.started_at !== "string") return null;
  if (typeof r.behavior_statement !== "string") return null;
  return {
    id: r.id,
    behavior_statement: r.behavior_statement,
    started_at: r.started_at,
    ended_at: typeof r.ended_at === "string" ? r.ended_at : null,
    status: r.status,
  };
}

function parseWinRow(raw: unknown): HistoricalWinRow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id.trim()) return null;
  if (typeof r.occurred_at !== "string") return null;
  if (typeof r.action_fact !== "string" || r.action_fact.length === 0) return null;
  if (typeof r.relationship_type !== "string") return null;
  const commitmentId =
    r.commitment_id == null ? null : typeof r.commitment_id === "string" ? r.commitment_id : null;
  const sourceMessageSid =
    r.source_message_sid == null
      ? null
      : typeof r.source_message_sid === "string"
        ? r.source_message_sid
        : null;
  const supportingQuote =
    r.supporting_quote == null
      ? null
      : typeof r.supporting_quote === "string"
        ? r.supporting_quote
        : null;
  return {
    id: r.id,
    occurred_at: r.occurred_at,
    action_fact: r.action_fact,
    supporting_quote: supportingQuote,
    relationship_type: r.relationship_type,
    commitment_id: commitmentId,
    source_message_sid: sourceMessageSid,
    sensitivity_caution: r.sensitivity_caution === true,
  };
}

export async function fetchHistoricalWinEvidenceSource(
  clerkUserId: string
): Promise<HistoricalWinEvidenceSource> {
  const clerk = clerkUserId.trim();
  if (!clerk) return EMPTY_SOURCE;
  try {
    const [priorRes, winRes] = await Promise.all([
      supabaseServer
        .from("v2_commitment")
        .select(PRIOR_SELECT)
        .eq("clerk_user_id", clerk)
        .in("status", [...PRIOR_CLOSED_COMMITMENT_STATUSES])
        .order("started_at", { ascending: false })
        .limit(PRIOR_CLOSED_CHAPTER_LIMIT),
      supabaseServer
        .from("v2_win")
        .select(WIN_SELECT)
        .eq("clerk_user_id", clerk)
        .eq("status", "active"),
    ]);

    if (priorRes.error) {
      console.warn("[historical-win-evidence-load-failed]", {
        clerk_user_id: clerk,
        source: "v2_commitment",
        error: priorRes.error.message.slice(0, 160),
      });
      return EMPTY_SOURCE;
    }
    if (winRes.error) {
      console.warn("[historical-win-evidence-load-failed]", {
        clerk_user_id: clerk,
        source: "v2_win",
        error: winRes.error.message.slice(0, 160),
      });
      return EMPTY_SOURCE;
    }

    const priors: PriorClosedCommitmentRow[] = [];
    if (Array.isArray(priorRes.data)) {
      for (const row of priorRes.data) {
        const parsed = parsePriorRow(row);
        if (parsed) priors.push(parsed);
      }
    }

    const wins: HistoricalWinRow[] = [];
    if (Array.isArray(winRes.data)) {
      for (const row of winRes.data) {
        const parsed = parseWinRow(row);
        if (parsed) wins.push(parsed);
      }
    }

    return { priors, wins };
  } catch (err) {
    console.warn("[historical-win-evidence-load-failed]", {
      clerk_user_id: clerk,
      error: err instanceof Error ? err.message.slice(0, 160) : "unknown",
    });
    return EMPTY_SOURCE;
  }
}
