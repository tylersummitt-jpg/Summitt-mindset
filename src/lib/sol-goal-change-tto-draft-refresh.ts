/**
 * After a proven Goal Change state transition, refresh this user's current
 * unsent Morning / Evening / Weekly TTO drafts via existing generators.
 *
 * Exact-send is unchanged: later send uses persisted current_body_to_send.
 * Goal Change DB truth is authoritative — refresh failure never rolls it back.
 * Natural-expiry freshness is out of scope (no mutation callback).
 */

import { supabaseServer } from "@/lib/supabase-server";
import { markCurrentTtoDraftUnusable } from "@/lib/tto-mark-current-draft-unusable";
import {
  generateTylerTextOverviewDraftForUser,
  generateTylerTextOverviewEveningPreviewForUser,
  loadTylerTextOverviewAudienceRow,
} from "@/lib/tyler-text-overview-generate";
import { generateTylerTextOverviewWeeklyDraftForUser } from "@/lib/tyler-text-overview-weekly-generate";
import {
  isProtectedTylerProvenanceDraft,
  isTylerTextOverviewEnabled,
  parseSmsDailySendSlot,
  SMS_DAILY_DRAFTS_TABLE,
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
  SMS_DAILY_SEND_SLOTS,
  SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
  type SmsDailySendSlot,
} from "@/lib/tyler-text-overview-types";

const LOG_PREFIX = "[sol-goal-change-tto-draft-refresh]";
const RELATIONSHIP_REFRESH_GENERATION_REASON = "manual_regenerate" as const;

export type RefreshUnsentTtoDraftsOutcomeStatus =
  | "refreshed"
  | "protected"
  | "skipped_unusable"
  | "stale_draft_could_not_be_disabled";

export type RefreshUnsentTtoDraftsFailureReason =
  | "query_failed"
  | "refresh_threw"
  | "stale_draft_could_not_be_disabled";

export type RefreshUnsentTtoDraftsOutcome = {
  draftId: string;
  sendSlot: SmsDailySendSlot;
  draftForDayKey: string;
  status: RefreshUnsentTtoDraftsOutcomeStatus;
};

export type RefreshUnsentTtoDraftsResult =
  | {
      ok: true;
      clerkUserId: string;
      outcomes: RefreshUnsentTtoDraftsOutcome[];
    }
  | {
      ok: false;
      clerkUserId: string;
      reason: RefreshUnsentTtoDraftsFailureReason;
      outcomes: RefreshUnsentTtoDraftsOutcome[];
    };

type CurrentUnsentTtoDraftRow = {
  id: string;
  clerk_user_id: string;
  draft_for_day_key: string;
  send_slot: SmsDailySendSlot;
  status: "current";
  current_body_to_send: string | null;
  current_body_source: string | null;
  edited_by_tyler: boolean;
};

function emptyResult(clerkUserId: string): RefreshUnsentTtoDraftsResult {
  return { ok: true, clerkUserId, outcomes: [] };
}

function failedResult(
  clerkUserId: string,
  reason: RefreshUnsentTtoDraftsFailureReason,
  outcomes: RefreshUnsentTtoDraftsOutcome[] = []
): RefreshUnsentTtoDraftsResult {
  return { ok: false, clerkUserId, reason, outcomes };
}

function warnRefresh(message: string, extra?: Record<string, unknown>): void {
  console.warn(LOG_PREFIX, message, extra ?? {});
}

function resultFromOutcomes(
  clerkUserId: string,
  outcomes: RefreshUnsentTtoDraftsOutcome[]
): RefreshUnsentTtoDraftsResult {
  const unresolved = outcomes.some((o) => o.status === "stale_draft_could_not_be_disabled");
  if (unresolved) {
    return failedResult(clerkUserId, "stale_draft_could_not_be_disabled", outcomes);
  }
  return { ok: true, clerkUserId, outcomes };
}

/**
 * Best-effort refresh after proven Goal Change. Never throws.
 * ok:false means freshness was not proven — it does not roll back Goal Change.
 */
export async function refreshUnsentTtoDraftsAfterRelationshipChange(args: {
  clerkUserId: string;
  now?: Date;
}): Promise<RefreshUnsentTtoDraftsResult> {
  const clerkUserId = args.clerkUserId.trim();
  if (!clerkUserId) return emptyResult("");
  try {
    return await refreshUnsentTtoDraftsAfterRelationshipChangeInner({
      clerkUserId,
      now: args.now ?? new Date(),
    });
  } catch (error) {
    warnRefresh("refresh_threw", {
      clerk_user_id: clerkUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return failedResult(clerkUserId, "refresh_threw");
  }
}

async function refreshUnsentTtoDraftsAfterRelationshipChangeInner(args: {
  clerkUserId: string;
  now: Date;
}): Promise<RefreshUnsentTtoDraftsResult> {
  if (!isTylerTextOverviewEnabled()) {
    return emptyResult(args.clerkUserId);
  }

  let drafts: CurrentUnsentTtoDraftRow[];
  try {
    drafts = await loadCurrentUnsentTtoDrafts(args.clerkUserId);
  } catch (error) {
    warnRefresh("query_failed", {
      clerk_user_id: args.clerkUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return failedResult(args.clerkUserId, "query_failed");
  }

  const outcomes: RefreshUnsentTtoDraftsOutcome[] = [];
  let audienceUser:
    | Awaited<ReturnType<typeof loadTylerTextOverviewAudienceRow>>
    | undefined;
  let weeklyInvoked = false;

  for (const draft of drafts) {
    if (isProtectedTylerProvenanceDraft(draft)) {
      outcomes.push(outcome(draft, "protected"));
      continue;
    }

    try {
      if (draft.send_slot === SMS_DAILY_PRODUCTION_SEND_SLOT) {
        if (audienceUser === undefined) {
          audienceUser = await loadTylerTextOverviewAudienceRow(args.clerkUserId);
        }
        if (!audienceUser) {
          outcomes.push(await settleUnusableDraft(draft));
          continue;
        }
        const generated = await generateTylerTextOverviewDraftForUser({
          audienceUser,
          now: args.now,
          draftForDayKey: draft.draft_for_day_key,
          generationReason: RELATIONSHIP_REFRESH_GENERATION_REASON,
          protectTylerProvenanceOnly: true,
        });
        outcomes.push(await settleGeneratedDraft(draft, generated));
        continue;
      }

      if (draft.send_slot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT) {
        const generated = await generateTylerTextOverviewEveningPreviewForUser({
          clerkUserId: args.clerkUserId,
          draftForDayKey: draft.draft_for_day_key,
          now: args.now,
          protectTylerProvenanceOnly: true,
        });
        outcomes.push(await settleGeneratedDraft(draft, generated));
        continue;
      }

      if (draft.send_slot === SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT) {
        if (weeklyInvoked) {
          continue;
        }
        weeklyInvoked = true;
        const generated = await generateTylerTextOverviewWeeklyDraftForUser({
          clerkUserId: args.clerkUserId,
          now: args.now,
        });
        outcomes.push(await settleGeneratedDraft(draft, generated));
      }
    } catch (error) {
      warnRefresh("slot_refresh_threw", {
        clerk_user_id: args.clerkUserId,
        draft_id: draft.id,
        send_slot: draft.send_slot,
        error: error instanceof Error ? error.message : String(error),
      });
      outcomes.push(await settleUnusableDraft(draft));
    }
  }

  return resultFromOutcomes(args.clerkUserId, outcomes);
}

async function settleGeneratedDraft(
  draft: CurrentUnsentTtoDraftRow,
  generated:
    | { ok: true; currentDraftProtected?: boolean }
    | { ok: false; reason?: string; error?: string }
): Promise<RefreshUnsentTtoDraftsOutcome> {
  if (generated.ok) {
    if (generated.currentDraftProtected === true) {
      return outcome(draft, "protected");
    }
    return outcome(draft, "refreshed");
  }
  warnRefresh("generation_failed", {
    draft_id: draft.id,
    send_slot: draft.send_slot,
    reason: generated.reason ?? generated.error ?? "unknown",
  });
  return settleUnusableDraft(draft);
}

async function settleUnusableDraft(
  draft: CurrentUnsentTtoDraftRow
): Promise<RefreshUnsentTtoDraftsOutcome> {
  const disabled = await markCurrentTtoDraftUnusable(draft.id);
  if (disabled) {
    return outcome(draft, "skipped_unusable");
  }
  warnRefresh("stale_draft_could_not_be_disabled", {
    draft_id: draft.id,
    send_slot: draft.send_slot,
  });
  return outcome(draft, "stale_draft_could_not_be_disabled");
}

function outcome(
  draft: CurrentUnsentTtoDraftRow,
  status: RefreshUnsentTtoDraftsOutcomeStatus
): RefreshUnsentTtoDraftsOutcome {
  return {
    draftId: draft.id,
    sendSlot: draft.send_slot,
    draftForDayKey: draft.draft_for_day_key,
    status,
  };
}

async function loadCurrentUnsentTtoDrafts(
  clerkUserId: string
): Promise<CurrentUnsentTtoDraftRow[]> {
  const { data, error } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select(
      "id, clerk_user_id, draft_for_day_key, send_slot, status, current_body_to_send, current_body_source, edited_by_tyler"
    )
    .eq("clerk_user_id", clerkUserId)
    .eq("status", "current")
    .in("send_slot", [...SMS_DAILY_SEND_SLOTS]);

  if (error) {
    throw new Error(`current_unsent_tto_drafts_query_failed:${error.message}`);
  }

  return (data ?? [])
    .map((row) => {
      const sendSlot = parseSmsDailySendSlot(
        typeof row.send_slot === "string" ? row.send_slot : null
      );
      if (
        typeof row.id !== "string" ||
        typeof row.clerk_user_id !== "string" ||
        typeof row.draft_for_day_key !== "string" ||
        sendSlot == null ||
        row.status !== "current"
      ) {
        return null;
      }
      return {
        id: row.id,
        clerk_user_id: row.clerk_user_id,
        draft_for_day_key: row.draft_for_day_key,
        send_slot: sendSlot,
        status: "current" as const,
        current_body_to_send:
          typeof row.current_body_to_send === "string" ? row.current_body_to_send : null,
        current_body_source:
          typeof row.current_body_source === "string" ? row.current_body_source : null,
        edited_by_tyler: row.edited_by_tyler === true,
      } satisfies CurrentUnsentTtoDraftRow;
    })
    .filter((row): row is CurrentUnsentTtoDraftRow => row != null);
}
