/**
 * Inbound Win-recognition orchestration helpers (Umbrella 1 + Item #2 Season Wins).
 * Keeps route.ts thinner while preserving OpenAI as semantic authority for recognition
 * and server authority for confirmed user_yes → Win.
 */

import {
  emptyWinRecognitionResult,
  recognizeWinsFromInboundV1,
  shouldRunWinRecognitionForInbound,
  toWinRecognitionFactsForV3,
  type WinRecognitionCallMeta,
  type WinRecognitionFactsForV3,
  type WinRecognitionInputV1,
  type WinRecognitionResultV1,
} from "@/lib/openai-win-recognition-v1";
import {
  persistInboundWinsWithAccountability,
  persistRecognizedWins,
  resolveSmsInboundWinSource,
  type PersistRecognizedWinsResult,
} from "@/lib/v2-win-persist";

export type InboundWinRecognitionBundle = {
  result: WinRecognitionResultV1;
  meta: WinRecognitionCallMeta;
  facts: WinRecognitionFactsForV3;
  ran: boolean;
};

/**
 * Model-facing Current Goal for Win recognition.
 * Law: effective ask → behavior_statement → null. Never legacy commitment.title.
 */
export function resolveWinRecognitionCurrentGoal(args: {
  effectiveAsk?: string | null;
  behaviorStatement?: string | null;
}): string | null {
  const effective =
    typeof args.effectiveAsk === "string" ? args.effectiveAsk.trim() : "";
  if (effective) return effective;
  const behavior =
    typeof args.behaviorStatement === "string" ? args.behaviorStatement.trim() : "";
  if (behavior) return behavior;
  return null;
}

export async function runInboundWinRecognitionForCoachTurn(args: {
  inboundBody: string;
  isTapback?: boolean;
  isSafetyOrCrisisOwned?: boolean;
  isComplianceOrStop?: boolean;
  isSystemNoise?: boolean;
  context: Omit<WinRecognitionInputV1, "inboundMessage" | "safetyOrUrgencyOwned">;
}): Promise<InboundWinRecognitionBundle> {
  const eligibility = shouldRunWinRecognitionForInbound({
    inboundBody: args.inboundBody,
    isTapback: args.isTapback,
    isSafetyOrCrisisOwned: args.isSafetyOrCrisisOwned,
    isComplianceOrStop: args.isComplianceOrStop,
    isSystemNoise: args.isSystemNoise,
  });

  if (!eligibility.run) {
    const result = emptyWinRecognitionResult();
    return {
      result,
      meta: {
        ok: true,
        skipped: true,
        skip_reason: eligibility.reason,
        parse_ok: true,
        timed_out: false,
        candidate_count: 0,
        model: null,
        latency_ms: null,
        schema_version: "win_v1",
      },
      facts: toWinRecognitionFactsForV3(result, false),
      ran: false,
    };
  }

  console.log("[win_recognition_start]", {
    schema_version: "win_v1",
    route_owner: args.context.routeOwner,
  });

  const { result, meta } = await recognizeWinsFromInboundV1({
    ...args.context,
    inboundMessage: args.inboundBody,
    safetyOrUrgencyOwned: args.isSafetyOrCrisisOwned === true,
  });

  console.log("[win_recognition_result]", {
    schema_version: "win_v1",
    has_win: result.has_win,
    candidate_count: meta.candidate_count,
    parse_ok: meta.parse_ok,
    timed_out: meta.timed_out,
    skipped: meta.skipped,
    skip_reason: meta.skip_reason,
    relationship_types: result.wins.map((w) => w.relationship_type),
    celebration_any: result.wins.some((w) => w.celebration_appropriate),
    route_owner: args.context.routeOwner,
  });

  console.log("[win_reply_context_applied]", {
    schema_version: "win_v1",
    has_win: result.has_win,
    candidate_count: result.wins.length,
  });

  return {
    result,
    meta,
    facts: toWinRecognitionFactsForV3(result, false),
    ran: true,
  };
}

export type ConfirmedUserYesWinContext = {
  /** Persisted user_yes event id when known (looked up if null). */
  eventId: string | null;
  commitmentId: string;
  effectiveAsk?: string | null;
  behaviorStatement?: string | null;
  /** Latest inbound text for same/distinct Win classification. */
  inboundMessage?: string | null;
};

export async function persistInboundRecognizedWinsBeforeSend(args: {
  clerkUserId: string;
  messageSid: string;
  activeCommitmentId: string | null;
  activeCommitmentClerkUserId: string | null;
  recognition: WinRecognitionResultV1;
  sourceEventId?: string | null;
  fallbackOccurredAtIso?: string | null;
  /** When set, server-owned accountability Win is ensured and goal recognition is merged. */
  confirmedUserYes?: ConfirmedUserYesWinContext | null;
}): Promise<PersistRecognizedWinsResult> {
  const source = await resolveSmsInboundWinSource({
    messageSid: args.messageSid,
    fallbackOccurredAtIso: args.fallbackOccurredAtIso ?? null,
  });

  if (args.confirmedUserYes?.commitmentId) {
    return persistInboundWinsWithAccountability({
      clerkUserId: args.clerkUserId,
      messageSid: args.messageSid,
      sourceMessageId: source.sourceMessageId,
      userYesEventId: args.confirmedUserYes.eventId ?? args.sourceEventId ?? null,
      commitmentId: args.confirmedUserYes.commitmentId,
      occurredAtIso: source.occurredAtIso,
      effectiveAsk: args.confirmedUserYes.effectiveAsk ?? null,
      behaviorStatement: args.confirmedUserYes.behaviorStatement ?? null,
      inboundMessage: args.confirmedUserYes.inboundMessage ?? null,
      recognition: args.recognition,
    });
  }

  if (!args.recognition.has_win || args.recognition.wins.length === 0) {
    return {
      attempted: 0,
      persisted: 0,
      conflicts: 0,
      failed: 0,
      allDurable: true,
      wins: [],
    };
  }

  return persistRecognizedWins({
    clerkUserId: args.clerkUserId,
    sourceType: "sms_inbound",
    sourceMessageSid: args.messageSid,
    sourceMessageId: source.sourceMessageId,
    sourceEventId: args.sourceEventId ?? null,
    activeCommitmentId: args.activeCommitmentId,
    activeCommitmentClerkUserId: args.activeCommitmentClerkUserId,
    occurredAtIso: source.occurredAtIso,
    recognition: args.recognition,
  });
}

/** Best-effort Win persist for any eligible lane. Never throws; never silences the reply. */
export async function maybePersistInboundWinRecognitionBundle(args: {
  bundle: InboundWinRecognitionBundle | null | undefined;
  clerkUserId: string;
  messageSid: string;
  activeCommitmentId: string | null;
  fallbackOccurredAtIso?: string | null;
  branch?: string | null;
  confirmedUserYes?: ConfirmedUserYesWinContext | null;
}): Promise<PersistRecognizedWinsResult | null> {
  const hasRecognition = Boolean(args.bundle?.result.has_win);
  const hasUserYes = Boolean(args.confirmedUserYes?.commitmentId);
  if (!hasRecognition && !hasUserYes) return null;

  try {
    return await persistInboundRecognizedWinsBeforeSend({
      clerkUserId: args.clerkUserId,
      messageSid: args.messageSid,
      activeCommitmentId: args.activeCommitmentId,
      activeCommitmentClerkUserId: args.clerkUserId,
      recognition: args.bundle?.result ?? emptyWinRecognitionResult(),
      fallbackOccurredAtIso: args.fallbackOccurredAtIso ?? null,
      confirmedUserYes: args.confirmedUserYes ?? null,
      sourceEventId: args.confirmedUserYes?.eventId ?? null,
    });
  } catch (winPersistErr) {
    console.warn("[win_persist_failed]", {
      message_sid: args.messageSid,
      schema_version: "win_v1",
      branch: args.branch ?? null,
      error:
        winPersistErr instanceof Error
          ? winPersistErr.message.slice(0, 120)
          : "unknown",
    });
    return null;
  }
}

/** Build confirmed-user_yes Win context from an accountability persist result. */
export function confirmedUserYesWinContextFromPersistResult(args: {
  persistStatus: string;
  eventType?: string | null;
  eventId?: string | null;
  commitmentId: string;
  effectiveAsk?: string | null;
  behaviorStatement?: string | null;
  inboundMessage?: string | null;
}): ConfirmedUserYesWinContext | null {
  if (args.eventType !== "user_yes") return null;
  if (args.persistStatus !== "inserted" && args.persistStatus !== "duplicate") return null;
  const cid = args.commitmentId.trim();
  if (!cid) return null;
  return {
    eventId: args.eventId ?? null,
    commitmentId: cid,
    effectiveAsk: args.effectiveAsk ?? null,
    behaviorStatement: args.behaviorStatement ?? null,
    inboundMessage: args.inboundMessage ?? null,
  };
}
