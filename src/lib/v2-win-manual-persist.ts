/**
 * Item #3 — manual user-authored Victory Room Wins.
 * Separate from SMS recognition / accountability merge. No OpenAI.
 */

import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import { evaluateTextSafetyTier } from "@/lib/onboarding-input-safety";
import { getDateKeyInTimezone, resolveUserTimezone } from "@/lib/timezone";
import { formatUserFacingGoal } from "@/lib/v2-user-facing-goal";
import { formatVictoryRoomDate } from "@/lib/v2-victory-room-view";
import {
  buildManualWinIdempotencyKey,
  isValidClientRequestId,
  isValidOccurredOnDateKey,
  mapManualWinUserText,
  MANUAL_WIN_DETAILS_MAX,
  MANUAL_WIN_TITLE_MAX,
  type ManualWinSeasonOption,
} from "@/lib/v2-win-manual-fields";

/** Matches live win_v1 schema_version without importing recognition/OpenAI modules. */
const MANUAL_WIN_SCHEMA_VERSION = "win_v1" as const;

export {
  buildManualWinIdempotencyKey,
  isValidClientRequestId,
  isValidOccurredOnDateKey,
  mapManualWinUserText,
  MANUAL_WIN_DETAILS_MAX,
  MANUAL_WIN_TITLE_MAX,
} from "@/lib/v2-win-manual-fields";

export type { ManualWinSeasonOption } from "@/lib/v2-win-manual-fields";

export type ManualWinPersistStatus = "inserted" | "existing" | "failed";

export type ManualWinPersistResult =
  | { ok: true; status: "inserted" | "existing"; id: string; idempotency_key: string }
  | { ok: false; error: string; code: ManualWinErrorCode };

export type ManualWinErrorCode =
  | "unauthorized"
  | "validation"
  | "unsafe_content"
  | "future_date"
  | "season_not_found"
  | "persist_failed";

/**
 * Convert YYYY-MM-DD in user timezone to a stable occurred_at (local noon → UTC).
 */
export function occurredAtIsoFromLocalDateKey(
  dateKey: string,
  timeZoneRaw: unknown
): string | null {
  if (!isValidOccurredOnDateKey(dateKey)) return null;
  const timeZone = resolveUserTimezone(timeZoneRaw);
  const [y, m, d] = dateKey.split("-").map(Number);

  // Probe a 48h UTC window for the instant that is local noon on dateKey.
  const probeStart = Date.UTC(y, m - 1, d, 0, 0, 0) - 14 * 3600_000;
  for (let ms = probeStart; ms < probeStart + 48 * 3600_000; ms += 3600_000) {
    const candidate = new Date(ms);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(candidate);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const localY = Number(get("year"));
    const localM = Number(get("month"));
    const localD = Number(get("day"));
    let localH = Number(get("hour"));
    if (localH === 24) localH = 0;
    if (localY === y && localM === m && localD === d && localH === 12) {
      return candidate.toISOString();
    }
  }

  // Fallback: UTC noon on that calendar day (still deterministic).
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).toISOString();
}

export function isFutureLocalDateKey(dateKey: string, timeZoneRaw: unknown): boolean {
  if (!isValidOccurredOnDateKey(dateKey)) return true;
  const tz = resolveUserTimezone(timeZoneRaw);
  const today = getDateKeyInTimezone(new Date(), tz);
  return dateKey > today;
}

export function validateManualWinInputs(args: {
  title: unknown;
  details?: unknown;
  occurredOn: unknown;
  clientRequestId: unknown;
  timeZone: unknown;
}):
  | { ok: true; title: string; details: string | null; occurredOn: string; clientRequestId: string }
  | { ok: false; error: string; code: ManualWinErrorCode } {
  if (!isValidClientRequestId(args.clientRequestId)) {
    return { ok: false, error: "Something went wrong. Please refresh and try again.", code: "validation" };
  }
  const clientRequestId = String(args.clientRequestId).trim();

  const titleRaw = typeof args.title === "string" ? args.title.replace(/\s+/g, " ").trim() : "";
  if (!titleRaw) {
    return { ok: false, error: "Say what happened.", code: "validation" };
  }
  if (titleRaw.length > MANUAL_WIN_TITLE_MAX) {
    return {
      ok: false,
      error: `Keep “What happened?” to ${MANUAL_WIN_TITLE_MAX} characters.`,
      code: "validation",
    };
  }

  let details: string | null = null;
  if (typeof args.details === "string") {
    const d = args.details.replace(/\s+/g, " ").trim();
    if (d) {
      if (d.length > MANUAL_WIN_DETAILS_MAX) {
        return {
          ok: false,
          error: `Keep details to ${MANUAL_WIN_DETAILS_MAX} characters.`,
          code: "validation",
        };
      }
      details = d;
    }
  }

  if (!isValidOccurredOnDateKey(args.occurredOn)) {
    return { ok: false, error: "Choose a valid date.", code: "validation" };
  }
  const occurredOn = String(args.occurredOn).trim();
  if (isFutureLocalDateKey(occurredOn, args.timeZone)) {
    return { ok: false, error: "Pick today or a past date.", code: "future_date" };
  }

  const titleSafety = evaluateTextSafetyTier(titleRaw);
  if (titleSafety.tier === "block") {
    return {
      ok: false,
      error: titleSafety.reason ?? "Please keep this focused on your real life.",
      code: "unsafe_content",
    };
  }
  if (details) {
    const detailsSafety = evaluateTextSafetyTier(details);
    if (detailsSafety.tier === "block") {
      return {
        ok: false,
        error: detailsSafety.reason ?? "Please keep this focused on your real life.",
        code: "unsafe_content",
      };
    }
  }

  return { ok: true, title: titleRaw, details, occurredOn, clientRequestId };
}

type OwnedSeasonRow = {
  id: string;
  clerk_user_id: string;
  commitment_id: string;
  season_name: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  goal_snapshot: unknown;
};

function goalLabelFromSnapshot(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const behavior = (raw as Record<string, unknown>).behavior_statement;
  if (typeof behavior !== "string" || !behavior.trim()) return null;
  return formatUserFacingGoal({ behaviorStatement: behavior.trim() });
}

function buildPickerLabel(args: {
  seasonName: string;
  goalLabel: string | null;
  startedAt: string;
  endedAt: string | null;
  isCurrent: boolean;
  timeZone: string;
}): string {
  const start = formatVictoryRoomDate(args.startedAt, args.timeZone);
  const range = args.isCurrent
    ? `${start} – Current`
    : args.endedAt
      ? `${start} – ${formatVictoryRoomDate(args.endedAt, args.timeZone)}`
      : `Started ${start}`;
  const lines = [args.seasonName];
  if (args.goalLabel) lines.push(args.goalLabel);
  lines.push(range);
  return lines.join("\n");
}

/**
 * Load one owned Season for attachment. Returns null if missing/foreign.
 */
export async function loadOwnedSeasonForManualWin(args: {
  clerkUserId: string;
  seasonId: string;
}): Promise<OwnedSeasonRow | null> {
  const clerk = args.clerkUserId.trim();
  const sid = args.seasonId.trim();
  if (!clerk || !sid) return null;

  const { data, error } = await supabaseServer
    .from("user_accountability_season")
    .select(
      "id, clerk_user_id, commitment_id, season_name, status, started_at, ended_at, goal_snapshot"
    )
    .eq("id", sid)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as OwnedSeasonRow;
  if (row.clerk_user_id !== clerk) return null;
  if (!row.commitment_id?.trim()) return null;
  if (!["active", "completed", "archived"].includes(row.status)) return null;
  return row;
}

/** Season picker options for Overall Add Win (current + past). */
export async function loadManualWinSeasonOptionsForUser(args: {
  clerkUserId: string;
  timeZone: string;
}): Promise<ManualWinSeasonOption[]> {
  const clerk = args.clerkUserId.trim();
  if (!clerk) return [];

  const { data: activeRow } = await supabaseServer
    .from("user_accountability_season")
    .select(
      "id, clerk_user_id, commitment_id, season_name, status, started_at, ended_at, goal_snapshot"
    )
    .eq("clerk_user_id", clerk)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: pastRows } = await supabaseServer
    .from("user_accountability_season")
    .select(
      "id, clerk_user_id, commitment_id, season_name, status, started_at, ended_at, goal_snapshot"
    )
    .eq("clerk_user_id", clerk)
    .in("status", ["completed", "archived"])
    .order("started_at", { ascending: false })
    .limit(12);

  const out: ManualWinSeasonOption[] = [];
  const push = (row: OwnedSeasonRow, isCurrent: boolean) => {
    if (row.clerk_user_id !== clerk) return;
    const goalLabel = goalLabelFromSnapshot(row.goal_snapshot);
    out.push({
      seasonId: row.id,
      seasonName: row.season_name,
      goalLabel,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      isCurrent,
      pickerLabel: buildPickerLabel({
        seasonName: row.season_name,
        goalLabel,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        isCurrent,
        timeZone: args.timeZone,
      }),
    });
  };

  if (activeRow) push(activeRow as OwnedSeasonRow, true);
  for (const row of pastRows ?? []) push(row as OwnedSeasonRow, false);
  return out;
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("duplicate key") || msg.includes("unique constraint");
}

/**
 * Persist a user-authored manual Win. Server owns provenance + season linkage.
 */
export async function persistManualV2Win(args: {
  clerkUserId: string;
  clientRequestId: string;
  title: string;
  details?: string | null;
  occurredOn: string;
  timeZone: unknown;
  /** When set, must already be ownership-verified. */
  season?: { seasonId: string; commitmentId: string } | null;
}): Promise<ManualWinPersistResult> {
  const clerk = args.clerkUserId.trim();
  if (!clerk) {
    return { ok: false, error: "Please sign in again.", code: "unauthorized" };
  }

  const validated = validateManualWinInputs({
    title: args.title,
    details: args.details,
    occurredOn: args.occurredOn,
    clientRequestId: args.clientRequestId,
    timeZone: args.timeZone,
  });
  if (!validated.ok) {
    return { ok: false, error: validated.error, code: validated.code };
  }

  const occurredAtIso = occurredAtIsoFromLocalDateKey(
    validated.occurredOn,
    args.timeZone
  );
  if (!occurredAtIso) {
    return { ok: false, error: "Choose a valid date.", code: "validation" };
  }

  const fields = mapManualWinUserText({
    title: validated.title,
    details: validated.details,
  });

  const season = args.season ?? null;
  const commitmentId = season?.commitmentId?.trim() || null;
  const relationshipType = commitmentId ? "goal" : "whole_life";

  const idempotencyKey = buildManualWinIdempotencyKey(clerk, validated.clientRequestId);

  const row = {
    clerk_user_id: clerk,
    source_type: "manual" as const,
    source_message_sid: null,
    source_message_id: null,
    source_event_id: null,
    commitment_id: commitmentId,
    occurred_at: occurredAtIso,
    action_fact: fields.action_fact,
    why_meaningful: null,
    display_title: fields.display_title,
    display_body: fields.display_body,
    supporting_quote: null,
    relationship_type: relationshipType,
    recognition_mode: "user_identified" as const,
    user_expressed_pride: false,
    identity_related: false,
    sensitivity_caution: false,
    celebration_appropriate: false,
    status: "active" as const,
    candidate_ordinal: 0 as const,
    idempotency_key: idempotencyKey,
    schema_version: MANUAL_WIN_SCHEMA_VERSION,
    model_confidence: null,
  };

  const { data, error } = await supabaseServer
    .from("v2_win")
    .insert(row)
    .select("id")
    .maybeSingle();

  if (!error && data?.id) {
    return {
      ok: true,
      status: "inserted",
      id: typeof data.id === "string" ? data.id : String(data.id),
      idempotency_key: idempotencyKey,
    };
  }

  if (isUniqueViolation(error)) {
    const { data: existing } = await supabaseServer
      .from("v2_win")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing?.id) {
      return {
        ok: true,
        status: "existing",
        id: typeof existing.id === "string" ? existing.id : String(existing.id),
        idempotency_key: idempotencyKey,
      };
    }
  }

  console.warn("[manual_win_persist_failed]", {
    error: error?.message?.slice(0, 120) ?? "unknown",
  });
  return {
    ok: false,
    error: "We couldn’t save this Win. Please try again.",
    code: "persist_failed",
  };
}
