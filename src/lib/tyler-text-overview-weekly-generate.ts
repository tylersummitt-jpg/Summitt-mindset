/**
 * Weekly TTO draft generation — persist only. Never sends SMS.
 * W1: Hallway packet → GPT-5.6 Sol interpreter → six-section Brief → GPT-5.6 Sol writer.
 * Compliance footer is NOT included in the draft (send appends it).
 */

import type { DailySmsBuilt } from "@/lib/daily-sms-build";
import { getClerkUser } from "@/lib/clerk-rest";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { resolveUserFullyOnV2ForCutoverMessaging } from "@/lib/v2-cutover-gates";
import {
  fetchV2UserSmsCommsPreferences,
  shouldSkipWeeklyForCommsPrefs,
} from "@/lib/v2-sms-comms-preferences";
import { smsTimePreferenceFromClerkMetadata } from "@/lib/sms-daily-delivery-body";
import { resolveSmsUserTimezone } from "@/lib/timezone";
import type { WeeklyV3RelationshipLaneResult } from "@/lib/v3-weekly-outbound-relationship-lane";
import { resolveTylerTextOverviewWeeklyPeriod } from "@/lib/tyler-text-overview-weekly-period";
import {
  WEEKLY_TTO_DRAFT_EXCLUDES_COMPLIANCE_FOOTER,
  WEEKLY_TTO_WEEK_ANCHOR_RULE,
  WEEKLY_TTO_WRITER_PROMPT_PATH,
} from "@/lib/tyler-text-overview-weekly-period";
import {
  formatSendPrefSnapshot,
  loadTylerTextOverviewAudienceRow,
  persistMorningTtoGeneration,
} from "@/lib/tyler-text-overview-generate";
import type { TylerTextOverviewWriterOpenAiMessage } from "@/lib/tyler-text-overview-writer-capture";
import {
  isTylerTextOverviewEnabled,
  SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
} from "@/lib/tyler-text-overview-types";
import {
  WEEKLY_BRIEF_WRITER_RAN_VERDICT_REASON,
  WEEKLY_RELATIONSHIP_ROUTE_KIND,
  loadWeeklyRelationshipPacket,
} from "@/lib/weekly-tto-relationship-packet";
import {
  buildWeeklyBriefInterpreterMetadataV1,
  runWeeklyBriefInterpreterV1,
} from "@/lib/weekly-tto-brief-interpreter";
import { writeWeeklyTtoBody } from "@/lib/weekly-tto-writer";
import { evaluateWeeklySolBlockOnlyBody } from "@/lib/weekly-tto-body-validate";

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
        | "upsert_failed";
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

function mapOpenAiMessagesToWriterCapture(
  messages: Array<{ role: string; content?: unknown }>
): TylerTextOverviewWriterOpenAiMessage[] {
  return messages
    .filter(
      (m): m is { role: "system" | "user" | "assistant"; content: string } =>
        (m.role === "system" || m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    )
    .map((m) => ({ role: m.role, content: m.content }));
}

function weeklyPersistForensics(capturePresent: boolean): {
  routeKind: typeof WEEKLY_RELATIONSHIP_ROUTE_KIND;
  notebookVerdictReason: string;
} {
  return {
    routeKind: WEEKLY_RELATIONSHIP_ROUTE_KIND,
    notebookVerdictReason: capturePresent
      ? WEEKLY_BRIEF_WRITER_RAN_VERDICT_REASON
      : "writer_not_invoked",
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

  const clerkSmsTimePreference = smsTimePreferenceFromClerkMetadata(md);
  const sendPrefSnapshot = formatSendPrefSnapshot(clerkSmsTimePreference, weeklyCommsPrefs);

  const weeklyMetaBase = {
    send_slot: SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
    week_key: period.weekKey,
    week_start: period.weekStart,
    week_end: period.weekEnd,
    week_anchor_rule: WEEKLY_TTO_WEEK_ANCHOR_RULE,
    timezone,
    draft_excludes_compliance_footer: WEEKLY_TTO_DRAFT_EXCLUDES_COMPLIANCE_FOOTER,
    coaching_stack: "shared_sol_v1",
    weekly_v3_lane_used: false,
    packet_version: "weekly_relationship_v1",
  };

  const packetResult = await loadWeeklyRelationshipPacket({
    clerkUserId,
    timezone,
    weekStartLocalDate: period.weekStart,
    weekEndLocalDate: period.weekEnd,
    now,
    commitmentId: commitment.id,
  });

  if (!packetResult.ok) {
    const persisted = await persistMorningTtoGeneration({
      clerkUserId,
      draftForDayKey: period.draftForDayKey,
      generationReason: "manual_regenerate",
      commitmentId: commitment.id,
      timezone,
      sendPrefSnapshot,
      now,
      sendSlot: SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
      failure: { error: packetResult.error },
      generationMetadataExtra: weeklyMetaBase,
      respectProtectedMorningDraft: true,
      protectTylerProvenanceOnly: true,
      ...weeklyPersistForensics(false),
    });

    if (!persisted.ok) {
      return { ok: false, reason: persisted.reason, error: persisted.error };
    }

    return {
      ok: true,
      draftForDayKey: period.draftForDayKey,
      weekKey: period.weekKey,
      weekStart: period.weekStart,
      weekEnd: period.weekEnd,
      timezone,
      generationId: persisted.generationId,
      machineShouldSend: false,
      machineDraftBody: null,
      machineNoSendReason: packetResult.error,
      currentDraftProtected: persisted.currentDraftProtected === true,
      sendSlot: SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
    };
  }

  const { packet, commitmentId } = packetResult;
  const packetMetadata = {
    thread_message_count: packet.exact_thread.messages.length,
    days_since_last_user_response: packet.last_user_response.days_since,
    never_replied: packet.last_user_response.never_replied,
    has_pending_goal_change: packet.hard_state.pending_goal_change != null,
  };

  const interpreterResult = await runWeeklyBriefInterpreterV1({
    packet,
    clerkUserId,
    commitmentId,
  });
  const weeklyCoachingBrief = interpreterResult.brief;
  const interpreterMeta = buildWeeklyBriefInterpreterMetadataV1(interpreterResult.capture);
  if (!interpreterResult.ok) {
    interpreterMeta.fallback_brief_used = true;
  }

  const writerResult = await writeWeeklyTtoBody({
    packet,
    weeklyCoachingBrief,
  });
  const writerMessages = writerResult.messages
    ? mapOpenAiMessagesToWriterCapture(writerResult.messages)
    : undefined;
  const retryMessages = mapOpenAiMessagesToWriterCapture(writerResult.retryMessages ?? []);
  const retryOccurred = writerResult.retryOccurred === true;
  const writerModel = typeof writerResult.model === "string" ? writerResult.model : null;
  const writerCapture = writerResult.capture
    ? {
        capture_version: writerResult.capture.capture_version,
        model: writerResult.capture.model,
        temperature: writerResult.capture.temperature,
        reasoning_effort: writerResult.capture.reasoning_effort,
        max_completion_tokens: writerResult.capture.max_completion_tokens,
        prompt_path: writerResult.capture.prompt_path,
        request_started_at: writerResult.capture.request_started_at,
        request_completed_at: writerResult.capture.request_completed_at,
        latency_ms: writerResult.capture.latency_ms,
        raw_response: writerResult.capture.raw_response,
        raw_retry_response: writerResult.capture.raw_retry_response,
        error: writerResult.capture.error,
        openai_error: writerResult.capture.openai_error ?? null,
        retry_occurred: writerResult.capture.retry_occurred,
        retry_succeeded: writerResult.capture.retry_succeeded,
      }
    : undefined;
  const writerPromptPathForPersist = writerMessages?.length
    ? WEEKLY_TTO_WRITER_PROMPT_PATH
    : null;

  const generationMetadataExtra = {
    ...weeklyMetaBase,
    weekly_brief_interpreter_v1: interpreterMeta,
    morning_coaching_brief_v1: weeklyCoachingBrief,
    message_for: packet.message_for,
    weekly_relationship_packet_v1: packet,
  };

  if (!writerResult.ok) {
    const persisted = await persistMorningTtoGeneration({
      clerkUserId,
      draftForDayKey: period.draftForDayKey,
      generationReason: "manual_regenerate",
      commitmentId,
      timezone,
      sendPrefSnapshot,
      now,
      sendSlot: SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
      failure: {
        error: writerResult.error,
        messages: writerMessages,
        writerPromptPath: writerPromptPathForPersist,
        model: writerModel,
        retryMessages,
        retryOccurred,
        retrySucceeded: retryOccurred ? false : undefined,
        writerCapture,
      },
      packetMetadata,
      generationMetadataExtra,
      respectProtectedMorningDraft: true,
      protectTylerProvenanceOnly: true,
      ...weeklyPersistForensics(Boolean(writerMessages?.length)),
    });

    if (!persisted.ok) {
      return { ok: false, reason: persisted.reason, error: persisted.error };
    }

    return {
      ok: true,
      draftForDayKey: period.draftForDayKey,
      weekKey: period.weekKey,
      weekStart: period.weekStart,
      weekEnd: period.weekEnd,
      timezone,
      generationId: persisted.generationId,
      machineShouldSend: false,
      machineDraftBody: null,
      machineNoSendReason: writerResult.error,
      currentDraftProtected: persisted.currentDraftProtected === true,
      sendSlot: SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
    };
  }

  const blocked = evaluateWeeklySolBlockOnlyBody(writerResult.body);
  if (!blocked.ok) {
    const persisted = await persistMorningTtoGeneration({
      clerkUserId,
      draftForDayKey: period.draftForDayKey,
      generationReason: "manual_regenerate",
      commitmentId,
      timezone,
      sendPrefSnapshot,
      now,
      sendSlot: SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
      failure: {
        error: blocked.reason,
        messages: writerMessages,
        writerPromptPath: writerPromptPathForPersist,
        model: writerModel,
        retryMessages,
        retryOccurred,
        retrySucceeded: retryOccurred ? writerResult.ok : undefined,
        writerCapture,
      },
      packetMetadata,
      generationMetadataExtra: {
        ...generationMetadataExtra,
        weekly_block_only_reason: blocked.reason,
        weekly_blocked_body_preview: writerResult.body.slice(0, 220),
      },
      respectProtectedMorningDraft: true,
      protectTylerProvenanceOnly: true,
      ...weeklyPersistForensics(Boolean(writerMessages?.length)),
    });

    if (!persisted.ok) {
      return { ok: false, reason: persisted.reason, error: persisted.error };
    }

    return {
      ok: true,
      draftForDayKey: period.draftForDayKey,
      weekKey: period.weekKey,
      weekStart: period.weekStart,
      weekEnd: period.weekEnd,
      timezone,
      generationId: persisted.generationId,
      machineShouldSend: false,
      machineDraftBody: null,
      machineNoSendReason: blocked.reason,
      currentDraftProtected: persisted.currentDraftProtected === true,
      sendSlot: SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
    };
  }

  const persisted = await persistMorningTtoGeneration({
    clerkUserId,
    draftForDayKey: period.draftForDayKey,
    generationReason: "manual_regenerate",
    commitmentId,
    timezone,
    sendPrefSnapshot,
    now,
    sendSlot: SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
    success: {
      body: writerResult.body,
      messages: mapOpenAiMessagesToWriterCapture(writerResult.messages),
      writerPromptPath: WEEKLY_TTO_WRITER_PROMPT_PATH,
      model: writerModel ?? undefined,
      retryMessages,
      retryOccurred,
      retrySucceeded: retryOccurred ? true : undefined,
      writerCapture,
    },
    packetMetadata,
    generationMetadataExtra,
    respectProtectedMorningDraft: true,
    protectTylerProvenanceOnly: true,
    ...weeklyPersistForensics(true),
  });

  if (!persisted.ok) {
    return { ok: false, reason: persisted.reason, error: persisted.error };
  }

  const currentDraftProtected = persisted.currentDraftProtected === true;
  return {
    ok: true,
    draftForDayKey: period.draftForDayKey,
    weekKey: period.weekKey,
    weekStart: period.weekStart,
    weekEnd: period.weekEnd,
    timezone,
    generationId: persisted.generationId,
    machineShouldSend: currentDraftProtected ? false : true,
    machineDraftBody: currentDraftProtected ? null : writerResult.body,
    machineNoSendReason: currentDraftProtected ? "current_draft_protected" : null,
    currentDraftProtected,
    sendSlot: SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
  };
}
