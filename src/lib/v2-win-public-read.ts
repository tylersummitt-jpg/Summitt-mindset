/**
 * Public Victory Room Wins — server-only reads from `public.v2_win`.
 * Service-role via supabaseServer; always scoped by clerk_user_id + status=active.
 * Does not weaken RLS or expose service credentials.
 */

import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import { getDateKeyInTimezone, localDayUtcRange, localMonthUtcRange } from "@/lib/timezone";
import { enrichPublicWinsWithMedia } from "@/lib/victory-media/enrich-public-wins-with-media";

/** Home "Your Wins" recent card cap. */
export const PUBLIC_WINS_RECENT_LIMIT = 7;

/** All Wins page page size. */
export const PUBLIC_WINS_PAGE_LIMIT = 50;

/** Columns selected from v2_win for public mapping (never returned raw to clients). */
export const PUBLIC_WIN_SELECT_COLUMNS =
  "id, occurred_at, display_title, display_body, supporting_quote, sensitivity_caution, celebration_appropriate, commitment_id, status, updated_at, source_type, user_edited_at" as const;

/** Month-marker query only — no card fields, quotes, or media. */
export const PUBLIC_WIN_MONTH_MARKER_SELECT_COLUMNS = "id, occurred_at" as const;

/** Optional Victory Media card presentation — never includes Storage paths. */
export type PublicWinMediaDto = {
  id: string;
  cardUrl: string;
  width: number;
  height: number;
};

export type PublicWinDto = {
  id: string;
  occurredAt: string;
  displayTitle: string;
  displayBody: string;
  /** Sanitized; null when omitted for sensitivity / celebration / blank. */
  supportingQuote: string | null;
  celebrationAppropriate: boolean;
  commitmentId: string | null;
  /** Concurrency token for Delete (and future card mutations). Not shown in UI copy. */
  updatedAt: string;
  /**
   * Presentation owner metadata only — not SMS payload, action_fact, or Win truth.
   * Card body visibility is already applied to `displayBody`; these fields are not required by UI.
   */
  sourceType?: string;
  userEditedAt?: string | null;
  /** Optional signed card photo; omitted when absent or enrichment failed. */
  media?: PublicWinMediaDto;
};

export type PublicVictoryWinsHomeResult = {
  totalActiveWins: number;
  recentWins: PublicWinDto[];
};

export type PublicWinsCursor = {
  occurredAt: string;
  id: string;
};

export type PublicAllWinsResult = {
  wins: PublicWinDto[];
  /** True when more active Wins exist after this page. */
  hasMore: boolean;
  /** Pass as searchParam `cursor` for the next page; null when no more. */
  nextCursor: string | null;
  pageLimit: number;
};

type WinRow = {
  id: string;
  occurred_at: string;
  display_title: string;
  display_body: string;
  supporting_quote: string | null;
  sensitivity_caution: boolean;
  celebration_appropriate: boolean;
  commitment_id: string | null;
  status: string;
  updated_at: string;
  source_type?: string | null;
  user_edited_at?: string | null;
};

function requireClerkUserId(clerkUserId: string): string {
  const id = clerkUserId.trim();
  if (!id) {
    throw new Error("v2_win_public_read_requires_clerk_user_id");
  }
  return id;
}

/**
 * Deterministic public quote rules from persisted fields only.
 * Never substitutes raw inbound SMS.
 */
export function sanitizePublicWinSupportingQuote(args: {
  supportingQuote: string | null | undefined;
  sensitivityCaution: boolean;
  celebrationAppropriate: boolean;
}): string | null {
  if (args.sensitivityCaution) return null;
  if (!args.celebrationAppropriate) return null;
  const q = typeof args.supportingQuote === "string" ? args.supportingQuote.trim() : "";
  return q.length > 0 ? q : null;
}

function normalizeWinSourceType(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function normalizeWinUserEditedAt(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Owner-mode for Victory Room card presentation.
 * MANUAL: source_type === "manual"
 * EDITED SYSTEM: user_edited_at is set (typically sms_inbound)
 * UNEDITED SYSTEM: everything else, including sms_inbound with null user_edited_at
 */
export function isMemberOwnedWinPresentation(args: {
  sourceType: string | null | undefined;
  userEditedAt: string | null | undefined;
}): boolean {
  if (normalizeWinSourceType(args.sourceType) === "manual") return true;
  return normalizeWinUserEditedAt(args.userEditedAt) != null;
}

/** Card `displayBody`: stored body for member-owned Wins; empty for unedited system Wins. */
export function publicWinCardDisplayBody(args: {
  displayBody: string;
  sourceType: string | null | undefined;
  userEditedAt: string | null | undefined;
}): string {
  const body = args.displayBody.trim();
  if (!body) return "";
  if (isMemberOwnedWinPresentation(args)) return body;
  return "";
}

export function mapV2WinRowToPublicDto(row: WinRow): PublicWinDto {
  const sourceType = normalizeWinSourceType(row.source_type);
  const userEditedAt = normalizeWinUserEditedAt(row.user_edited_at);
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    displayTitle: row.display_title.trim(),
    displayBody: publicWinCardDisplayBody({
      displayBody: row.display_body,
      sourceType,
      userEditedAt,
    }),
    supportingQuote: sanitizePublicWinSupportingQuote({
      supportingQuote: row.supporting_quote,
      sensitivityCaution: Boolean(row.sensitivity_caution),
      celebrationAppropriate: row.celebration_appropriate !== false,
    }),
    celebrationAppropriate: row.celebration_appropriate !== false,
    commitmentId: row.commitment_id,
    updatedAt: row.updated_at,
    sourceType,
    userEditedAt,
  };
}

function isWinRow(raw: unknown): raw is WinRow {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.occurred_at === "string" &&
    typeof r.display_title === "string" &&
    typeof r.display_body === "string" &&
    typeof r.updated_at === "string"
  );
}

export function encodePublicWinsCursor(cursor: PublicWinsCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodePublicWinsCursor(raw: string | null | undefined): PublicWinsCursor | null {
  if (raw == null || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const json = Buffer.from(trimmed, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const o = parsed as Record<string, unknown>;
    if (typeof o.occurredAt !== "string" || !o.occurredAt.trim()) return null;
    if (typeof o.id !== "string" || !o.id.trim()) return null;
    return { occurredAt: o.occurredAt.trim(), id: o.id.trim() };
  } catch {
    return null;
  }
}

/**
 * Embed a filter value in a PostgREST `.or()` / operator expression.
 * Values with reserved characters (`.`, `:`, `,`, `()`, `+`, spaces, etc.) must be
 * double-quoted; `\` and `"` inside the value are escaped per PostgREST grammar.
 * Does not strip or rewrite timestamp/UUID content.
 */
export function quotePostgrestFilterValue(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * PostgREST filter: rows strictly older than (occurredAt, id) under DESC ordering.
 * Tuple: occurred_at < cursor.occurredAt OR (occurred_at = cursor.occurredAt AND id < cursor.id)
 */
export function buildPublicWinsOlderThanOrFilter(cursor: PublicWinsCursor): string {
  const occurred = quotePostgrestFilterValue(cursor.occurredAt);
  const id = quotePostgrestFilterValue(cursor.id);
  return `occurred_at.lt.${occurred},and(occurred_at.eq.${occurred},id.lt.${id})`;
}

async function countActiveWinsForUser(clerkUserId: string): Promise<number> {
  const { count, error } = await supabaseServer
    .from("v2_win")
    .select("id", { count: "exact", head: true })
    .eq("clerk_user_id", clerkUserId)
    .eq("status", "active");

  if (error) {
    console.error("[v2-win-public-read] active count failed", {
      clerk_user_id: clerkUserId,
      message: error.message,
    });
    return 0;
  }
  return typeof count === "number" ? count : 0;
}

async function fetchActiveWinsPage(args: {
  clerkUserId: string;
  limit: number;
  cursor: PublicWinsCursor | null;
}): Promise<WinRow[]> {
  let query = supabaseServer
    .from("v2_win")
    .select(PUBLIC_WIN_SELECT_COLUMNS)
    .eq("clerk_user_id", args.clerkUserId)
    .eq("status", "active")
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(args.limit);

  if (args.cursor) {
    query = query.or(buildPublicWinsOlderThanOrFilter(args.cursor));
  }

  const { data, error } = await query;

  if (error) {
    console.error("[v2-win-public-read] active wins page failed", {
      clerk_user_id: args.clerkUserId,
      message: error.message,
    });
    return [];
  }

  return (data ?? []).filter(isWinRow);
}

export async function loadPublicVictoryWinsForUser(args: {
  clerkUserId: string;
  recentLimit?: number;
}): Promise<PublicVictoryWinsHomeResult> {
  const clerkUserId = requireClerkUserId(args.clerkUserId);
  const recentLimit = Math.max(
    1,
    Math.min(args.recentLimit ?? PUBLIC_WINS_RECENT_LIMIT, PUBLIC_WINS_RECENT_LIMIT)
  );

  const [totalActiveWins, rows] = await Promise.all([
    countActiveWinsForUser(clerkUserId),
    fetchActiveWinsPage({ clerkUserId, limit: recentLimit, cursor: null }),
  ]);

  const recentWins = await enrichPublicWinsWithMedia({
    clerkUserId,
    wins: rows.map(mapV2WinRowToPublicDto),
  });

  return {
    totalActiveWins,
    recentWins,
  };
}

export async function loadPublicAllWinsForUser(args: {
  clerkUserId: string;
  pageLimit?: number;
  /** Opaque cursor from prior `nextCursor` (searchParam). */
  cursorRaw?: string | null;
}): Promise<PublicAllWinsResult> {
  const clerkUserId = requireClerkUserId(args.clerkUserId);
  const pageLimit = Math.max(
    1,
    Math.min(args.pageLimit ?? PUBLIC_WINS_PAGE_LIMIT, PUBLIC_WINS_PAGE_LIMIT)
  );
  const cursor = decodePublicWinsCursor(args.cursorRaw ?? null);

  const rows = await fetchActiveWinsPage({
    clerkUserId,
    limit: pageLimit + 1,
    cursor,
  });

  const hasMore = rows.length > pageLimit;
  const pageRows = hasMore ? rows.slice(0, pageLimit) : rows;
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last
      ? encodePublicWinsCursor({ occurredAt: last.occurred_at, id: last.id })
      : null;

  const wins = await enrichPublicWinsWithMedia({
    clerkUserId,
    wins: pageRows.map(mapV2WinRowToPublicDto),
  });

  return {
    wins,
    hasMore,
    nextCursor,
    pageLimit,
  };
}

export type VictoryWinMonthMarkerResult = {
  counts: Record<string, number>;
};

type MonthMarkerRow = {
  id: string;
  occurred_at: string;
};

function isMonthMarkerRow(raw: unknown): raw is MonthMarkerRow {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.occurred_at === "string";
}

/**
 * Lightweight active-Win counts for one member-local month.
 * Bounded by clerk_user_id + status=active + local month UTC range.
 * No media. No application row cap (range is the bound).
 */
export async function loadVictoryWinMonthMarkersForUser(args: {
  clerkUserId: string;
  timeZone: string;
  monthKey: string;
}): Promise<VictoryWinMonthMarkerResult> {
  const clerkUserId = requireClerkUserId(args.clerkUserId);
  const range = localMonthUtcRange(args.monthKey, args.timeZone);
  if (!range) {
    return { counts: {} };
  }

  const { data, error } = await supabaseServer
    .from("v2_win")
    .select(PUBLIC_WIN_MONTH_MARKER_SELECT_COLUMNS)
    .eq("clerk_user_id", clerkUserId)
    .eq("status", "active")
    .gte("occurred_at", range.startUtcIso)
    .lt("occurred_at", range.endUtcIso);

  if (error) {
    console.error("[v2-win-public-read] month markers failed", {
      clerk_user_id: clerkUserId,
      message: error.message,
    });
    return { counts: {} };
  }

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    if (!isMonthMarkerRow(row)) continue;
    const occurred = new Date(row.occurred_at);
    if (Number.isNaN(occurred.getTime())) continue;
    const dayKey = getDateKeyInTimezone(occurred, args.timeZone);
    counts[dayKey] = (counts[dayKey] ?? 0) + 1;
  }

  return { counts };
}

/**
 * Full public DTOs for one member-local day, with existing media enrichment.
 * Fail closed to [] when the local-day range cannot be resolved.
 */
export async function loadPublicVictoryWinsForUserLocalDay(args: {
  clerkUserId: string;
  timeZone: string;
  dayKey: string;
}): Promise<PublicWinDto[]> {
  const clerkUserId = requireClerkUserId(args.clerkUserId);
  const range = localDayUtcRange(args.dayKey, args.timeZone);
  if (!range) {
    return [];
  }

  const { data, error } = await supabaseServer
    .from("v2_win")
    .select(PUBLIC_WIN_SELECT_COLUMNS)
    .eq("clerk_user_id", clerkUserId)
    .eq("status", "active")
    .gte("occurred_at", range.startUtcIso)
    .lt("occurred_at", range.endUtcIso)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PUBLIC_WINS_PAGE_LIMIT);

  if (error) {
    console.error("[v2-win-public-read] local-day wins failed", {
      clerk_user_id: clerkUserId,
      message: error.message,
    });
    return [];
  }

  const dtos = (data ?? []).filter(isWinRow).map(mapV2WinRowToPublicDto);
  return enrichPublicWinsWithMedia({
    clerkUserId,
    wins: dtos,
  });
}
