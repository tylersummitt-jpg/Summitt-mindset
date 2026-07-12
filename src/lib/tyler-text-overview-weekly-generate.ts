/**
 * Weekly TTO draft generation — persist only. Never sends SMS.
 * Reuses weekly proof pack + V3 relationship lane builders for draft body.
 * Compliance footer is NOT included in the draft (future send appends it).
 */

import type { DailySmsBuilt } from "@/lib/daily-sms-build";
import { getClerkUser } from "@/lib/clerk-rest";
import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { resolveUserFullyOnV2ForCutoverMessaging } from "@/lib/v2-cutover-gates";
import {
  buildV2SmsConversationContextPack,
  type V2SmsConversationContextPack,
} from "@/lib/v2-sms-conversation-context";
import {
  fetchV2UserSmsCommsPreferences,
  shouldSkipWeeklyForCommsPrefs,
} from "@/lib/v2-sms-comms-preferences";
import {
  buildDeterministicWeeklyProofBody,
  buildV2WeeklyProofPack,
  generateV2WeeklyProofSmsBody,
} from "@/lib/v2-weekly-proof-sms";
import {
  buildSmsRelationshipMemoryPacket,
  slimMemoryPacketForFacts,
} from "@/lib/sms-relationship-memory-packet";
import { loadRecentPlannedInterruptionSignalForCommitment } from "@/lib/sms-planned-interruption";
import {
  loadSmsVictoryBackgroundContext,
  mapSmsVictoryBackgroundToFacts,
} from "@/lib/sms-victory-background-context";
import { smsTimePreferenceFromClerkMetadata } from "@/lib/sms-daily-delivery-body";
import { resolveSmsUserTimezone } from "@/lib/timezone";
import { buildWeeklyV3OutboundFactsForV2WeeklyProof } from "@/lib/weekly-sms-v2-weekly-lane-facts";
import { produceWeeklyV3RelationshipSms } from "@/lib/v3-weekly-outbound-relationship-lane";
import { resolveTylerTextOverviewWeeklyPeriod } from "@/lib/tyler-text-overview-weekly-period";
import {
  WEEKLY_TTO_DRAFT_EXCLUDES_COMPLIANCE_FOOTER,
  WEEKLY_TTO_WEEK_ANCHOR_RULE,
  WEEKLY_TTO_WRITER_PROMPT_PATH,
} from "@/lib/tyler-text-overview-weekly-period";
import {
  formatSendPrefSnapshot,
  loadTylerTextOverviewAudienceRow,
  persistTylerTextOverviewDraftFromBuilt,
} from "@/lib/tyler-text-overview-generate";
import type { TylerTextOverviewWriterOpenAiCapture } from "@/lib/tyler-text-overview-writer-capture";
import {
  isTylerTextOverviewEnabled,
  SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
} from "@/lib/tyler-text-overview-types";

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
        | "upsert_failed";
      error?: string;
    };

function weeklyLaneCapture(
  lane: Awaited<ReturnType<typeof produceWeeklyV3RelationshipSms>>
): TylerTextOverviewWriterOpenAiCapture {
  const candidate =
    typeof lane.metadata.v3_candidate_body === "string"
      ? lane.metadata.v3_candidate_body
      : lane.body;
  const messages: TylerTextOverviewWriterOpenAiCapture["messages"] = [];
  if (lane.openAiOk && candidate.trim()) {
    messages.push({
      role: "assistant",
      content: candidate.trim(),
    });
  }
  return {
    messages,
    writer_prompt_path: WEEKLY_TTO_WRITER_PROMPT_PATH,
  };
}

function builtFromWeeklyLane(args: {
  lane: Awaited<ReturnType<typeof produceWeeklyV3RelationshipSms>>;
  commitmentId: string;
}): DailySmsBuilt {
  const capture = weeklyLaneCapture(args.lane);
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

export async function generateTylerTextOverviewWeeklyDraftForUser(args: {
  clerkUserId: string;
  now?: Date;
}): Promise<TylerTextOverviewWeeklyGenerateResult> {
  if (!isTylerTextOverviewEnabled()) {
    return { ok: false, reason: "disabled" };
  }

  const clerkUserId = args.clerkUserId.trim();
  if (!clerkUserId) {
    return { ok: false, reason: "audience", error: "missing_clerk_user_id" };
  }

  const audienceUser = await loadTylerTextOverviewAudienceRow(clerkUserId);
  if (!audienceUser) {
    return { ok: false, reason: "audience", error: "user_not_in_sms_audience" };
  }

  const now = args.now ?? new Date();
  const user = await getClerkUser(clerkUserId);
  const md = (user.public_metadata ?? {}) as Record<string, unknown>;

  const tzResolved = resolveSmsUserTimezone({
    clerkMetadataTimezone: md.timezone,
    audienceTimezone: audienceUser.timezone,
  });
  const timezone = tzResolved.timezone;
  const localNow = new Date(now.toLocaleString("en-US", { timeZone: timezone }));

  const period = resolveTylerTextOverviewWeeklyPeriod({ now, timezone });

  const weeklyCommsPrefs = await fetchV2UserSmsCommsPreferences(clerkUserId);
  if (shouldSkipWeeklyForCommsPrefs(weeklyCommsPrefs, now)) {
    return { ok: false, reason: "comms_prefs" };
  }

  const v2Status = await resolveUserFullyOnV2ForCutoverMessaging(clerkUserId);
  if (!v2Status.fullyOnV2) {
    return { ok: false, reason: "not_v2" };
  }

  const commitment = await getActiveCommitment(clerkUserId);
  if (!commitment?.id) {
    return { ok: false, reason: "no_commitment" };
  }

  const pack = await buildV2WeeklyProofPack({
    clerkUserId,
    commitment,
    localNow,
    timezone,
  });

  let weeklySmsThreadAppend: string | null = null;
  let convForNorthStar: V2SmsConversationContextPack | null = null;
  try {
    const conv = await buildV2SmsConversationContextPack({
      clerkUserId,
      commitmentId: commitment.id,
      commitment,
      timezone,
    });
    convForNorthStar = conv;
    weeklySmsThreadAppend = conv.recentTranscriptLines.slice(-5).join(" | ").slice(0, 700);
  } catch (e) {
    console.warn("[tyler-text-overview-weekly] sms_conversation_context_pack_failed", {
      commitment_id: commitment.id,
      message: e instanceof Error ? e.message : String(e),
    });
  }

  const { body: oldProofPreviewBody, aiUsed } = await generateV2WeeklyProofSmsBody(pack, {
    recentSmsThreadAppend: weeklySmsThreadAppend,
  });
  const deterministicPreviewBody = buildDeterministicWeeklyProofBody(pack);

  let relationshipMemoryPacket = null;
  try {
    const memoryPacket = await buildSmsRelationshipMemoryPacket({
      clerkUserId,
      commitmentId: commitment.id,
      now: localNow,
    });
    relationshipMemoryPacket = slimMemoryPacketForFacts(memoryPacket);
  } catch (e) {
    console.warn("[tyler-text-overview-weekly] relationship_memory_packet_failed", {
      commitment_id: commitment.id,
      message: e instanceof Error ? e.message : String(e),
    });
  }

  let victoryBackgroundFacts = null;
  try {
    victoryBackgroundFacts = mapSmsVictoryBackgroundToFacts(
      await loadSmsVictoryBackgroundContext({
        clerkUserId,
        commitmentId: commitment.id,
        timezone,
      })
    );
  } catch {
    victoryBackgroundFacts = null;
  }

  let plannedInterruptionRow = null;
  try {
    plannedInterruptionRow = await loadRecentPlannedInterruptionSignalForCommitment({
      commitmentId: commitment.id,
      clerkUserId,
      now: localNow,
    });
  } catch {
    plannedInterruptionRow = null;
  }

  const weeklyFacts = buildWeeklyV3OutboundFactsForV2WeeklyProof({
    clerkUserId,
    commitment,
    effectiveAsk: getEffectiveCoachingAsk(commitment, Date.now()),
    pack,
    timezone,
    localNow,
    conv: convForNorthStar,
    weeklySmsThreadAppend,
    oldWeeklyProofBodyPreview: oldProofPreviewBody,
    deterministicWeeklyBodyPreview: deterministicPreviewBody,
    relationshipMemoryPacket,
    victoryBackground: victoryBackgroundFacts,
    plannedInterruption: plannedInterruptionRow,
  });

  const lane = await produceWeeklyV3RelationshipSms({
    facts: weeklyFacts,
    commitmentRow: commitment,
    telemetry_fact_sources: [
      "v2_weekly_proof_pack",
      aiUsed ? "v2_weekly_proof_openai_preview" : "v2_weekly_proof_preview_no_openai",
      "v2_weekly_proof_deterministic_preview",
      "tyler_text_overview_weekly_generate",
    ],
  });

  const built = builtFromWeeklyLane({ lane, commitmentId: commitment.id });
  const clerkSmsTimePreference = smsTimePreferenceFromClerkMetadata(md);
  const sendPrefSnapshot = formatSendPrefSnapshot(clerkSmsTimePreference, weeklyCommsPrefs);

  const generationMetadataExtra = {
    send_slot: SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
    week_key: period.weekKey,
    week_start: pack.week_start,
    week_end: pack.week_end,
    week_anchor_rule: WEEKLY_TTO_WEEK_ANCHOR_RULE,
    timezone,
    draft_excludes_compliance_footer: WEEKLY_TTO_DRAFT_EXCLUDES_COMPLIANCE_FOOTER,
    weekly_lane_no_send_reason: lane.noSendReason,
    weekly_v3_lane_used: true,
    route_purpose: "weekly_proof_v2",
    v3_lane_reply_source: "v3_weekly_relationship_lane",
    openai_ok: lane.openAiOk,
  };

  const persisted = await persistTylerTextOverviewDraftFromBuilt({
    clerkUserId,
    draftForDayKey: period.draftForDayKey,
    generationReason: "manual_regenerate",
    built,
    commitmentId: commitment.id,
    timezone,
    sendPrefSnapshot,
    now,
    sendSlot: SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
    generationMetadataExtra,
    respectProtectedMorningDraft: false,
  });

  if (!persisted.ok) {
    return { ok: false, reason: persisted.reason, error: persisted.error };
  }

  const machineShouldSend = built.ok === true;
  const machineDraftBody = built.ok ? built.smsBody : null;
  const machineNoSendReason = built.ok
    ? null
    : built.error || lane.noSendReason || "weekly_lane_no_send";

  return {
    ok: true,
    draftForDayKey: period.draftForDayKey,
    weekKey: period.weekKey,
    weekStart: pack.week_start,
    weekEnd: pack.week_end,
    timezone,
    generationId: persisted.generationId,
    machineShouldSend,
    machineDraftBody,
    machineNoSendReason,
    sendSlot: SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
  };
}
