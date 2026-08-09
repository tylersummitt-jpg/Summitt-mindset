/**
 * Item #4 — user Edit Win.
 * Narrow presentation/membership update. No OpenAI / recognition / user_yes / manual create.
 */

import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import { evaluateTextSafetyTier } from "@/lib/onboarding-input-safety";
import { getDateKeyInTimezone, resolveUserTimezone } from "@/lib/timezone";
import {
  isValidOccurredOnDateKey,
  MANUAL_WIN_DETAILS_MAX,
  MANUAL_WIN_TITLE_MAX,
  mapManualWinUserText,
  type ManualWinSeasonOption,
} from "@/lib/v2-win-manual-fields";
import {
  isFutureLocalDateKey,
  loadManualWinSeasonOptionsForUser,
  loadOwnedSeasonForManualWin,
  occurredAtIsoFromLocalDateKey,
} from "@/lib/v2-win-manual-persist";

export type UserWinEditErrorCode =
  | "unauthorized"
  | "not_found"
  | "validation"
  | "unsafe_content"
  | "future_date"
  | "season_not_found"
  | "conflict"
  | "persist_failed";

export type OwnedWinForEdit = {
  id: string;
  clerkUserId: string;
  sourceType: string;
  displayTitle: string;
  displayBody: string;
  occurredAt: string;
  commitmentId: string | null;
  supportingQuote: string | null;
  actionFact: string;
  whyMeaningful: string | null;
  relationshipType: string;
  status: string;
  updatedAt: string;
  userEditedAt: string | null;
  /** Season id when commitment maps to an owned Season; null for Overall or orphan commitment. */
  matchedSeasonId: string | null;
  /** True when commitment_id is set but no owned Season matches (preserve until user picks). */
  orphanCommitment: boolean;
};

type WinEditRow = {
  id: string;
  clerk_user_id: string;
  source_type: string;
  display_title: string;
  display_body: string;
  occurred_at: string;
  commitment_id: string | null;
  supporting_quote: string | null;
  action_fact: string;
  why_meaningful: string | null;
  relationship_type: string;
  status: string;
  updated_at: string;
  user_edited_at: string | null;
  source_message_sid: string | null;
  source_message_id: string | null;
  source_event_id: string | null;
  candidate_ordinal: number;
  idempotency_key: string;
  recognition_mode: string;
  schema_version: string;
  model_confidence: number | null;
};

const WIN_EDIT_SELECT =
  "id, clerk_user_id, source_type, display_title, display_body, occurred_at, commitment_id, supporting_quote, action_fact, why_meaningful, relationship_type, status, updated_at, user_edited_at, source_message_sid, source_message_id, source_event_id, candidate_ordinal, idempotency_key, recognition_mode, schema_version, model_confidence" as const;

function isWinEditRow(raw: unknown): raw is WinEditRow {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.clerk_user_id === "string" &&
    typeof r.display_title === "string" &&
    typeof r.display_body === "string" &&
    typeof r.occurred_at === "string" &&
    typeof r.updated_at === "string" &&
    typeof r.status === "string" &&
    typeof r.source_type === "string" &&
    typeof r.action_fact === "string"
  );
}

async function findOwnedSeasonIdByCommitment(args: {
  clerkUserId: string;
  commitmentId: string;
}): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from("user_accountability_season")
    .select("id")
    .eq("clerk_user_id", args.clerkUserId)
    .eq("commitment_id", args.commitmentId)
    .in("status", ["active", "completed", "archived"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.id) return null;
  return typeof data.id === "string" ? data.id : String(data.id);
}

/**
 * Load one owned active Win for the Edit form. Foreign/hidden → null.
 */
export async function loadOwnedActiveWinForEdit(args: {
  clerkUserId: string;
  winId: string;
}): Promise<OwnedWinForEdit | null> {
  const clerk = args.clerkUserId.trim();
  const winId = args.winId.trim();
  if (!clerk || !winId) return null;

  const { data, error } = await supabaseServer
    .from("v2_win")
    .select(WIN_EDIT_SELECT)
    .eq("id", winId)
    .maybeSingle();

  if (error || !isWinEditRow(data)) return null;
  if (data.clerk_user_id !== clerk) return null;
  if (data.status !== "active") return null;

  const commitmentId =
    typeof data.commitment_id === "string" && data.commitment_id.trim()
      ? data.commitment_id.trim()
      : null;

  let matchedSeasonId: string | null = null;
  let orphanCommitment = false;
  if (commitmentId) {
    matchedSeasonId = await findOwnedSeasonIdByCommitment({
      clerkUserId: clerk,
      commitmentId,
    });
    orphanCommitment = matchedSeasonId == null;
  }

  return {
    id: data.id,
    clerkUserId: data.clerk_user_id,
    sourceType: data.source_type,
    displayTitle: data.display_title,
    displayBody: data.display_body,
    occurredAt: data.occurred_at,
    commitmentId,
    supportingQuote:
      typeof data.supporting_quote === "string" ? data.supporting_quote : null,
    actionFact: data.action_fact,
    whyMeaningful:
      typeof data.why_meaningful === "string" ? data.why_meaningful : null,
    relationshipType: data.relationship_type,
    status: data.status,
    updatedAt: data.updated_at,
    userEditedAt:
      typeof data.user_edited_at === "string" ? data.user_edited_at : null,
    matchedSeasonId,
    orphanCommitment,
  };
}

export function occurredOnFromWinOccurredAt(
  occurredAtIso: string,
  timeZoneRaw: unknown
): string {
  const tz = resolveUserTimezone(timeZoneRaw);
  const d = new Date(occurredAtIso);
  if (Number.isNaN(d.getTime())) {
    return getDateKeyInTimezone(new Date(), tz);
  }
  return getDateKeyInTimezone(d, tz);
}

/** Details field for form: blank when body equals title (manual short-Win pattern). */
export function detailsFieldFromWin(win: Pick<OwnedWinForEdit, "displayTitle" | "displayBody">): string {
  const title = win.displayTitle.trim();
  const body = win.displayBody.trim();
  if (!body || body === title) return "";
  return body;
}

export type ApplyUserWinEditResult =
  | {
      ok: true;
      status: "updated" | "noop";
      win_id: string;
      updated_at: string;
      revision_id: string | null;
      user_edited_at: string | null;
    }
  | { ok: false; error: string; code: UserWinEditErrorCode };

function valuesEqualTrimmed(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim() === (b ?? "").trim();
}

/**
 * Apply a user Edit Win. No-op when presentation/membership unchanged.
 */
export async function applyUserVictoryWinEdit(args: {
  clerkUserId: string;
  winId: string;
  title: unknown;
  details?: unknown;
  occurredOn: unknown;
  seasonId: unknown;
  expectedUpdatedAt: unknown;
  timeZone: unknown;
}): Promise<ApplyUserWinEditResult> {
  const clerk = args.clerkUserId.trim();
  if (!clerk) {
    return { ok: false, error: "Please sign in again.", code: "unauthorized" };
  }

  const winId = typeof args.winId === "string" ? args.winId.trim() : "";
  if (!winId) {
    return { ok: false, error: "Win not found.", code: "not_found" };
  }

  const expectedUpdatedAt =
    typeof args.expectedUpdatedAt === "string" ? args.expectedUpdatedAt.trim() : "";
  if (!expectedUpdatedAt) {
    return {
      ok: false,
      error: "This Win changed since you opened it. Refresh and try again.",
      code: "conflict",
    };
  }

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

  let seasonIdRaw = "";
  if (typeof args.seasonId === "string") {
    seasonIdRaw = args.seasonId.trim();
  } else if (args.seasonId == null) {
    seasonIdRaw = "";
  } else {
    return { ok: false, error: "That Season isn’t available.", code: "season_not_found" };
  }

  let nextCommitmentId: string | null = null;
  if (seasonIdRaw) {
    const owned = await loadOwnedSeasonForManualWin({
      clerkUserId: clerk,
      seasonId: seasonIdRaw,
    });
    if (!owned) {
      return { ok: false, error: "That Season isn’t available.", code: "season_not_found" };
    }
    nextCommitmentId = owned.commitment_id.trim();
  }

  const occurredAtIso = occurredAtIsoFromLocalDateKey(occurredOn, args.timeZone);
  if (!occurredAtIso) {
    return { ok: false, error: "Choose a valid date.", code: "validation" };
  }

  const mapped = mapManualWinUserText({ title: titleRaw, details });

  const current = await loadOwnedActiveWinForEdit({ clerkUserId: clerk, winId });
  if (!current) {
    return { ok: false, error: "Win not found.", code: "not_found" };
  }
  if (current.updatedAt !== expectedUpdatedAt) {
    return {
      ok: false,
      error: "This Win changed since you opened it. Refresh and try again.",
      code: "conflict",
    };
  }

  // Orphan commitment + Overall selection: preserve until user picks a real Season
  // (Overall in UI for orphan does not silently clear on no-op path; on save with null
  // season we only clear when not orphan OR when user explicitly chose Overall after load).
  // Locked product: picker Overall means Overall. Orphan shown as Overall → save clears.
  // Reported in audit: intentional.

  const nextTitle = mapped.display_title;
  const nextBody = mapped.display_body;
  const presentationChanged =
    !valuesEqualTrimmed(nextTitle, current.displayTitle) ||
    !valuesEqualTrimmed(nextBody, current.displayBody);

  const currentOccurredOn = occurredOnFromWinOccurredAt(current.occurredAt, args.timeZone);
  const dateChanged = occurredOn !== currentOccurredOn;
  // Compare commitment membership by resolved next vs current
  const seasonChanged = (nextCommitmentId ?? null) !== (current.commitmentId ?? null);

  if (!presentationChanged && !dateChanged && !seasonChanged) {
    return {
      ok: true,
      status: "noop",
      win_id: current.id,
      updated_at: current.updatedAt,
      revision_id: null,
      user_edited_at: current.userEditedAt,
    };
  }

  const nextSupportingQuote = presentationChanged ? null : current.supportingQuote;
  const nextActionFact =
    current.sourceType === "manual" ? mapped.action_fact : current.actionFact;

  const { data, error } = await supabaseServer.rpc("v2_apply_user_win_edit_mutation", {
    p_win_id: current.id,
    p_clerk_user_id: clerk,
    p_expected_updated_at: expectedUpdatedAt,
    p_display_title: nextTitle,
    p_display_body: nextBody,
    p_occurred_at: occurredAtIso,
    p_commitment_id: nextCommitmentId,
    p_supporting_quote: nextSupportingQuote,
    p_action_fact: nextActionFact,
  });

  if (error) {
    console.warn("[user_win_edit_failed]", {
      error: error.message?.slice(0, 120) ?? "unknown",
    });
    return {
      ok: false,
      error: "We couldn’t save this Win. Please try again.",
      code: "persist_failed",
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const result =
    row && typeof row === "object" && typeof (row as { result?: unknown }).result === "string"
      ? String((row as { result: string }).result)
      : null;
  const newUpdatedAt =
    row && typeof row === "object" && typeof (row as { updated_at?: unknown }).updated_at === "string"
      ? String((row as { updated_at: string }).updated_at)
      : null;
  const revisionId =
    row && typeof row === "object" && typeof (row as { revision_id?: unknown }).revision_id === "string"
      ? String((row as { revision_id: string }).revision_id)
      : null;

  if (result === "conflict") {
    return {
      ok: false,
      error: "This Win changed since you opened it. Refresh and try again.",
      code: "conflict",
    };
  }
  if (result === "not_found") {
    return { ok: false, error: "Win not found.", code: "not_found" };
  }
  if (result !== "applied" || !newUpdatedAt) {
    return {
      ok: false,
      error: "We couldn’t save this Win. Please try again.",
      code: "persist_failed",
    };
  }

  return {
    ok: true,
    status: "updated",
    win_id: current.id,
    updated_at: newUpdatedAt,
    revision_id: revisionId,
    user_edited_at: newUpdatedAt,
  };
}

export { loadManualWinSeasonOptionsForUser };
export type { ManualWinSeasonOption };

/**
 * Documentation/regression helper: recognition/accountability insert paths must not
 * UPDATE presentation when a row already exists (idempotent insert → existing).
 * Also: any future presentation UPDATE must require user_edited_at IS NULL.
 */
export const USER_EDITED_PRESENTATION_GUARD =
  "If user_edited_at IS NOT NULL, never overwrite display_title, display_body, occurred_at, commitment_id, or supporting_quote from AI/recognition/accountability paths.";
