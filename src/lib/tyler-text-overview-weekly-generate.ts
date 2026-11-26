/**
 * Weekly TTO generation is retired.
 * Sunday coaching is the member's ordinary scheduled daily text.
 * This function does not call an interpreter, a writer, or persist a draft.
 */

import type { DailySmsBuilt } from "@/lib/daily-sms-build";
import type { WeeklyV3RelationshipLaneResult } from "@/lib/v3-weekly-outbound-relationship-lane";
import {
  WEEKLY_TTO_DRAFT_EXCLUDES_COMPLIANCE_FOOTER,
  WEEKLY_TTO_WEEK_ANCHOR_RULE,
  WEEKLY_TTO_WRITER_PROMPT_PATH,
} from "@/lib/tyler-text-overview-weekly-period";
import { SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT } from "@/lib/tyler-text-overview-types";

export {
  WEEKLY_TTO_DRAFT_EXCLUDES_COMPLIANCE_FOOTER,
  WEEKLY_TTO_WEEK_ANCHOR_RULE,
  WEEKLY_TTO_WRITER_PROMPT_PATH,
};

export type TylerTextOverviewWeeklyGenerateResult =
  | {
      ok: true;
      draftForDayKey: string;
      weekKey: string;
      weekStart: string;
      weekEnd: string;
      timezone: string;
      generationId: string;
      machineShouldSend: boolean;
      machineDraftBody: string | null;
      machineNoSendReason: string | null;
      currentDraftProtected?: boolean;
      sendSlot: typeof SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT;
    }
  | {
      ok: false;
      reason:
        | "disabled"
        | "audience"
        | "comms_prefs"
        | "not_v2"
        | "no_commitment"
        | "build_failed"
        | "insert_failed"
        | "upsert_failed"
        | "weekly_delivery_retired";
      error?: string;
    };

/** Legacy mapper kept for existing capture tests. Live generate no longer uses the V3 lane. */
export function builtFromWeeklyLane(args: {
  lane: WeeklyV3RelationshipLaneResult;
  commitmentId: string;
}): DailySmsBuilt {
  const capture = args.lane.writerOpenAiCapture ?? null;
  if (args.lane.shouldSend && args.lane.body.trim()) {
    return {
      ok: true,
      smsBody: args.lane.body.trim(),
      deliveryStateSnapshot: null,
      day2SpecialUsed: false,
      v2Accountability: true,
      v2CommitmentId: args.commitmentId,
      v2EffectiveAskText: null,
      writerOpenAiCapture: capture,
    };
  }
  return {
    ok: false,
    error: args.lane.noSendReason?.trim() || "weekly_lane_no_send",
    writerOpenAiCapture: capture,
    dailyLaneMeta: {
      no_send_reason: args.lane.noSendReason?.trim() || "weekly_lane_no_send",
      route_purpose: "weekly_proof_v2",
      ...args.lane.metadata,
    },
  };
}

export async function generateTylerTextOverviewWeeklyDraftForUser(_args: {
  clerkUserId: string;
  now?: Date;
  /** Send-time stale conversation only. Default false. */
  allowReplaceStaleTylerNonempty?: boolean;
  replacedStaleTylerBody?: string | null;
  replacedStaleTylerEditedAt?: string | null;
}): Promise<TylerTextOverviewWeeklyGenerateResult> {
  return {
    ok: false,
    reason: "weekly_delivery_retired",
    error: "weekly_delivery_retired",
  };
}
