import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import { formatVictoryRoomDate } from "@/lib/v2-victory-room-view";

const EARLIER_CHAPTER_STATUSES = ["completed", "abandoned", "superseded"] as const;
export const EARLIER_CHAPTER_INDEX_LIMIT = 15;

export type EarlierChapterLinkTarget = "season" | "chapter";

export type EarlierChapterIndexRow = {
  commitmentId: string;
  title: string;
  status: string;
  statusLabel: string;
  rangeLabel: string;
  linkTarget: EarlierChapterLinkTarget;
  seasonId: string | null;
  detailHref: string;
  linkLabel: string;
};

export type VictoryEarlierChapterIndex = {
  chapters: EarlierChapterIndexRow[];
};

function truncateOneLine(s: string, max: number): string {
  const x = s.trim().replace(/\s+/g, " ");
  if (x.length <= max) return x;
  return `${x.slice(0, max - 1)}…`;
}

function chapterTitleFromRow(row: Record<string, unknown>): string {
  const t = typeof row.title === "string" ? row.title.trim() : "";
  if (t) return truncateOneLine(t, 120);
  const b = typeof row.behavior_statement === "string" ? row.behavior_statement.trim() : "";
  if (b) return truncateOneLine(b, 100);
  return "Earlier commitment";
}

function formatChapterRangeLabel(
  startedAt: string | null,
  endedAt: string | null,
  updatedAt: string | null
): string {
  const start = startedAt?.trim();
  if (!start) return "Dates unavailable";
  const startFmt = formatVictoryRoomDate(start, undefined);
  const end = endedAt?.trim();
  if (end) {
    return `${startFmt} — ${formatVictoryRoomDate(end, undefined)}`;
  }
  const upd = updatedAt?.trim();
  if (upd) {
    return `Started ${startFmt} · last activity ${formatVictoryRoomDate(upd, undefined)}`;
  }
  return `Started ${startFmt}`;
}

export function earlierChapterStatusLabel(status: string): string {
  if (status === "completed") return "Completed";
  if (status === "superseded") return "Moved to a new standard";
  if (status === "abandoned") return "Ended";
  return "Earlier chapter";
}

function isEligibleStatus(status: string): boolean {
  return (EARLIER_CHAPTER_STATUSES as readonly string[]).includes(status);
}

const CLOSED_SEASON_STATUSES = new Set(["completed", "archived"]);

export type SeasonLinkLookupRow = {
  id: string;
  commitment_id: string;
  status: string;
  started_at: string | null;
};

/**
 * Pick a season detail link only when a closed season row exists.
 * Active-only rows for prior commitments are treated as uncertain → chapter link.
 */
export function pickSeasonIdForEarlierChapterLink(rows: SeasonLinkLookupRow[]): string | null {
  if (rows.length === 0) return null;

  const closed = rows.filter((r) => CLOSED_SEASON_STATUSES.has(r.status));
  if (closed.length === 0) return null;

  closed.sort((a, b) => {
    const ta = Date.parse(a.started_at?.trim() ?? "");
    const tb = Date.parse(b.started_at?.trim() ?? "");
    const aMs = Number.isFinite(ta) ? ta : 0;
    const bMs = Number.isFinite(tb) ? tb : 0;
    if (bMs !== aMs) return bMs - aMs;
    return a.id.localeCompare(b.id);
  });

  return closed[0]!.id;
}

async function fetchSeasonIdByCommitment(
  clerkUserId: string,
  commitmentIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (commitmentIds.length === 0) return out;

  const { data, error } = await supabaseServer
    .from("user_accountability_season")
    .select("id, commitment_id, status, started_at")
    .eq("clerk_user_id", clerkUserId)
    .in("commitment_id", commitmentIds)
    .order("started_at", { ascending: false });

  if (error) {
    console.error("[v2-victory-earlier-chapter-index] season lookup failed", {
      message: error.message,
    });
    return out;
  }

  const byCommitment = new Map<string, SeasonLinkLookupRow[]>();
  for (const raw of data ?? []) {
    const commitment_id =
      typeof raw.commitment_id === "string" ? raw.commitment_id : null;
    const id = typeof raw.id === "string" ? raw.id : null;
    if (!commitment_id || !id) continue;
    const list = byCommitment.get(commitment_id) ?? [];
    list.push({
      id,
      commitment_id,
      status: String(raw.status ?? ""),
      started_at: typeof raw.started_at === "string" ? raw.started_at : null,
    });
    byCommitment.set(commitment_id, list);
  }

  for (const [commitmentId, rows] of byCommitment) {
    const seasonId = pickSeasonIdForEarlierChapterLink(rows);
    if (seasonId) out.set(commitmentId, seasonId);
  }

  return out;
}

function filterEligibleRows(
  rows: unknown[],
  activeCommitmentId: string | null,
  excludeCommitmentIds: string[]
): Record<string, unknown>[] {
  const exclude = new Set(excludeCommitmentIds.filter(Boolean));
  return (rows as Record<string, unknown>[]).filter((r) => {
    if (typeof r.id !== "string") return false;
    if (activeCommitmentId && r.id === activeCommitmentId) return false;
    if (exclude.has(r.id)) return false;
    return isEligibleStatus(String(r.status ?? ""));
  });
}

async function fetchPriorCommitmentRows(clerkUserId: string, fetchLimit: number) {
  return supabaseServer
    .from("v2_commitment")
    .select("id, title, behavior_statement, status, started_at, ended_at, updated_at")
    .eq("clerk_user_id", clerkUserId)
    .in("status", [...EARLIER_CHAPTER_STATUSES])
    .order("started_at", { ascending: false })
    .limit(fetchLimit);
}

export async function hasEarlierChapterHistory(args: {
  clerkUserId: string;
  activeCommitmentId: string | null;
  excludeCommitmentIds: string[];
}): Promise<boolean> {
  const overfetch =
    EARLIER_CHAPTER_INDEX_LIMIT + Math.max(args.excludeCommitmentIds.length, 1) + 5;
  const { data, error } = await fetchPriorCommitmentRows(args.clerkUserId, overfetch);

  if (error) {
    console.error("[v2-victory-earlier-chapter-index] existence check failed", {
      clerk_user_id: args.clerkUserId,
      message: error.message,
    });
    return false;
  }

  return (
    filterEligibleRows(data ?? [], args.activeCommitmentId, args.excludeCommitmentIds).length > 0
  );
}

export async function loadVictoryEarlierChapterIndex(args: {
  clerkUserId: string;
  activeCommitmentId: string | null;
  excludeCommitmentIds: string[];
}): Promise<VictoryEarlierChapterIndex> {
  const overfetch =
    EARLIER_CHAPTER_INDEX_LIMIT + Math.max(args.excludeCommitmentIds.length, 1) + 5;
  const { data, error } = await fetchPriorCommitmentRows(args.clerkUserId, overfetch);

  if (error) {
    console.error("[v2-victory-earlier-chapter-index] index load failed", {
      clerk_user_id: args.clerkUserId,
      message: error.message,
    });
    return { chapters: [] };
  }

  const rows = filterEligibleRows(
    data ?? [],
    args.activeCommitmentId,
    args.excludeCommitmentIds
  ).slice(0, EARLIER_CHAPTER_INDEX_LIMIT);

  const commitmentIds = rows.map((r) => String(r.id));
  const seasonByCommitment = await fetchSeasonIdByCommitment(args.clerkUserId, commitmentIds);

  const chapters: EarlierChapterIndexRow[] = rows.map((row) => {
    const commitmentId = String(row.id);
    const status = String(row.status);
    const seasonId = seasonByCommitment.get(commitmentId) ?? null;
    const linkTarget: EarlierChapterLinkTarget = seasonId ? "season" : "chapter";
    const detailHref = seasonId
      ? `/dashboard/victory-room/seasons/${seasonId}`
      : `/dashboard/victory-room/chapters/${commitmentId}`;

    return {
      commitmentId,
      title: chapterTitleFromRow(row),
      status,
      statusLabel: earlierChapterStatusLabel(status),
      rangeLabel: formatChapterRangeLabel(
        typeof row.started_at === "string" ? row.started_at : null,
        typeof row.ended_at === "string" ? row.ended_at : null,
        typeof row.updated_at === "string" ? row.updated_at : null
      ),
      linkTarget,
      seasonId,
      detailHref,
      linkLabel: linkTarget === "season" ? "View season proof" : "View chapter proof",
    };
  });

  return { chapters };
}
