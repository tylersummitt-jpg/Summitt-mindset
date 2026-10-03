/**
 * Pre-send TTO freshness for Morning / Evening / Weekly.
 *
 * A nonempty saved sentence is stale when a real conversation is newer than
 * the sentence's authority time. The existing lane generator writes the next
 * sentence. Ask freshness still runs when conversation did not move.
 * Tyler blank and machine intentional silence stay no-send.
 */

import { supabaseServer } from "@/lib/supabase-server";
import { markCurrentTtoDraftUnusable } from "@/lib/tto-mark-current-draft-unusable";
import {
  readLatestRealConversationAt,
  realConversationIsNewerThanAuthority,
} from "@/lib/tto-latest-real-conversation-at";
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
  | "generation_effective_ask_unproven"
  | "conversation_lookup_failed"
  | "conversation_moved_again";

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
  edited_at: string | null;
  current_generation_id: string | null;
  generated_at: string | null;
  machine_should_send: boolean | null;
  generation_metadata: Record<string, unknown> | null;
};

type StaleTylerReplaceArgs = {
  allowReplaceStaleTylerNonempty: true;
  replacedStaleTylerBody: string | null;
  replacedStaleTylerEditedAt: string | null;
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

function bodyText(draft: CurrentDraftRow): string {
  return (draft.current_body_to_send ?? "").trim();
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

function authorityInstant(draft: CurrentDraftRow): string | null {
  if (isProtectedTylerProvenanceDraft(draft)) return draft.edited_at;
  return draft.generated_at;
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

  const latest = await readLatestRealConversationAt(clerkUserId);
  if (!latest.ok) {
    warnFresh("conversation_lookup_failed", {
      clerk_user_id: clerkUserId,
      error: latest.error,
    });
    return { ok: false, reason: "conversation_lookup_failed" };
  }

  const tyler = isProtectedTylerProvenanceDraft(draft);
  const nonempty = bodyText(draft).length > 0;

  if (tyler && !nonempty) {
    return okResult("tyler_protected", draft);
  }

  if (tyler && nonempty) {
    const stale =
      !draft.edited_at ||
      realConversationIsNewerThanAuthority(latest.at, draft.edited_at);
    if (!stale) {
      return okResult("tyler_protected", draft);
    }
    const regenerated = await regenerateStaleMachineDraft({
      clerkUserId,
      sendSlot: args.sendSlot,
      draftForDayKey,
      now: args.now,
      draftId: draft.id,
      staleTylerReplace: {
        allowReplaceStaleTylerNonempty: true,
        replacedStaleTylerBody: draft.current_body_to_send,
        replacedStaleTylerEditedAt: draft.edited_at,
      },
    });
    if (!regenerated.ok) return regenerated;
    return proveSingleRegeneration({
      clerkUserId,
      sendSlot: args.sendSlot,
      draftForDayKey,
      now: args.now,
    });
  }

  const machineSentence =
    nonempty && draft.machine_should_send !== false;
  if (
    machineSentence &&
    realConversationIsNewerThanAuthority(latest.at, draft.generated_at)
  ) {
    const regenerated = await regenerateStaleMachineDraft({
      clerkUserId,
      sendSlot: args.sendSlot,
      draftForDayKey,
      now: args.now,
      draftId: draft.id,
    });
    if (!regenerated.ok) return regenerated;
    return proveSingleRegeneration({
      clerkUserId,
      sendSlot: args.sendSlot,
      draftForDayKey,
      now: args.now,
    });
  }

  return proveAskFreshness({
    clerkUserId,
    sendSlot: args.sendSlot,
    draftForDayKey,
    now: args.now,
    draft,
  });
}

/**
 * Immediate pre-Twilio re-read. Does not regenerate.
 * "outgrown" and "lookup_failed" both mean: do not send this attempt.
 */
export async function savedProactiveSentenceOutgrownByRealConversation(args: {
  clerkUserId: string;
  sendSlot: SmsDailySendSlot;
  draftForDayKey: string;
}): Promise<"current" | "outgrown" | "lookup_failed"> {
  const loaded = await loadCurrentAuthorityDraft(args);
  if (!loaded.ok) return "lookup_failed";
  const draft = loaded.draft;
  if (!bodyText(draft)) return "current";
  if (isProtectedTylerProvenanceDraft(draft) && !draft.edited_at) {
    return "outgrown";
  }
  const latest = await readLatestRealConversationAt(args.clerkUserId);
  if (!latest.ok) return "lookup_failed";
  if (realConversationIsNewerThanAuthority(latest.at, authorityInstant(draft))) {
    return "outgrown";
  }
  return "current";
}

async function proveAskFreshness(args: {
  clerkUserId: string;
  sendSlot: SmsDailySendSlot;
  draftForDayKey: string;
  now: Date;
  draft: CurrentDraftRow;
}): Promise<EnsureCurrentTtoDraftFreshForSendResult> {
  let currentAsk: string;
  try {
    const commitment = await getActiveCommitment(args.clerkUserId);
    if (!commitment) {
      warnFresh("relationship_unproven", { clerk_user_id: args.clerkUserId });
      return { ok: false, reason: "relationship_unproven" };
    }
    currentAsk = getEffectiveCoachingAsk(commitment, args.now.getTime()).trim();
    if (!currentAsk) {
      warnFresh("relationship_unproven_empty_ask", { clerk_user_id: args.clerkUserId });
      return { ok: false, reason: "relationship_unproven" };
    }
  } catch (error) {
    warnFresh("relationship_load_threw", {
      clerk_user_id: args.clerkUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "relationship_unproven" };
  }

  const generatedAsk = readPersistedGenerationEffectiveAsk(args.draft);
  if (
    generatedAsk != null &&
    normalizeEffectiveAskBar(generatedAsk) === normalizeEffectiveAskBar(currentAsk)
  ) {
    return okResult("fresh", args.draft);
  }

  const regenerated = await regenerateStaleMachineDraft({
    clerkUserId: args.clerkUserId,
    sendSlot: args.sendSlot,
    draftForDayKey: args.draftForDayKey,
    now: args.now,
    draftId: args.draft.id,
  });
  if (!regenerated.ok) return regenerated;
  return proveSingleRegeneration(args);
}

async function proveSingleRegeneration(args: {
  clerkUserId: string;
  sendSlot: SmsDailySendSlot;
  draftForDayKey: string;
  now: Date;
}): Promise<EnsureCurrentTtoDraftFreshForSendResult> {
  const reread = await loadCurrentAuthorityDraft(args);
  if (!reread.ok) {
    return { ok: false, reason: "authority_reread_failed" };
  }
  if (isProtectedTylerProvenanceDraft(reread.draft)) {
    return settleUnusable(reread.draft.id);
  }

  const latest = await readLatestRealConversationAt(args.clerkUserId);
  if (!latest.ok) {
    warnFresh("conversation_lookup_failed_after_regen", {
      clerk_user_id: args.clerkUserId,
      error: latest.error,
    });
    return { ok: false, reason: "conversation_lookup_failed" };
  }
  if (
    bodyText(reread.draft) &&
    realConversationIsNewerThanAuthority(latest.at, authorityInstant(reread.draft))
  ) {
    warnFresh("conversation_moved_again", {
      clerk_user_id: args.clerkUserId,
      draft_id: reread.draft.id,
      send_slot: args.sendSlot,
    });
    return { ok: false, reason: "conversation_moved_again" };
  }

  const rereadAsk = readPersistedGenerationEffectiveAsk(reread.draft);
  if (rereadAsk == null) {
    warnFresh("generation_effective_ask_unproven", {
      clerk_user_id: args.clerkUserId,
      draft_id: reread.draft.id,
      send_slot: args.sendSlot,
    });
    return { ok: false, reason: "generation_effective_ask_unproven" };
  }

  let liveAsk: string;
  try {
    const liveCommitment = await getActiveCommitment(args.clerkUserId);
    if (!liveCommitment) {
      warnFresh("relationship_unproven_after_regen", { clerk_user_id: args.clerkUserId });
      return { ok: false, reason: "relationship_unproven" };
    }
    liveAsk = getEffectiveCoachingAsk(liveCommitment, args.now.getTime()).trim();
    if (!liveAsk) {
      warnFresh("relationship_unproven_empty_ask_after_regen", {
        clerk_user_id: args.clerkUserId,
      });
      return { ok: false, reason: "relationship_unproven" };
    }
  } catch (error) {
    warnFresh("relationship_load_threw_after_regen", {
      clerk_user_id: args.clerkUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "relationship_unproven" };
  }

  if (normalizeEffectiveAskBar(rereadAsk) !== normalizeEffectiveAskBar(liveAsk)) {
    warnFresh("generation_effective_ask_mismatch_after_regen", {
      clerk_user_id: args.clerkUserId,
      draft_id: reread.draft.id,
      send_slot: args.sendSlot,
    });
    return settleUnusable(reread.draft.id);
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
      "id, current_body_to_send, current_body_source, edited_by_tyler, edited_at, current_generation_id"
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

  const generationId =
    typeof data.current_generation_id === "string" ? data.current_generation_id : null;
  let generatedAt: string | null = null;
  let machineShouldSend: boolean | null = null;
  let generationMetadata: Record<string, unknown> | null = null;
  if (generationId) {
    const generation = await supabaseServer
      .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
      .select("generated_at, machine_should_send, generation_metadata")
      .eq("id", generationId)
      .maybeSingle();
    if (generation.error) {
      warnFresh("generation_lookup_failed", {
        draft_id: data.id,
        generation_id: generationId,
        error: generation.error.message,
      });
      return { ok: false, reason: "draft_lookup_failed" };
    }
    if (generation.data) {
      generatedAt =
        typeof generation.data.generated_at === "string" ? generation.data.generated_at : null;
      machineShouldSend =
        typeof generation.data.machine_should_send === "boolean"
          ? generation.data.machine_should_send
          : null;
      generationMetadata = asMetadata(generation.data.generation_metadata);
    }
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
      edited_at: typeof data.edited_at === "string" ? data.edited_at : null,
      current_generation_id: generationId,
      generated_at: generatedAt,
      machine_should_send: machineShouldSend,
      generation_metadata: generationMetadata,
    },
  };
}

function readPersistedGenerationEffectiveAsk(draft: CurrentDraftRow): string | null {
  return readTtoGenerationEffectiveAsk(draft.generation_metadata);
}

async function regenerateStaleMachineDraft(args: {
  clerkUserId: string;
  sendSlot: SmsDailySendSlot;
  draftForDayKey: string;
  now: Date;
  draftId: string;
  staleTylerReplace?: StaleTylerReplaceArgs;
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
  staleTylerReplace?: StaleTylerReplaceArgs;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const replace = args.staleTylerReplace ?? {};
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
      ...replace,
    });
    return generated.ok ? { ok: true } : { ok: false, reason: generated.reason };
  }

  if (args.sendSlot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT) {
    const generated = await generateTylerTextOverviewEveningPreviewForUser({
      clerkUserId: args.clerkUserId,
      draftForDayKey: args.draftForDayKey,
      now: args.now,
      protectTylerProvenanceOnly: true,
      ...replace,
    });
    return generated.ok ? { ok: true } : { ok: false, reason: generated.reason };
  }

  if (args.sendSlot === SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT) {
    const generated = await generateTylerTextOverviewWeeklyDraftForUser({
      clerkUserId: args.clerkUserId,
      now: args.now,
      ...replace,
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
