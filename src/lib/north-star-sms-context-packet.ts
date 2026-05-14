/**
 * Builds {@link NorthStarSmsContextPacket} from existing SMS/V2 data (no new DB reads beyond caller-provided rows).
 */

import type { NorthStarSmsContextPacket } from "@/lib/north-star-coach-sms";
import type { V2EventRowForAi } from "@/lib/v2-commitment";
import type { V2CoachingMemoryForPrompt } from "@/lib/v2-coaching-memory";
import type { V2SmsConversationContextPack } from "@/lib/v2-sms-conversation-context";
import { parseContractOverlayProposalFromCheckPayload } from "@/lib/v2-check-payload-contract-parse";
import { getDateKeyInTimezone } from "@/lib/timezone";
import { deriveFutureIntentHint } from "@/lib/north-star-coach-sms";

/** V3 — expected answer shape for the latest coach question (not spine scoring). */
export type ExpectedReplySemanticsV3 =
  | "accountability_check"
  | "future_plan_story_title"
  | "time_or_schedule"
  | "discrete_choice"
  | "blocker_detail"
  | "goal_change_clarification"
  | "proposal_yes_no"
  | "open_reflection"
  | "unknown";

function extractLastQuestionClause(coachMessage: string): string | null {
  const msg = coachMessage.trim();
  if (!/\?/.test(msg)) return null;
  const parts = msg.match(/[^?!.]+[?]/g);
  if (parts?.length) return parts[parts.length - 1]!.trim();
  return msg;
}

function coachMessageContainsQuestion(coachMessage: string): boolean {
  const m = coachMessage.trim();
  if (/\?/.test(m)) return true;
  const first = (m.split(/[.!?\n]/)[0] ?? "").trim();
  if (/^(tell me|name|say|give me|pick|choose)\b/i.test(first)) return true;
  if (/\b(tell me|give me|pick one|choose one)\b/i.test(m)) return true;
  return /^(what|when|where|which|who|how|why|is it|are you|can you|could you|would you|did you)\b/i.test(
    first
  );
}

/**
 * Parse `recentTranscriptLines` ("Coach: …" / "User: …") for latest coach SMS + open question authority.
 */
export function deriveLatestCoachAuthorityFromTranscript(recentTranscriptLines: string[]): {
  derivedLatestCoachSms: string | null;
  latestOpenQuestion: string | null;
  expectedReplySemantics: ExpectedReplySemanticsV3;
} {
  let lastCoachLine: string | null = null;
  for (let i = recentTranscriptLines.length - 1; i >= 0; i--) {
    const ln = recentTranscriptLines[i] ?? "";
    const coachPrefix = /^\s*Coach:\s*(.+)$/i.exec(ln);
    if (coachPrefix?.[1]) {
      lastCoachLine = coachPrefix[1].trim();
      break;
    }
  }

  if (!lastCoachLine) {
    return {
      derivedLatestCoachSms: null,
      latestOpenQuestion: null,
      expectedReplySemantics: "unknown",
    };
  }

  const derivedLatestCoachSms = lastCoachLine.replace(/\s+/g, " ").trim();
  const openQ = extractLastQuestionClause(derivedLatestCoachSms);
  let latestOpenQuestion: string | null =
    openQ && coachMessageContainsQuestion(derivedLatestCoachSms)
      ? openQ
      : /\?/.test(derivedLatestCoachSms)
        ? derivedLatestCoachSms
        : null;
  if (!latestOpenQuestion && coachMessageContainsQuestion(derivedLatestCoachSms)) {
    latestOpenQuestion = derivedLatestCoachSms;
  }

  const sem = inferExpectedReplySemanticsFromCoachQuestion(
    latestOpenQuestion ?? derivedLatestCoachSms
  );

  return {
    derivedLatestCoachSms,
    latestOpenQuestion,
    expectedReplySemantics: sem,
  };
}

export function inferExpectedReplySemanticsFromCoachQuestion(coachQuestionOrMessage: string): ExpectedReplySemanticsV3 {
  const q = coachQuestionOrMessage.toLowerCase();
  return inferExpectedReplySemanticsFromCoachQuestionInner(q);
}

function inferExpectedReplySemanticsFromCoachQuestionInner(q: string): ExpectedReplySemanticsV3 {
  if (
    /\bwhat\s+story\b/i.test(q) ||
    (/what\s+story/i.test(q) && /\btomorrow\b/i.test(q)) ||
    /\b(dictate|write).*\b(tomorrow|next)\b/i.test(q) ||
    /\bwhat\b.*\b(dictate|story)\b.*\b(tomorrow|next)\b/i.test(q)
  ) {
    return "future_plan_story_title";
  }
  if (
    /\bwhat\s+time\b/i.test(q) ||
    /\bwhen\b.*\b(block|start|wake|alarm|begin)\b/i.test(q) ||
    /\bwhen\s+will\s+you\b/i.test(q) ||
    /\b(block)\b.*\b(start|tomorrow)\b/i.test(q)
  ) {
    return "time_or_schedule";
  }
  if (/time,\s*energy,\s*or\s*avoidance/i.test(q)) return "discrete_choice";
  if (
    /\bwhat\s+got\s+in\s+the\s+way\b/i.test(q) ||
    /\bmain\s+blocker\b/i.test(q) ||
    /\btell me\b.*\b(way|wrong|happened|blocking)\b/i.test(q)
  ) {
    return "blocker_detail";
  }
  if (/\b(change|raise|lower)\b.*\b(goal|bar|commitment)\b/i.test(q)) return "goal_change_clarification";
  if (
    /\bdid\s+you\b.*\btoday\b/i.test(q) ||
    /\btoday\b.*\b(commitment|follow through|protect|dictate|hour|rep)\b/i.test(q) ||
    /\bdid\s+you\b.*\b(dictate|complete|finish)\b/i.test(q)
  ) {
    return "accountability_check";
  }
  if (/\?/.test(q)) return "open_reflection";
  return "unknown";
}

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

function inferExpectedReplySemanticsFromCheckPayload(
  checkPayload: Record<string, unknown>
): ExpectedReplySemanticsV3 | null {
  const overlay = parseContractOverlayProposalFromCheckPayload(checkPayload);
  if (overlay) return "proposal_yes_no";
  return null;
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

  const lines = args.convPack?.recentTranscriptLines?.slice(-12) ?? [];
  const snippet = lines.length ? lines.join(" | ").slice(0, 700) : null;

  const auth = deriveLatestCoachAuthorityFromTranscript(lines);
  const proposalFromCheck = inferExpectedReplySemanticsFromCheckPayload(args.checkPayload);

  let expectedSemantics: ExpectedReplySemanticsV3 =
    proposalFromCheck === "proposal_yes_no" ? "proposal_yes_no" : auth.expectedReplySemantics;

  let latestOutboundBody = auth.derivedLatestCoachSms ?? args.lastOutboundSmsPreview;
  let latestOpenQuestionField = auth.latestOpenQuestion;

  if (!latestOutboundBody && args.lastOutboundSmsPreview) {
    latestOutboundBody = args.lastOutboundSmsPreview;
  }
  if (!latestOpenQuestionField && args.lastOutboundSmsPreview?.trim()) {
    latestOpenQuestionField =
      extractLastQuestionClause(args.lastOutboundSmsPreview) ?? args.lastOutboundSmsPreview.trim();
  }
  if (expectedSemantics === "unknown" && args.lastOutboundSmsPreview?.trim()) {
    expectedSemantics = inferExpectedReplySemanticsFromCoachQuestion(args.lastOutboundSmsPreview.trim());
  }

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
    latestOutboundBody,
    latestOpenQuestion: latestOpenQuestionField,
    expectedReplySemantics: expectedSemantics,
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
      transcript_sources_used: args.convPack?.meta?.transcript_sources_used,
      derived_latest_coach_sms: auth.derivedLatestCoachSms,
      expected_reply_semantics_v3: expectedSemantics,
    },
  };
}
