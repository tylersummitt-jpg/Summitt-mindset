/**
 * Builds {@link NorthStarSmsContextPacket} from existing SMS/V2 data (no new DB reads beyond caller-provided rows).
 */

import type { NorthStarSmsContextPacket } from "@/lib/north-star-coach-sms";
import type { V2EventRowForAi } from "@/lib/v2-commitment";
import type { V2CoachingMemoryForPrompt } from "@/lib/v2-coaching-memory";
import type { V2SmsConversationContextPack } from "@/lib/v2-sms-conversation-context";
import { parseContractOverlayProposalFromCheckPayload } from "@/lib/v2-outbound-check-sent";
import { getDateKeyInTimezone } from "@/lib/timezone";
import { deriveFutureIntentHint } from "@/lib/north-star-coach-sms";

export function recentEventsIncludeUserYesOnLocalDay(
  events: V2EventRowForAi[],
  timezone: string,
  localDayKey: string
): boolean {
  for (const e of events) {
    if (e.event_type !== "user_yes") continue;
    const dk = getDateKeyInTimezone(new Date(e.occurred_at), timezone);
    if (dk === localDayKey) return true;
  }
  return false;
}

function inferExpectedReplySemanticsFromCheckPayload(checkPayload: Record<string, unknown>): string | null {
  const overlay = parseContractOverlayProposalFromCheckPayload(checkPayload);
  if (overlay) return "proposal_yes_no";
  return "yes_no_partial";
}

function summarizeRelationshipProfile(cm: V2CoachingMemoryForPrompt | null): string | null {
  const rp = cm?.sms_relationship_profile;
  if (!rp) return null;
  const band =
    typeof rp.directness_band === "string" && rp.directness_band.trim()
      ? rp.directness_band.trim().slice(0, 40)
      : "";
  return band ? `directness_band=${band}` : "relationship_profile=present";
}

/**
 * Inbound coach cron: conversation packet for {@link finalizeNorthStarInboundCoachReply}.
 */
/** Daily cron outbound — spine-adjacent hints only (no inbound transcript). */
export function buildDailyOutboundNorthStarContextPacket(args: {
  commitmentId?: string | null;
  effectiveAskText?: string | null;
  priorOutcome?: string | null;
  blockerPreview?: string | null;
}): NorthStarSmsContextPacket {
  const po = args.priorOutcome ?? null;
  return {
    activeCommitmentId: args.commitmentId ?? null,
    behaviorStatement: args.effectiveAskText ?? null,
    effectiveAskText: args.effectiveAskText ?? null,
    latestOutcomeType: po,
    missSignal: po === "user_no" || po === "user_partial",
    blockerSignal: Boolean(args.blockerPreview?.trim()),
    source: "daily_sms",
  };
}

export function buildWeeklySmsNorthStarContextPacket(args: {
  commitmentId: string;
  behaviorStatement: string | null | undefined;
  transcriptSnippet: string | null;
  transcriptLines?: string[];
}): NorthStarSmsContextPacket {
  const bs = typeof args.behaviorStatement === "string" ? args.behaviorStatement.trim() : "";
  return {
    activeCommitmentId: args.commitmentId,
    behaviorStatement: bs || null,
    effectiveAskText: bs || null,
    recentTranscriptSnippet: args.transcriptSnippet?.trim() || null,
    recentTranscriptLines: args.transcriptLines,
    source: "weekly_sms",
  };
}

export function buildInboundNorthStarContextPacket(args: {
  commitmentId: string;
  behaviorStatement: string;
  effectiveAskText: string;
  timezone: string;
  userMessage: string;
  lastOutboundSmsPreview: string | null;
  checkPayload: Record<string, unknown>;
  recentEvents: V2EventRowForAi[];
  convPack: V2SmsConversationContextPack | null;
  coachingMemory: V2CoachingMemoryForPrompt | null;
  finalEventType: string | null;
  lifeDesires: string | null;
  peopleSummary: string | null;
  identityAnchorText: string | null;
  latestBlockerPreview: string | null;
  proofDisplayedOrMoment?: boolean;
}): NorthStarSmsContextPacket {
  const todayLocalDayKey = getDateKeyInTimezone(new Date(), args.timezone);
  const priorYesToday = recentEventsIncludeUserYesOnLocalDay(
    args.recentEvents,
    args.timezone,
    todayLocalDayKey
  );
  const todayCompleted = priorYesToday || args.finalEventType === "user_yes";

  const intent = deriveFutureIntentHint(args.userMessage);

  const latestOutcome = args.recentEvents.find(
    (e) => e.event_type === "user_yes" || e.event_type === "user_no" || e.event_type === "user_partial"
  );
  const latestOutcomeType = latestOutcome?.event_type ?? null;

  const lines = args.convPack?.recentTranscriptLines?.slice(-10) ?? [];
  const snippet = lines.length ? lines.join(" | ").slice(0, 700) : null;

  const missSignal =
    args.finalEventType === "user_no" ||
    args.finalEventType === "user_partial" ||
    latestOutcomeType === "user_no" ||
    latestOutcomeType === "user_partial";

  const proofSignal = args.finalEventType === "user_yes" || args.proofDisplayedOrMoment === true;

  return {
    activeCommitmentId: args.commitmentId,
    behaviorStatement: args.behaviorStatement,
    effectiveAskText: args.effectiveAskText,
    latestInboundRaw: args.userMessage,
    latestOutboundBody: args.lastOutboundSmsPreview,
    latestOpenQuestion: args.lastOutboundSmsPreview,
    expectedReplySemantics: inferExpectedReplySemanticsFromCheckPayload(args.checkPayload),
    recentTranscriptLines: lines.length ? lines : undefined,
    recentTranscriptSnippet: snippet,
    todayCompleted,
    latestOutcomeType,
    finalEventType: args.finalEventType,
    latestBlockerPreview: args.latestBlockerPreview ?? args.convPack?.recentBlockerPattern ?? null,
    coachingSummary: args.coachingMemory?.coaching_summary?.trim() ?? null,
    relationshipProfileSummary: summarizeRelationshipProfile(args.coachingMemory) ?? args.convPack?.safeProfileSummary,
    identityAnchorText: args.identityAnchorText,
    peopleSummary: args.peopleSummary,
    lifeDesires: args.lifeDesires,
    futureIntentHint: intent ?? undefined,
    proofSignal,
    missSignal,
    blockerSignal: Boolean(
      (args.latestBlockerPreview && args.latestBlockerPreview.trim()) ||
        args.convPack?.recentBlockerPattern?.trim()
    ),
    source: "sms_inbound_coach",
    debug: {
      today_local_day_key: todayLocalDayKey,
      prior_yes_today_before_turn: priorYesToday,
    },
  };
}
