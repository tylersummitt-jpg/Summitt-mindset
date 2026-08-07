/**
 * Admin page Generate All — orchestration only.
 * Calls existing Morning/Evening per-user Sol generators.
 * Never sends SMS. Never reserves send events. Never calls Twilio.
 *
 * Locked E7 laws:
 * - explicit draft_for_day_key (no wall-clock day rewrite)
 * - page-sendable audience (loadSendableTylerTextOverviewAudienceMembers)
 * - skip non-current / already-sent before generate (no sent→current resurrection)
 */

import { supabaseServer } from "@/lib/supabase-server";
import { loadSendableTylerTextOverviewAudienceMembers } from "@/lib/tyler-text-overview-admin";
import { requireTylerTextOverviewDraftDayKey } from "@/lib/tyler-text-overview-draft-day-key";
import {
  generateTylerTextOverviewDraftForUser,
  generateTylerTextOverviewEveningPreviewForUser,
  type TylerTextOverviewAudienceRow,
} from "@/lib/tyler-text-overview-generate";
import {
  isTylerTextOverviewEnabled,
  SMS_DAILY_DRAFTS_TABLE,
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
} from "@/lib/tyler-text-overview-types";

export type TtoGenerateAllSlot =
  | typeof SMS_DAILY_PRODUCTION_SEND_SLOT
  | typeof SMS_DAILY_EVENING_PREVIEW_SEND_SLOT;

export type TtoGenerateAllFailure = {
  clerkUserId: string;
  preferredName: string | null;
  error: string;
};

export type TtoGenerateAllResult = {
  ok: boolean;
  draftForDayKey: string;
  sendSlot: TtoGenerateAllSlot;
  targeted: number;
  generated: number;
  protectedTylerAuthority: number;
  skippedAlreadySent: number;
  skippedNonCurrent: number;
  failed: TtoGenerateAllFailure[];
};

async function loadExistingDraftStatusForSlot(args: {
  clerkUserId: string;
  draftForDayKey: string;
  sendSlot: TtoGenerateAllSlot;
}): Promise<{ status: string } | null> {
  const { data, error } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select("status")
    .eq("clerk_user_id", args.clerkUserId)
    .eq("draft_for_day_key", args.draftForDayKey)
    .eq("send_slot", args.sendSlot)
    .maybeSingle();

  if (error) {
    throw new Error(`tto_generate_all_draft_status_lookup_failed:${error.message}`);
  }
  if (!data || typeof data.status !== "string" || !data.status.trim()) {
    return null;
  }
  return { status: data.status.trim() };
}

function toAudienceRow(member: {
  clerkUserId: string;
  phoneNumber: string;
  timezone: string | null;
}): TylerTextOverviewAudienceRow {
  return {
    clerk_user_id: member.clerkUserId,
    phone_number: member.phoneNumber,
    sms_enabled: true,
    stopped_at: null,
    timezone: member.timezone,
    summitt_subscribed: true,
  };
}

/**
 * Shared Generate All orchestrator for Morning / Evening admin pages.
 * Sequential. Continues on individual failure. Send-path free.
 */
export async function generateTtoDraftBatch(args: {
  draftForDayKey: string;
  sendSlot: TtoGenerateAllSlot;
  now?: Date;
}): Promise<TtoGenerateAllResult | { ok: false; error: string; status: number }> {
  if (
    args.sendSlot !== SMS_DAILY_PRODUCTION_SEND_SLOT &&
    args.sendSlot !== SMS_DAILY_EVENING_PREVIEW_SEND_SLOT
  ) {
    return { ok: false, error: "Unsupported send_slot for Generate All", status: 400 };
  }

  let draftForDayKey: string;
  try {
    draftForDayKey = requireTylerTextOverviewDraftDayKey(args.draftForDayKey);
  } catch {
    return { ok: false, error: "Invalid draft_for_day_key", status: 400 };
  }

  if (!isTylerTextOverviewEnabled()) {
    return { ok: false, error: "tyler_text_overview_disabled", status: 503 };
  }

  const now = args.now ?? new Date();
  const sendSlot = args.sendSlot;

  let audience: Awaited<ReturnType<typeof loadSendableTylerTextOverviewAudienceMembers>>;
  try {
    audience = await loadSendableTylerTextOverviewAudienceMembers(now);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "audience_load_failed",
      status: 500,
    };
  }

  const failed: TtoGenerateAllFailure[] = [];
  let generated = 0;
  let protectedTylerAuthority = 0;
  let skippedAlreadySent = 0;
  let skippedNonCurrent = 0;
  let targeted = 0;

  for (const member of audience) {
    targeted += 1;

    let existing: { status: string } | null;
    try {
      existing = await loadExistingDraftStatusForSlot({
        clerkUserId: member.clerkUserId,
        draftForDayKey,
        sendSlot,
      });
    } catch (err) {
      failed.push({
        clerkUserId: member.clerkUserId,
        preferredName: member.preferredName,
        error: err instanceof Error ? err.message : "draft_status_lookup_failed",
      });
      continue;
    }

    if (existing) {
      if (existing.status === "sent") {
        skippedAlreadySent += 1;
        continue;
      }
      if (existing.status !== "current") {
        skippedNonCurrent += 1;
        continue;
      }
    }

    try {
      if (sendSlot === SMS_DAILY_PRODUCTION_SEND_SLOT) {
        const result = await generateTylerTextOverviewDraftForUser({
          audienceUser: toAudienceRow(member),
          now,
          draftForDayKey,
          generationReason: "manual_regenerate",
        });
        if (!result.ok) {
          failed.push({
            clerkUserId: member.clerkUserId,
            preferredName: member.preferredName,
            error: result.error ?? result.reason,
          });
          continue;
        }
        generated += 1;
        if (result.currentDraftProtected) {
          protectedTylerAuthority += 1;
        }
      } else {
        const result = await generateTylerTextOverviewEveningPreviewForUser({
          clerkUserId: member.clerkUserId,
          draftForDayKey,
          now,
        });
        if (!result.ok) {
          failed.push({
            clerkUserId: member.clerkUserId,
            preferredName: member.preferredName,
            error: result.error ?? result.reason,
          });
          continue;
        }
        generated += 1;
        if (result.currentDraftProtected) {
          protectedTylerAuthority += 1;
        }
      }
    } catch (err) {
      failed.push({
        clerkUserId: member.clerkUserId,
        preferredName: member.preferredName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ok: failed.length === 0,
    draftForDayKey,
    sendSlot,
    targeted,
    generated,
    protectedTylerAuthority,
    skippedAlreadySent,
    skippedNonCurrent,
    failed,
  };
}

export async function generateMorningTtoDraftBatch(args: {
  draftForDayKey: string;
  now?: Date;
}): Promise<TtoGenerateAllResult | { ok: false; error: string; status: number }> {
  return generateTtoDraftBatch({
    draftForDayKey: args.draftForDayKey,
    sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
    now: args.now,
  });
}

export async function generateEveningTtoDraftBatch(args: {
  draftForDayKey: string;
  now?: Date;
}): Promise<TtoGenerateAllResult | { ok: false; error: string; status: number }> {
  return generateTtoDraftBatch({
    draftForDayKey: args.draftForDayKey,
    sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
    now: args.now,
  });
}
