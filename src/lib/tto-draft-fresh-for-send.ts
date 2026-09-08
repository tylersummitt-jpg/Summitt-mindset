/**
 * Pre-send TTO freshness: persisted generation_effective_ask vs live
 * getEffectiveCoachingAsk. One rule for Morning / Evening / Weekly.
 *
 * Overlay end is detected because generated ask !== current ask.
 * Does not parse SMS bodies.
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
  readTtoGenerationEffectiveAsk,
  SMS_DAILY_DRAFT_GENERATIONS_TABLE,
  SMS_DAILY_DRAFTS_TABLE,
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
  SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
  type SmsDailySendSlot,
} from "@/lib/tyler-text-overview-types";
import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import { getActiveCommitment } from "@/lib/v2-commitment";

const LOG_PREFIX = "[tto-draft-fresh-for-send]";
const PRE_SEND_GENERATION_REASON = "pre_send_stale_refresh" as const;

export type EnsureCurrentTtoDraftFreshForSendFailureReason =
  | "no_current_draft"
  | "draft_lookup_failed"
  | "relationship_unproven"
  | "generation_failed"
  | "stale_draft_disabled"
  | "stale_draft_could_not_be_disabled"
  | "authority_reread_failed"
  | "generation_effective_ask_unproven";

export type EnsureCurrentTtoDraftFreshForSendResult =
  | {
      ok: true;
      status: "fresh" | "regenerated" | "tyler_protected";
      draftId: string;
      currentBodyToSend: string | null;
      currentGenerationId: string | null;
    }
  | {
      ok: false;
      reason: EnsureCurrentTtoDraftFreshForSendFailureReason;
    };

type CurrentDraftRow = {
  id: string;
  current_body_to_send: string | null;
  current_body_source: string | null;
  edited_by_tyler: boolean;
  current_generation_id: string | null;
};

function normalizeEffectiveAskBar(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function asMetadata(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

function warnFresh(message: string, extra?: Record<string, unknown>): void {
  console.warn(LOG_PREFIX, message, extra ?? {});
}

function okResult(
  status: "fresh" | "regenerated" | "tyler_protected",
  draft: CurrentDraftRow
): EnsureCurrentTtoDraftFreshForSendResult {
  return {
    ok: true,
    status,
    draftId: draft.id,
    currentBodyToSend: draft.current_body_to_send,
    currentGenerationId: draft.current_generation_id,
  };
}

export async function ensureCurrentTtoDraftFreshForSend(args: {
  clerkUserId: string;
  sendSlot: SmsDailySendSlot;
  draftForDayKey: string;
  now: Date;
}): Promise<EnsureCurrentTtoDraftFreshForSendResult> {
  const clerkUserId = args.clerkUserId.trim();
  const draftForDayKey = args.draftForDayKey.trim();
  if (!clerkUserId || !draftForDayKey) {
    return { ok: false, reason: "no_current_draft" };
  }

  const loaded = await loadCurrentAuthorityDraft({
    clerkUserId,
    sendSlot: args.sendSlot,
    draftForDayKey,
  });
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  const draft = loaded.draft;

  if (isProtectedTylerProvenanceDraft(draft)) {
    return okResult("tyler_protected", draft);
  }

  let currentAsk: string;
  try {
    const commitment = await getActiveCommitment(clerkUserId);
    if (!commitment) {
      warnFresh("relationship_unproven", { clerk_user_id: clerkUserId });
      return { ok: false, reason: "relationship_unproven" };
    }
    currentAsk = getEffectiveCoachingAsk(commitment, args.now.getTime()).trim();
    if (!currentAsk) {
      warnFresh("relationship_unproven_empty_ask", { clerk_user_id: clerkUserId });
      return { ok: false, reason: "relationship_unproven" };
    }
  } catch (error) {
    warnFresh("relationship_load_threw", {
      clerk_user_id: clerkUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "relationship_unproven" };
  }

  const generatedAsk = await readPersistedGenerationEffectiveAsk(draft);
  if (generatedAsk === "lookup_failed") {
    return { ok: false, reason: "draft_lookup_failed" };
  }

  if (
    generatedAsk != null &&
    normalizeEffectiveAskBar(generatedAsk) === normalizeEffectiveAskBar(currentAsk)
  ) {
    return okResult("fresh", draft);
  }

  const regenerated = await regenerateStaleMachineDraft({
    clerkUserId,
    sendSlot: args.sendSlot,
    draftForDayKey,
    now: args.now,
    draftId: draft.id,
  });
  if (!regenerated.ok) return regenerated;

  const reread = await loadCurrentAuthorityDraft({
    clerkUserId,
    sendSlot: args.sendSlot,
    draftForDayKey,
  });
  if (!reread.ok) {
    return { ok: false, reason: "authority_reread_failed" };
  }
  if (isProtectedTylerProvenanceDraft(reread.draft)) {
    return okResult("tyler_protected", reread.draft);
  }
  const rereadAsk = await readPersistedGenerationEffectiveAsk(reread.draft);
  if (rereadAsk === "lookup_failed") {
    return { ok: false, reason: "draft_lookup_failed" };
  }
  if (rereadAsk == null) {
    warnFresh("generation_effective_ask_unproven", {
      clerk_user_id: clerkUserId,
      draft_id: reread.draft.id,
      send_slot: args.sendSlot,
    });
    return { ok: false, reason: "generation_effective_ask_unproven" };
  }
  return okResult("regenerated", reread.draft);
}

async function loadCurrentAuthorityDraft(args: {
  clerkUserId: string;
  sendSlot: SmsDailySendSlot;
  draftForDayKey: string;
}): Promise<
  | { ok: true; draft: CurrentDraftRow }
  | { ok: false; reason: "no_current_draft" | "draft_lookup_failed" }
> {
  const { data, error } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select(
      "id, current_body_to_send, current_body_source, edited_by_tyler, current_generation_id"
    )
    .eq("clerk_user_id", args.clerkUserId)
    .eq("draft_for_day_key", args.draftForDayKey)
    .eq("send_slot", args.sendSlot)
    .eq("status", "current")
    .maybeSingle();

  if (error) {
    warnFresh("draft_lookup_failed", {
      clerk_user_id: args.clerkUserId,
      error: error.message,
    });
    return { ok: false, reason: "draft_lookup_failed" };
  }
  if (!data || typeof data.id !== "string") {
    return { ok: false, reason: "no_current_draft" };
  }

  return {
    ok: true,
    draft: {
      id: data.id,
      current_body_to_send:
        typeof data.current_body_to_send === "string" ? data.current_body_to_send : null,
      current_body_source:
        typeof data.current_body_source === "string" ? data.current_body_source : null,
      edited_by_tyler: data.edited_by_tyler === true,
      current_generation_id:
        typeof data.current_generation_id === "string" ? data.current_generation_id : null,
    },
  };
}

async function readPersistedGenerationEffectiveAsk(
  draft: CurrentDraftRow
): Promise<string | null | "lookup_failed"> {
  const generationId = draft.current_generation_id?.trim();
  if (!generationId) return null;

  const { data, error } = await supabaseServer
    .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
    .select("generation_metadata")
    .eq("id", generationId)
    .maybeSingle();

  if (error) {
    warnFresh("generation_lookup_failed", {
      draft_id: draft.id,
      generation_id: generationId,
      error: error.message,
    });
    return "lookup_failed";
  }
  if (!data) return null;
  return readTtoGenerationEffectiveAsk(asMetadata(data.generation_metadata));
}

async function regenerateStaleMachineDraft(args: {
  clerkUserId: string;
  sendSlot: SmsDailySendSlot;
  draftForDayKey: string;
  now: Date;
  draftId: string;
}): Promise<EnsureCurrentTtoDraftFreshForSendResult> {
  try {
    const generated = await dispatchExistingSlotGenerator(args);
    if (generated.ok) {
      return {
        ok: true,
        status: "regenerated",
        draftId: args.draftId,
        currentBodyToSend: null,
        currentGenerationId: null,
      };
    }
    warnFresh("generation_failed", {
      clerk_user_id: args.clerkUserId,
      draft_id: args.draftId,
      send_slot: args.sendSlot,
      reason: generated.reason,
    });
  } catch (error) {
    warnFresh("generation_threw", {
      clerk_user_id: args.clerkUserId,
      draft_id: args.draftId,
      send_slot: args.sendSlot,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return settleUnusable(args.draftId);
}

async function dispatchExistingSlotGenerator(args: {
  clerkUserId: string;
  sendSlot: SmsDailySendSlot;
  draftForDayKey: string;
  now: Date;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (args.sendSlot === SMS_DAILY_PRODUCTION_SEND_SLOT) {
    const audienceUser = await loadTylerTextOverviewAudienceRow(args.clerkUserId);
    if (!audienceUser) {
      return { ok: false, reason: "audience_missing" };
    }
    const generated = await generateTylerTextOverviewDraftForUser({
      audienceUser,
      now: args.now,
      draftForDayKey: args.draftForDayKey,
      generationReason: PRE_SEND_GENERATION_REASON,
      protectTylerProvenanceOnly: true,
    });
    return generated.ok ? { ok: true } : { ok: false, reason: generated.reason };
  }

  if (args.sendSlot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT) {
    const generated = await generateTylerTextOverviewEveningPreviewForUser({
      clerkUserId: args.clerkUserId,
      draftForDayKey: args.draftForDayKey,
      now: args.now,
      protectTylerProvenanceOnly: true,
    });
    return generated.ok ? { ok: true } : { ok: false, reason: generated.reason };
  }

  if (args.sendSlot === SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT) {
    const generated = await generateTylerTextOverviewWeeklyDraftForUser({
      clerkUserId: args.clerkUserId,
      now: args.now,
    });
    return generated.ok ? { ok: true } : { ok: false, reason: generated.reason };
  }

  return { ok: false, reason: "unsupported_slot" };
}

async function settleUnusable(
  draftId: string
): Promise<EnsureCurrentTtoDraftFreshForSendResult> {
  const disabled = await markCurrentTtoDraftUnusable(draftId);
  if (disabled) {
    return { ok: false, reason: "stale_draft_disabled" };
  }
  warnFresh("stale_draft_could_not_be_disabled", { draft_id: draftId });
  return { ok: false, reason: "stale_draft_could_not_be_disabled" };
}
