/**
 * Shared V3 refine-only lane for machine / template SMS bodies (outbound proposals, refresh,
 * memory confirm, etc.). Does not mutate spine or commitment state.
 *
 * Invariant: never returns raw machineBody as final visible voice — produce → recover → guarantee.
 */

import type { V2InboundGatedDecision } from "@/lib/v2-ai-inbound";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { classifyV2InboundReply } from "@/lib/v2-sms-accountability";
import { buildV2SmsConversationContextPack } from "@/lib/v2-sms-conversation-context";
import { loadV2CoachingMemoryForPrompt } from "@/lib/v2-coaching-memory";
import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import { getRecentV2EventsForAi } from "@/lib/v2-commitment";
import { getDateKeyInTimezone } from "@/lib/timezone";
import {
  buildInboundNorthStarContextPacket,
  recentEventsIncludeUserYesOnLocalDay,
  type ExpectedReplySemanticsV3,
} from "@/lib/north-star-sms-context-packet";
import type { NorthStarSmsContextPacket } from "@/lib/north-star-coach-sms";
import {
  buildMinimalInboundTranscriptLines,
  guaranteeV3InboundCoachDraft,
  produceV3InboundCoachDraft,
  recoverV3InboundCoachDraftFromArgs,
} from "@/lib/v3-sms-brain";

/** Reply metadata when refine lane collapses to sync deterministic V3 (never raw machine seed). */
export const V3_MACHINE_DETERMINISTIC_FALLBACK_SOURCE = "v3_machine_deterministic_fallback";

/** Non-scoring lane for V3 refine on outbound machine drafts (matches inbound refresh pattern). */
export const V3_REFINE_ONLY_GATED: V2InboundGatedDecision = {
  mode: "clarify",
  final_event_type: null,
  decision_reason: "v3_refine_visible_only",
  confidence_used: null,
  should_write_outcome_event: false,
  should_open_blocker_capture: false,
  reply_style: "normal_outcome",
  overrode_deterministic: false,
};

async function terminalV3MachineDeterministicFallback(args: {
  clerkUserId: string;
  messageSid: string;
  commitment: ActiveV2CommitmentRow;
  timezone: string;
  inboundRaw: string;
  machineBody: string;
  hintSource: string;
}): Promise<{ body: string; contextPacket: NorthStarSmsContextPacket }> {
  const coachingMemory = await loadV2CoachingMemoryForPrompt(args.commitment.id).catch(() => null);
  const recentEvents = await getRecentV2EventsForAi(args.commitment.id).catch(() => []);
  const effectiveAsk = getEffectiveCoachingAsk(args.commitment, Date.now());
  const classification = classifyV2InboundReply(args.inboundRaw.trim());
  const latestCheck = recentEvents.find((ev) => ev.event_type === "check_sent");
  const checkPayload = (latestCheck?.payload_json ?? {}) as Record<string, unknown>;
  const lastOut =
    typeof checkPayload.body_preview === "string" && checkPayload.body_preview.trim()
      ? checkPayload.body_preview.trim().slice(0, 260)
      : null;
  const northStarPkt = buildInboundNorthStarContextPacket({
    commitmentId: args.commitment.id,
    behaviorStatement: args.commitment.behavior_statement ?? "",
    effectiveAskText: effectiveAsk,
    timezone: args.timezone,
    userMessage: args.inboundRaw,
    lastOutboundSmsPreview: lastOut,
    checkPayload,
    recentEvents,
    convPack: null,
    coachingMemory,
    finalEventType: classification.eventType,
    lifeDesires: null,
    peopleSummary: null,
    identityAnchorText: null,
    latestBlockerPreview: null,
  });
  const priorYes = recentEventsIncludeUserYesOnLocalDay(
    recentEvents,
    args.timezone,
    getDateKeyInTimezone(new Date(), args.timezone)
  );
  const lines = buildMinimalInboundTranscriptLines(null, args.inboundRaw, lastOut);
  const syn = guaranteeV3InboundCoachDraft({
    userMessage: args.inboundRaw,
    messageSid: args.messageSid,
    commitment: args.commitment,
    effectiveAsk,
    timezone: args.timezone,
    northStarPacket: northStarPkt,
    convPackRecentLines: lines,
    expectedReplySemantics: northStarPkt.expectedReplySemantics as ExpectedReplySemanticsV3,
    latestOpenQuestion: northStarPkt.latestOpenQuestion ?? null,
    todayCompleted: priorYes,
    coachingMemory,
    recentEvents,
    gatedDecision: V3_REFINE_ONLY_GATED,
    deterministicEventType: classification.eventType,
    priorDraftHint: { source: args.hintSource, text: args.machineBody },
  });
  return { body: syn.draft, contextPacket: northStarPkt };
}

export async function refineMachineSmsBodyWithV3RefineLane(args: {
  clerkUserId: string;
  messageSid: string;
  commitment: ActiveV2CommitmentRow;
  timezone: string;
  inboundRaw: string;
  machineBody: string;
  hintSource: string;
  ownedReplySource: string;
  relationshipSnapshotV2Appendix?: string | null;
}): Promise<{ body: string; replySource?: string; contextPacket?: NorthStarSmsContextPacket }> {
  let body = args.machineBody;
  let replySource: string | undefined;
  let contextPacket: NorthStarSmsContextPacket | undefined;

  try {
    const coachingMemory = await loadV2CoachingMemoryForPrompt(args.commitment.id);
    const recentEvents = await getRecentV2EventsForAi(args.commitment.id);

    let convPack: Awaited<ReturnType<typeof buildV2SmsConversationContextPack>> | null = null;
    try {
      convPack = await buildV2SmsConversationContextPack({
        clerkUserId: args.clerkUserId,
        commitmentId: args.commitment.id,
        commitment: args.commitment,
        timezone: args.timezone,
        currentInboundText: args.inboundRaw,
        preloadedCoachingMemory: coachingMemory,
        preloadedEventsNewestFirst: recentEvents,
      });
    } catch (e) {
      console.warn("[v3-sms-machine-refine] conversation_pack_failed", {
        commitment_id: args.commitment.id,
        message: e instanceof Error ? e.message : String(e),
      });
    }

    const effectiveAsk = getEffectiveCoachingAsk(args.commitment, Date.now());
    const classification = classifyV2InboundReply(args.inboundRaw.trim());
    const latestCheck = recentEvents.find((e) => e.event_type === "check_sent");
    const checkPayload = (latestCheck?.payload_json ?? {}) as Record<string, unknown>;
    const lastOut =
      typeof checkPayload.body_preview === "string" && checkPayload.body_preview.trim()
        ? checkPayload.body_preview.trim().slice(0, 260)
        : null;

    const northStarPkt = buildInboundNorthStarContextPacket({
      commitmentId: args.commitment.id,
      behaviorStatement: args.commitment.behavior_statement ?? "",
      effectiveAskText: effectiveAsk,
      timezone: args.timezone,
      userMessage: args.inboundRaw,
      lastOutboundSmsPreview: lastOut,
      checkPayload,
      recentEvents,
      convPack,
      coachingMemory,
      finalEventType: classification.eventType,
      lifeDesires: null,
      peopleSummary: null,
      identityAnchorText: null,
      latestBlockerPreview: null,
    });
    contextPacket = northStarPkt;

    const priorYes = recentEventsIncludeUserYesOnLocalDay(
      recentEvents,
      args.timezone,
      getDateKeyInTimezone(new Date(), args.timezone)
    );

    const lines =
      convPack?.recentTranscriptLines && convPack.recentTranscriptLines.length > 0
        ? convPack.recentTranscriptLines
        : buildMinimalInboundTranscriptLines(convPack, args.inboundRaw, lastOut);

    const draftArgs = {
      userMessage: args.inboundRaw,
      messageSid: args.messageSid,
      commitment: args.commitment,
      effectiveAsk,
      timezone: args.timezone,
      northStarPacket: northStarPkt,
      convPackRecentLines: lines,
      expectedReplySemantics: northStarPkt.expectedReplySemantics as ExpectedReplySemanticsV3,
      latestOpenQuestion: northStarPkt.latestOpenQuestion ?? null,
      todayCompleted: priorYes,
      coachingMemory,
      recentEvents,
      gatedDecision: V3_REFINE_ONLY_GATED,
      deterministicEventType: classification.eventType,
      priorDraftHint: { source: args.hintSource, text: args.machineBody },
      relationshipSnapshotV2Appendix: args.relationshipSnapshotV2Appendix ?? null,
    };

    let refined: Awaited<ReturnType<typeof produceV3InboundCoachDraft>>;
    try {
      refined = await produceV3InboundCoachDraft(draftArgs);
    } catch (e1) {
      console.warn("[v3-sms-brain] machine_refine_produce_failed", {
        message: e1 instanceof Error ? e1.message : String(e1),
      });
      refined = await recoverV3InboundCoachDraftFromArgs(draftArgs);
    }

    body = refined.draft;
    replySource = args.ownedReplySource;
  } catch (e) {
    console.warn("[v3-sms-brain] machine_refine_failed", {
      message: e instanceof Error ? e.message : String(e),
    });
    try {
      const coachingMemory =
        (await loadV2CoachingMemoryForPrompt(args.commitment.id).catch(() => null)) ??
        null;
      const recentEvents = await getRecentV2EventsForAi(args.commitment.id).catch(() => []);
      const effectiveAsk = getEffectiveCoachingAsk(args.commitment, Date.now());
      const classification = classifyV2InboundReply(args.inboundRaw.trim());
      const latestCheck = recentEvents.find((ev) => ev.event_type === "check_sent");
      const checkPayload = (latestCheck?.payload_json ?? {}) as Record<string, unknown>;
      const lastOut =
        typeof checkPayload.body_preview === "string" && checkPayload.body_preview.trim()
          ? checkPayload.body_preview.trim().slice(0, 260)
          : null;
      const northStarPkt = buildInboundNorthStarContextPacket({
        commitmentId: args.commitment.id,
        behaviorStatement: args.commitment.behavior_statement ?? "",
        effectiveAskText: effectiveAsk,
        timezone: args.timezone,
        userMessage: args.inboundRaw,
        lastOutboundSmsPreview: lastOut,
        checkPayload,
        recentEvents,
        convPack: null,
        coachingMemory,
        finalEventType: classification.eventType,
        lifeDesires: null,
        peopleSummary: null,
        identityAnchorText: null,
        latestBlockerPreview: null,
      });
      contextPacket = northStarPkt;
      const priorYes = recentEventsIncludeUserYesOnLocalDay(
        recentEvents,
        args.timezone,
        getDateKeyInTimezone(new Date(), args.timezone)
      );
      const lines = buildMinimalInboundTranscriptLines(null, args.inboundRaw, lastOut);
      const syn = guaranteeV3InboundCoachDraft({
        userMessage: args.inboundRaw,
        messageSid: args.messageSid,
        commitment: args.commitment,
        effectiveAsk,
        timezone: args.timezone,
        northStarPacket: northStarPkt,
        convPackRecentLines: lines,
        expectedReplySemantics: northStarPkt.expectedReplySemantics as ExpectedReplySemanticsV3,
        latestOpenQuestion: northStarPkt.latestOpenQuestion ?? null,
        todayCompleted: priorYes,
        coachingMemory,
        recentEvents,
        gatedDecision: V3_REFINE_ONLY_GATED,
        deterministicEventType: classification.eventType,
        priorDraftHint: { source: args.hintSource, text: args.machineBody },
      });
      body = syn.draft;
      replySource = V3_MACHINE_DETERMINISTIC_FALLBACK_SOURCE;
    } catch (e2) {
      console.error("[v3-sms-brain] machine_refine_guarantee_failed", {
        message: e2 instanceof Error ? e2.message : String(e2),
      });
    }
  }

  if (!replySource) {
    const t = await terminalV3MachineDeterministicFallback({
      clerkUserId: args.clerkUserId,
      messageSid: args.messageSid,
      commitment: args.commitment,
      timezone: args.timezone,
      inboundRaw: args.inboundRaw,
      machineBody: args.machineBody,
      hintSource: args.hintSource,
    });
    body = t.body;
    contextPacket = t.contextPacket;
    replySource = V3_MACHINE_DETERMINISTIC_FALLBACK_SOURCE;
  }

  return { body, replySource, contextPacket };
}
