/**
 * Victory Room (V1): read-only view model from existing tables only.
 *
 * Source of truth (do not let projection override spine):
 * - `user_profiles`: canonical identity (`preferred_name`, `identity_anchor_text`)
 * - `v2_commitment`: canonical active commitment + inputs to the effective ask
 * - `v2_commitment_event`: canonical proof moments (append-only spine)
 * - `v2_commitment_coaching_memory`: optional projection only (via loadV2CoachingMemoryForPrompt)
 *
 * Lifetime archive (`archiveMoments`): same spine-backed moment shapes, derived from up to
 * `ARCHIVE_EVENT_LIMIT` newest events for the active commitment, curated and capped (`VICTORY_ARCHIVE_MAX_ITEMS`);
 * excludes rows already shown in recent `moments`.
 *
 * Earlier seasons (`priorChapters`): read-only chapters from prior `v2_commitment` rows (canonical list)
 * + per-commitment `v2_commitment_event` proof (canonical). No cross-commitment stitching.
 *
 * Cornerstone moments (`cornerstoneMoments`): max 3 high-salience rows chosen by fixed rules from the union of
 * recent `moments`, `archiveMoments`, and prior chapter moments only — no raw events, no AI.
 */

import { supabaseServer } from "@/lib/supabase-server";
import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { loadV2CoachingMemoryForPrompt } from "@/lib/v2-coaching-memory";

const RECENT_EVENT_LIMIT = 120;

/**
 * Max spine rows read for Victory Room (newest first). If a commitment has more history than this,
 * older rows are omitted from both recent and archive derivation in V1.
 */
const ARCHIVE_EVENT_LIMIT = 2500;

/** Max items shown in the Lifetime proof section (curated, capped). */
export const VICTORY_ARCHIVE_MAX_ITEMS = 18;

/** Max standalone `user_yes` moments in the archive after time-spread sampling. */
const ARCHIVE_MAX_STANDALONE_YES = 6;

/** Max `user_yes` after reactivation entry sampled for archive comeback rows. */
const ARCHIVE_MAX_REACTIVATION_YES = 4;

/** Max prior commitments surfaced as chapters (excluding active). */
const PRIOR_CHAPTER_LIMIT = 3;

/** Max curated proof rows per prior chapter (smaller than lifetime archive on active). */
const CHAPTER_ARCHIVE_MAX_ITEMS = 6;
const CHAPTER_MAX_STANDALONE_YES = 3;
const CHAPTER_MAX_REACTIVATION_YES = 2;

/** Prior chapter statuses: calm, terminal-ish; excludes `paused` and `proposed` as ambiguous / not a season. */
const PRIOR_CHAPTER_STATUSES = ["completed", "abandoned", "superseded"] as const;

export type VictoryRoomProfileIdentity = {
  preferred_name: string | null;
  identity_anchor_text: string | null;
};

export type VictoryMoment = {
  id: string;
  occurredAt: string;
  headline: string;
  body: string;
  /** Spine event types this moment is explicitly grounded in. */
  groundedInEventTypes: string[];
};

export type VictoryRoomViewData = {
  hasActiveV2Commitment: boolean;
  profile: VictoryRoomProfileIdentity;
  commitment: { id: string; title: string } | null;
  effectiveCoachingAsk: string | null;
  moments: VictoryMoment[];
  comebackLines: string[];
  /**
   * Optional single line from coaching memory (user-authored blocker preview only).
   * Not primary proof; omitted if unavailable.
   */
  optionalMemoryProjectionLine: string | null;
  /**
   * Curated proof across the active commitment timeline (same spine rules as recent, wider window).
   * Excludes ids already shown in `moments` to reduce repetition.
   */
  archiveMoments: VictoryMoment[];
  /**
   * Prior commitment seasons (canonical `v2_commitment` rows + spine-backed moments per chapter).
   * Empty when user has no qualifying prior rows.
   */
  priorChapters: VictoryPriorChapterView[];
  /**
   * Up to 3 rule-ranked `VictoryMoment` rows from the union of recent, archive, and prior-chapter pools.
   * Empty when nothing qualifies.
   */
  cornerstoneMoments: VictoryMoment[];
};

export type VictoryPriorChapterView = {
  commitmentId: string;
  chapterTitle: string;
  rangeLabel: string;
  statusLabel: string;
  moments: VictoryMoment[];
};

type EventRow = {
  id: string;
  event_type: string;
  occurred_at: string;
  payload_json: Record<string, unknown>;
};

function truncateOneLine(s: string, max: number): string {
  const x = s.trim().replace(/\s+/g, " ");
  if (x.length <= max) return x;
  return `${x.slice(0, max - 1)}…`;
}

function parsePayload(row: EventRow): Record<string, unknown> {
  const p = row.payload_json;
  return p && typeof p === "object" && !Array.isArray(p) ? p : {};
}

function overlayActivatedCopy(contractKind: unknown): { headline: string; body: string } {
  if (contractKind === "shrink_ask") {
    return {
      headline: "Honest adjustment",
      body: "You tightened the bar with wisdom instead of disappearing.",
    };
  }
  if (contractKind === "recommit_same") {
    return {
      headline: "Clean recommitment",
      body: "You recommitted honestly — same bar, renewed choice.",
    };
  }
  return {
    headline: "Contract clarified",
    body: "You said yes to a clearer coaching agreement.",
  };
}

function buildSingleEventMoments(rows: EventRow[]): VictoryMoment[] {
  const out: VictoryMoment[] = [];
  for (const row of rows) {
    const payload = parsePayload(row);
    if (row.event_type === "user_yes") {
      out.push({
        id: row.id,
        occurredAt: row.occurred_at,
        headline: "Kept your word",
        body: "You kept your word here.",
        groundedInEventTypes: ["user_yes"],
      });
      continue;
    }
    if (row.event_type === "contract_overlay_activated") {
      const { headline, body } = overlayActivatedCopy(payload.contract_kind);
      out.push({
        id: row.id,
        occurredAt: row.occurred_at,
        headline,
        body,
        groundedInEventTypes: ["contract_overlay_activated"],
      });
      continue;
    }
    if (row.event_type === "coaching_refresh_resolved") {
      const resolution = typeof payload.resolution === "string" ? payload.resolution : "";
      if (resolution === "still" || resolution === "keep") {
        out.push({
          id: row.id,
          occurredAt: row.occurred_at,
          headline: "Alignment",
          body: "You clarified what still fits.",
          groundedInEventTypes: ["coaching_refresh_resolved"],
        });
      }
    }
  }
  return out;
}

/** Newest first */
function sortDesc(a: EventRow, b: EventRow): number {
  return new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime();
}

/** Oldest first */
function sortAsc(a: EventRow, b: EventRow): number {
  return new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime();
}

function findHonestyComebackMoment(rowsAsc: EventRow[]): VictoryMoment | null {
  let lastPair: { yes: EventRow; prior: EventRow } | null = null;
  for (let i = 0; i < rowsAsc.length; i++) {
    const ev = rowsAsc[i];
    if (ev.event_type !== "user_yes") continue;
    for (let j = i - 1; j >= 0; j--) {
      const prev = rowsAsc[j];
      if (prev.event_type === "user_no" || prev.event_type === "user_partial") {
        lastPair = { yes: ev, prior: prev };
        break;
      }
      if (prev.event_type === "user_yes") break;
    }
  }
  if (!lastPair) return null;
  return {
    id: `composite:honesty:${lastPair.yes.id}`,
    occurredAt: lastPair.yes.occurred_at,
    headline: "Honesty",
    body: "You got honest and stayed in it.",
    groundedInEventTypes: [lastPair.prior.event_type, "user_yes"],
  };
}

function findDeclineThenActivateMoment(rowsAsc: EventRow[]): VictoryMoment | null {
  let last: VictoryMoment | null = null;
  for (let i = 0; i < rowsAsc.length; i++) {
    if (rowsAsc[i].event_type !== "contract_overlay_declined") continue;
    for (let j = i + 1; j < rowsAsc.length; j++) {
      if (rowsAsc[j].event_type === "contract_overlay_activated") {
        last = {
          id: `composite:decline_activate:${rowsAsc[j].id}`,
          occurredAt: rowsAsc[j].occurred_at,
          headline: "Stayed in it",
          body: "You pushed back on one option, then said yes to a cleaner next step instead of quitting.",
          groundedInEventTypes: ["contract_overlay_declined", "contract_overlay_activated"],
        };
        break;
      }
    }
  }
  return last;
}

function findReactivationYesMoment(
  rowsAsc: EventRow[],
  reactivationEnteredAt: string | null
): VictoryMoment | null {
  if (!reactivationEnteredAt?.trim()) return null;
  const t0 = new Date(reactivationEnteredAt).getTime();
  if (!Number.isFinite(t0)) return null;
  for (const ev of rowsAsc) {
    if (ev.event_type !== "user_yes") continue;
    const t = new Date(ev.occurred_at).getTime();
    if (Number.isFinite(t) && t > t0) {
      return {
        id: `composite:reactivation_yes:${ev.id}`,
        occurredAt: ev.occurred_at,
        headline: "Comeback",
        body: "You came back here.",
        groundedInEventTypes: ["user_yes"],
      };
    }
  }
  return null;
}

/** All honesty episodes (each `user_yes` that follows a prior `user_no` / `user_partial` without crossing another yes). */
function findAllHonestyMoments(rowsAsc: EventRow[]): VictoryMoment[] {
  const out: VictoryMoment[] = [];
  for (let i = 0; i < rowsAsc.length; i++) {
    const ev = rowsAsc[i];
    if (ev.event_type !== "user_yes") continue;
    for (let j = i - 1; j >= 0; j--) {
      const prev = rowsAsc[j];
      if (prev.event_type === "user_no" || prev.event_type === "user_partial") {
        out.push({
          id: `composite:honesty:${ev.id}`,
          occurredAt: ev.occurred_at,
          headline: "Honesty",
          body: "You got honest and stayed in it.",
          groundedInEventTypes: [prev.event_type, "user_yes"],
        });
        break;
      }
      if (prev.event_type === "user_yes") break;
    }
  }
  return out;
}

/** Each decline followed by a later activate (episode per activated event id). */
function findAllDeclineActivateMoments(rowsAsc: EventRow[]): VictoryMoment[] {
  const usedActivated = new Set<string>();
  const out: VictoryMoment[] = [];
  for (let i = 0; i < rowsAsc.length; i++) {
    if (rowsAsc[i].event_type !== "contract_overlay_declined") continue;
    for (let j = i + 1; j < rowsAsc.length; j++) {
      if (rowsAsc[j].event_type !== "contract_overlay_activated") continue;
      const act = rowsAsc[j];
      if (usedActivated.has(act.id)) break;
      usedActivated.add(act.id);
      out.push({
        id: `composite:decline_activate:${act.id}`,
        occurredAt: act.occurred_at,
        headline: "Stayed in it",
        body: "You pushed back on one option, then said yes to a cleaner next step instead of quitting.",
        groundedInEventTypes: ["contract_overlay_declined", "contract_overlay_activated"],
      });
      break;
    }
  }
  return out;
}

/** Evenly sample rows across their timeline (oldest → newest order in `rows`). */
function sampleEventRowsEvenly(rows: EventRow[], max: number): EventRow[] {
  if (rows.length === 0 || max <= 0) return [];
  const sorted = [...rows].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  );
  if (sorted.length <= max) return sorted;
  const out: EventRow[] = [];
  for (let k = 0; k < max; k++) {
    const idx = Math.round((k * (sorted.length - 1)) / Math.max(max - 1, 1));
    out.push(sorted[idx]);
  }
  const seen = new Set<string>();
  return out.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

function findReactivationYesMomentsArchived(
  rowsAsc: EventRow[],
  reactivationEnteredAt: string | null,
  max: number
): VictoryMoment[] {
  if (!reactivationEnteredAt?.trim()) return [];
  const t0 = new Date(reactivationEnteredAt).getTime();
  if (!Number.isFinite(t0)) return [];
  const yeses = rowsAsc.filter((ev) => {
    if (ev.event_type !== "user_yes") return false;
    const t = new Date(ev.occurred_at).getTime();
    return Number.isFinite(t) && t > t0;
  });
  const sampled = sampleEventRowsEvenly(yeses, max);
  return sampled.map((ev) => ({
    id: `composite:reactivation_yes:${ev.id}`,
    occurredAt: ev.occurred_at,
    headline: "Comeback",
    body: "You came back here.",
    groundedInEventTypes: ["user_yes"],
  }));
}

/**
 * Lifetime archive: same grounded types as recent proof, wider event window, time-sampled yes rows,
 * excludes operational noise (`check_sent`, etc. — never passed through moment builders).
 */
type ArchiveCuratorOptions = {
  maxResults?: number;
  maxStandaloneYes?: number;
  maxReactivationYes?: number;
};

/**
 * Curated archive moments for one commitment's event window.
 * `recentMomentIds`: exclude these ids (e.g. recent proof on active commitment); use empty set for prior chapters.
 */
function buildArchiveMomentsFromEvents(
  eventRowsFull: EventRow[],
  reactivationEnteredAt: string | null,
  recentMomentIds: Set<string>,
  opts?: ArchiveCuratorOptions
): VictoryMoment[] {
  if (eventRowsFull.length === 0) return [];

  const maxResults = opts?.maxResults ?? VICTORY_ARCHIVE_MAX_ITEMS;
  const maxStandaloneYes = opts?.maxStandaloneYes ?? ARCHIVE_MAX_STANDALONE_YES;
  const maxReactivationYes = opts?.maxReactivationYes ?? ARCHIVE_MAX_REACTIVATION_YES;

  const rowsAsc = [...eventRowsFull].sort(sortAsc);
  const rowsDesc = [...eventRowsFull].sort(sortDesc);

  const honestyAll = findAllHonestyMoments(rowsAsc);
  const declineAll = findAllDeclineActivateMoments(rowsAsc);
  const declineActivatedIds = new Set(
    declineAll.map((m) => m.id.replace("composite:decline_activate:", ""))
  );

  const reactArchived = findReactivationYesMomentsArchived(
    rowsAsc,
    reactivationEnteredAt,
    maxReactivationYes
  );

  const excludeYesIds = new Set<string>();
  for (const h of honestyAll) {
    if (h.id.startsWith("composite:honesty:")) {
      excludeYesIds.add(h.id.slice("composite:honesty:".length));
    }
  }
  for (const r of reactArchived) {
    if (r.id.startsWith("composite:reactivation_yes:")) {
      excludeYesIds.add(r.id.slice("composite:reactivation_yes:".length));
    }
  }

  const overlayRefresh = buildSingleEventMoments(rowsDesc).filter((m) => {
    const t0 = m.groundedInEventTypes[0];
    if (t0 === "user_yes") return false;
    if (t0 === "contract_overlay_activated" && declineActivatedIds.has(m.id)) return false;
    return true;
  });

  const yesCandidates = rowsAsc.filter((r) => r.event_type === "user_yes" && !excludeYesIds.has(r.id));
  const yesSampled = sampleEventRowsEvenly(yesCandidates, maxStandaloneYes);
  const yesMoments: VictoryMoment[] = yesSampled.map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    headline: "Kept your word",
    body: "You kept your word here.",
    groundedInEventTypes: ["user_yes"],
  }));

  const merged = dedupeMomentsById([
    ...honestyAll,
    ...declineAll,
    ...reactArchived,
    ...overlayRefresh,
    ...yesMoments,
  ]);

  const notRecent = merged.filter((m) => !recentMomentIds.has(m.id));
  const sorted = [...notRecent].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );
  return sorted.slice(0, maxResults);
}

function mapRowsToEventRows(rows: unknown): EventRow[] {
  return (rows as Record<string, unknown>[])
    .filter(
      (r) =>
        typeof r.id === "string" && typeof r.event_type === "string" && typeof r.occurred_at === "string"
    )
    .map((r) => ({
      id: String(r.id),
      event_type: String(r.event_type),
      occurred_at: String(r.occurred_at),
      payload_json:
        r.payload_json != null && typeof r.payload_json === "object" && !Array.isArray(r.payload_json)
          ? (r.payload_json as Record<string, unknown>)
          : {},
    }));
}

function statusToChapterLabel(status: string): string {
  if (status === "completed") return "Completed";
  if (status === "abandoned") return "Ended";
  if (status === "superseded") return "Superseded";
  return status;
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

function chapterTitleFromRow(row: Record<string, unknown>): string {
  const t = typeof row.title === "string" ? row.title.trim() : "";
  if (t) return truncateOneLine(t, 120);
  const b = typeof row.behavior_statement === "string" ? row.behavior_statement.trim() : "";
  if (b) return truncateOneLine(b, 100);
  return "Earlier commitment";
}

function parseReactivationFromPriorRow(row: Record<string, unknown>): string | null {
  const v = row.reactivation_entered_at;
  return v != null && typeof v === "string" && v.trim() ? v : null;
}

async function fetchEventRowsForCommitment(commitmentId: string): Promise<EventRow[]> {
  const { data, error } = await supabaseServer
    .from("v2_commitment_event")
    .select("id, event_type, occurred_at, payload_json")
    .eq("commitment_id", commitmentId)
    .order("occurred_at", { ascending: false })
    .limit(ARCHIVE_EVENT_LIMIT);

  if (error) {
    console.error("[v2-victory-room] prior chapter events load failed", {
      commitment_id: commitmentId,
      message: error.message,
    });
    return [];
  }
  return mapRowsToEventRows(data ?? []);
}

/**
 * Prior `v2_commitment` chapters only (status in `PRIOR_CHAPTER_STATUSES`), newest first, capped.
 */
async function loadPriorChaptersView(
  clerkUserId: string,
  activeCommitmentId: string
): Promise<VictoryPriorChapterView[]> {
  const { data, error } = await supabaseServer
    .from("v2_commitment")
    .select("id, title, behavior_statement, status, started_at, ended_at, updated_at, reactivation_entered_at")
    .eq("clerk_user_id", clerkUserId)
    .neq("id", activeCommitmentId)
    .in("status", [...PRIOR_CHAPTER_STATUSES])
    .order("started_at", { ascending: false })
    .limit(PRIOR_CHAPTER_LIMIT);

  if (error) {
    console.error("[v2-victory-room] prior commitments load failed", {
      clerk_user_id: clerkUserId,
      message: error.message,
    });
    return [];
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  const chapters: VictoryPriorChapterView[] = [];

  for (const row of rows) {
    if (typeof row.id !== "string") continue;
    const commitmentId = row.id;
    const eventRows = await fetchEventRowsForCommitment(commitmentId);
    const reAt = parseReactivationFromPriorRow(row);
    const moments = buildArchiveMomentsFromEvents(eventRows, reAt, new Set(), {
      maxResults: CHAPTER_ARCHIVE_MAX_ITEMS,
      maxStandaloneYes: CHAPTER_MAX_STANDALONE_YES,
      maxReactivationYes: CHAPTER_MAX_REACTIVATION_YES,
    });
    const startedAt = typeof row.started_at === "string" ? row.started_at : null;
    const endedAt = typeof row.ended_at === "string" ? row.ended_at : null;
    const updatedAt = typeof row.updated_at === "string" ? row.updated_at : null;
    chapters.push({
      commitmentId,
      chapterTitle: chapterTitleFromRow(row),
      rangeLabel: formatChapterRangeLabel(startedAt, endedAt, updatedAt),
      statusLabel: statusToChapterLabel(typeof row.status === "string" ? row.status : ""),
      moments,
    });
  }

  return chapters;
}

function dedupeMomentsById(moments: VictoryMoment[]): VictoryMoment[] {
  const seen = new Set<string>();
  const out: VictoryMoment[] = [];
  for (const m of moments) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

/**
 * Prefer variety: cap standalone `user_yes` spine rows (not composites) at 2 (most recent).
 * Overall cap 5 moments.
 */
function capMoments(moments: VictoryMoment[]): VictoryMoment[] {
  const sorted = [...moments].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );
  const out: VictoryMoment[] = [];
  let yesSpineCount = 0;
  for (const m of sorted) {
    if (out.length >= 5) break;
    const isStandaloneYes =
      m.groundedInEventTypes.length === 1 && m.groundedInEventTypes[0] === "user_yes" && !m.id.startsWith("composite:");
    if (isStandaloneYes) {
      yesSpineCount += 1;
      if (yesSpineCount > 2) continue;
    }
    out.push(m);
  }
  return out.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}

function buildComebackLines(args: {
  rowsAsc: EventRow[];
  reactivationEnteredAt: string | null;
  honesty: VictoryMoment | null;
  declineActivate: VictoryMoment | null;
  reactivationYes: VictoryMoment | null;
}): string[] {
  const lines: string[] = [];
  if (args.reactivationYes) {
    lines.push("You came back after a quieter stretch and stayed in the conversation.");
  }
  if (args.honesty) {
    lines.push("You told the truth on a hard day and kept answering.");
  }
  if (args.declineActivate) {
    lines.push("You pushed back once, then chose a cleaner yes instead of quitting.");
  }
  return lines;
}

/** Max cornerstone rows (hard cap). */
const CORNERSTONE_MAX = 3;

/** Prefer picks at least this far apart in time when the pool allows (ms). */
const CORNERSTONE_MIN_GAP_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Deterministic salience score for cornerstone ranking. Only types we already surface as `VictoryMoment`.
 * Higher = more cornerstone-worthy.
 */
function cornerstoneScore(m: VictoryMoment): number {
  if (m.id.startsWith("composite:decline_activate:")) return 100;
  if (m.headline === "Honest adjustment") return 95;
  if (m.headline === "Clean recommitment") return 90;
  if (m.groundedInEventTypes.includes("contract_overlay_activated")) return 88;
  if (m.id.startsWith("composite:reactivation_yes:")) return 85;
  if (m.groundedInEventTypes.includes("coaching_refresh_resolved")) return 80;
  if (m.headline === "Honesty" || m.id.startsWith("composite:honesty:")) return 75;
  if (
    m.groundedInEventTypes.length === 1 &&
    m.groundedInEventTypes[0] === "user_yes" &&
    !m.id.startsWith("composite:")
  ) {
    return 30;
  }
  return 0;
}

function isStandaloneYesMoment(m: VictoryMoment): boolean {
  return (
    m.groundedInEventTypes.length === 1 &&
    m.groundedInEventTypes[0] === "user_yes" &&
    !m.id.startsWith("composite:")
  );
}

function isHonestyCornerstone(m: VictoryMoment): boolean {
  return m.headline === "Honesty" || m.id.startsWith("composite:honesty:");
}

function occurredMs(m: VictoryMoment): number {
  const t = new Date(m.occurredAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Union of recent, archive, and prior-chapter moments; deduped; max 3 picks; rule-ranked; time-spread when possible.
 * Exported for tests — same logic powers `cornerstoneMoments` on the view.
 */
export function selectCornerstoneMoments(args: {
  moments: VictoryMoment[];
  archiveMoments: VictoryMoment[];
  priorChapters: VictoryPriorChapterView[];
}): VictoryMoment[] {
  const pool = dedupeMomentsById([
    ...args.moments,
    ...args.archiveMoments,
    ...args.priorChapters.flatMap((ch) => ch.moments),
  ]);

  const candidates = pool.filter((m) => cornerstoneScore(m) > 0);
  if (candidates.length === 0) return [];

  const sorted = [...candidates].sort((a, b) => {
    const ds = cornerstoneScore(b) - cornerstoneScore(a);
    if (ds !== 0) return ds;
    return occurredMs(b) - occurredMs(a);
  });

  const picked: VictoryMoment[] = [];
  const used = new Set<string>();

  const canAdd = (c: VictoryMoment, requireGap: boolean, allowSecondHonesty: boolean): boolean => {
    if (used.has(c.id)) return false;
    if (isStandaloneYesMoment(c) && picked.filter(isStandaloneYesMoment).length >= 1) return false;
    if (isHonestyCornerstone(c)) {
      const h = picked.filter(isHonestyCornerstone).length;
      if (h >= 1 && !allowSecondHonesty) return false;
      if (h >= 2) return false;
    }
    if (requireGap && picked.some((p) => Math.abs(occurredMs(c) - occurredMs(p)) < CORNERSTONE_MIN_GAP_MS)) {
      return false;
    }
    return true;
  };

  for (const c of sorted) {
    if (picked.length >= CORNERSTONE_MAX) break;
    if (canAdd(c, true, false)) {
      picked.push(c);
      used.add(c.id);
    }
  }
  for (const c of sorted) {
    if (picked.length >= CORNERSTONE_MAX) break;
    if (canAdd(c, false, false)) {
      picked.push(c);
      used.add(c.id);
    }
  }
  for (const c of sorted) {
    if (picked.length >= CORNERSTONE_MAX) break;
    if (canAdd(c, false, true)) {
      picked.push(c);
      used.add(c.id);
    }
  }

  return [...picked].sort((a, b) => {
    const ds = cornerstoneScore(b) - cornerstoneScore(a);
    if (ds !== 0) return ds;
    return occurredMs(b) - occurredMs(a);
  });
}

export async function loadVictoryRoomView(
  clerkUserId: string
): Promise<VictoryRoomViewData> {
  const { data: prof, error: profErr } = await supabaseServer
    .from("user_profiles")
    .select("preferred_name, identity_anchor_text")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (profErr) {
    console.error("[v2-victory-room] profile load failed", { clerk_user_id: clerkUserId, message: profErr.message });
  }

  const profile: VictoryRoomProfileIdentity = {
    preferred_name: typeof prof?.preferred_name === "string" ? prof.preferred_name : null,
    identity_anchor_text:
      typeof prof?.identity_anchor_text === "string" ? prof.identity_anchor_text : null,
  };

  const commitment = await getActiveCommitment(clerkUserId);
  if (!commitment) {
    return {
      hasActiveV2Commitment: false,
      profile,
      commitment: null,
      effectiveCoachingAsk: null,
      moments: [],
      comebackLines: [],
      optionalMemoryProjectionLine: null,
      archiveMoments: [],
      priorChapters: [],
      cornerstoneMoments: [],
    };
  }

  const { data: events, error: evErr } = await supabaseServer
    .from("v2_commitment_event")
    .select("id, event_type, occurred_at, payload_json")
    .eq("commitment_id", commitment.id)
    .order("occurred_at", { ascending: false })
    .limit(ARCHIVE_EVENT_LIMIT);

  if (evErr) {
    console.error("[v2-victory-room] events load failed", {
      commitment_id: commitment.id,
      message: evErr.message,
    });
  }

  const eventRowsFull: EventRow[] = mapRowsToEventRows(events ?? []);

  const eventRowsRecent = eventRowsFull.slice(0, RECENT_EVENT_LIMIT);

  const rowsAsc = [...eventRowsRecent].sort(sortAsc);
  const rowsDesc = [...eventRowsRecent].sort(sortDesc);

  const honestyMoment = findHonestyComebackMoment(rowsAsc);
  const declineActivateMoment = findDeclineThenActivateMoment(rowsAsc);
  const reactivationYesMoment = findReactivationYesMoment(rowsAsc, commitment.reactivation_entered_at);

  const singlesRaw = buildSingleEventMoments(rowsDesc);
  const excludeEventIds = new Set<string>();
  if (honestyMoment?.id.startsWith("composite:honesty:")) {
    excludeEventIds.add(honestyMoment.id.slice("composite:honesty:".length));
  }
  if (reactivationYesMoment?.id.startsWith("composite:reactivation_yes:")) {
    excludeEventIds.add(reactivationYesMoment.id.slice("composite:reactivation_yes:".length));
  }
  if (declineActivateMoment?.id.startsWith("composite:decline_activate:")) {
    excludeEventIds.add(declineActivateMoment.id.slice("composite:decline_activate:".length));
  }
  const singles = singlesRaw.filter((m) => !excludeEventIds.has(m.id));

  const merged = dedupeMomentsById([
    ...singles,
    ...(honestyMoment ? [honestyMoment] : []),
    ...(declineActivateMoment ? [declineActivateMoment] : []),
    ...(reactivationYesMoment ? [reactivationYesMoment] : []),
  ]);

  const moments = capMoments(merged);

  const comebackLines = buildComebackLines({
    rowsAsc,
    reactivationEnteredAt: commitment.reactivation_entered_at,
    honesty: honestyMoment,
    declineActivate: declineActivateMoment,
    reactivationYes: reactivationYesMoment,
  }).filter((line, i, arr) => arr.indexOf(line) === i);

  const memory = await loadV2CoachingMemoryForPrompt(commitment.id);
  const blockerPreview =
    memory?.latest_blocker_preview && memory.latest_blocker_preview.trim()
      ? truncateOneLine(memory.latest_blocker_preview, 160)
      : null;
  const optionalMemoryProjectionLine = blockerPreview
    ? `Latest blocker you named (coach memory projection, not primary proof): ${blockerPreview}`
    : null;

  const recentMomentIds = new Set(moments.map((m) => m.id));
  const archiveMoments = buildArchiveMomentsFromEvents(
    eventRowsFull,
    commitment.reactivation_entered_at,
    recentMomentIds
  );

  const priorChapters = await loadPriorChaptersView(clerkUserId, commitment.id);

  const cornerstoneMoments = selectCornerstoneMoments({
    moments,
    archiveMoments,
    priorChapters,
  });

  return {
    hasActiveV2Commitment: true,
    profile,
    commitment: { id: commitment.id, title: commitment.title },
    effectiveCoachingAsk: getEffectiveCoachingAsk(commitment, Date.now()),
    moments,
    comebackLines,
    optionalMemoryProjectionLine,
    archiveMoments,
    priorChapters,
    cornerstoneMoments,
  };
}

export function formatVictoryRoomDate(iso: string, timeZone: string | undefined): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: timeZone && timeZone.trim() ? timeZone : "UTC",
    }).format(t);
  } catch {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
      t
    );
  }
}
