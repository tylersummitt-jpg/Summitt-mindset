/**
 * Sol meaningful_win → existing v2_win merge inputs.
 * No win-recognition OpenAI. No win-equivalence OpenAI.
 */

import {
  WIN_RECOGNITION_VERSION,
  type WinCandidateV1,
  type WinRecognitionResultV1,
} from "@/lib/openai-win-recognition-v1";
import type { WinEquivalenceJudgment } from "@/lib/openai-win-candidate-equivalence-v1";
import {
  normalizeSolTrophyTitle,
  type InboundSolBriefExtras,
} from "@/lib/inbound-sol-coaching-brief";
import type { InboundOutcomePersistResult } from "@/lib/v2-inbound-accountability-outcome-persist";
import {
  persistInboundWinsWithAccountability,
  persistRecognizedWins,
  type PersistRecognizedWinsResult,
} from "@/lib/v2-win-persist";
import { scheduleC1IfWinsDurable } from "@/lib/victory-media/correlate-inbound-mms-c1";
import { limitWinDisplayTitleOrFallback } from "@/lib/v2-win-display-title";

export type SolInboundWinPlanInput = {
  recognition: WinRecognitionResultV1 | null;
  equivalenceByOrdinal: Record<number, WinEquivalenceJudgment> | null;
};

const emptyRecognition = (): WinRecognitionResultV1 => ({
  version: WIN_RECOGNITION_VERSION,
  has_win: false,
  wins: [],
});

function lifeWinCandidate(groundedAction: string, inboundText: string): WinCandidateV1 {
  const action = groundedAction.trim().slice(0, 240);
  const quote = inboundText.trim().slice(0, 240) || null;
  return {
    ordinal: 0,
    grounded_action: action,
    why_meaningful: null,
    suggested_title: limitWinDisplayTitleOrFallback(action),
    suggested_body: action.slice(0, 240),
    evidence_quote: quote,
    relationship_type: "whole_life",
    recognition_mode: "user_identified",
    user_expressed_pride: false,
    identity_related: false,
    sensitivity_caution: false,
    celebration_appropriate: true,
    model_confidence: null,
  };
}

/**
 * After allowed user_yes:
 * - goal / mixed / unclear / null → accountability Win only (no ordinal 1)
 * - life → distinct whole_life ordinal 1
 */
export function buildSolInboundWinPlanInput(args: {
  inbound: InboundSolBriefExtras;
  inboundText: string;
}): SolInboundWinPlanInput {
  const win = args.inbound.meaningful_win;
  if (!win || win.relationship !== "life") {
    return {
      recognition: emptyRecognition(),
      equivalenceByOrdinal: {},
    };
  }

  return {
    recognition: {
      version: WIN_RECOGNITION_VERSION,
      has_win: true,
      wins: [lifeWinCandidate(win.grounded_action, args.inboundText)],
    },
    equivalenceByOrdinal: { 0: "distinct" },
  };
}

function persistedUserYes(
  persistResult: InboundOutcomePersistResult
): persistResult is Extract<InboundOutcomePersistResult, { status: "inserted" | "duplicate" }> {
  return (
    (persistResult.status === "inserted" || persistResult.status === "duplicate") &&
    persistResult.eventType === "user_yes"
  );
}

/** Named trophy overlays. Life title is null unless this turn independently has a life Win. */
export function solWinDisplayTitleOverrides(inbound: InboundSolBriefExtras): {
  accountability: string | null;
  independent: string | null;
} {
  const presentation = inbound.win_presentation;
  const hasLife = inbound.meaningful_win?.relationship === "life";
  return {
    accountability: normalizeSolTrophyTitle(presentation?.accountability_trophy_title),
    independent: hasLife ? normalizeSolTrophyTitle(presentation?.life_trophy_title) : null,
  };
}

function recognitionWithLifeTrophyTitle(
  recognition: WinRecognitionResultV1,
  lifeTitle: string | null
): WinRecognitionResultV1 {
  if (!lifeTitle || !recognition.has_win || recognition.wins.length === 0) return recognition;
  const first = recognition.wins[0]!;
  return {
    ...recognition,
    wins: [{ ...first, suggested_title: lifeTitle }, ...recognition.wins.slice(1)],
  };
}

/**
 * Accountability Win stays on user_yes (existing merge).
 * Distinct life Win persists even when user_yes did not.
 * Never double-call persistRecognizedWins on the same SID when the yes merge already owns yes+life.
 */
export async function persistSolInboundWins(args: {
  persistResult: InboundOutcomePersistResult;
  inbound: InboundSolBriefExtras;
  inboundText: string;
  clerkUserId: string;
  messageSid: string;
  commitmentId: string;
  occurredAtIso: string;
  effectiveAsk: string;
  behaviorStatement: string;
}): Promise<PersistRecognizedWinsResult | null> {
  const winPlan = buildSolInboundWinPlanInput({
    inbound: args.inbound,
    inboundText: args.inboundText,
  });
  const titles = solWinDisplayTitleOverrides(args.inbound);

  if (persistedUserYes(args.persistResult)) {
    const result = await persistInboundWinsWithAccountability({
      clerkUserId: args.clerkUserId,
      messageSid: args.messageSid,
      sourceMessageId: null,
      userYesEventId:
        args.persistResult.status === "inserted" ? args.persistResult.eventId : null,
      commitmentId: args.commitmentId,
      occurredAtIso: args.occurredAtIso,
      effectiveAsk: args.effectiveAsk,
      behaviorStatement: args.behaviorStatement,
      recognition: winPlan.recognition,
      inboundMessage: args.inboundText,
      equivalenceByOrdinal: winPlan.equivalenceByOrdinal,
      displayTitleOverrides: {
        accountability: titles.accountability,
        independent: titles.independent,
      },
    });
    scheduleC1IfWinsDurable({
      persisted: result.persisted,
      conflicts: result.conflicts,
      clerkUserId: args.clerkUserId,
      messageSid: args.messageSid,
    });
    return result;
  }

  if (args.inbound.meaningful_win?.relationship !== "life") {
    return null;
  }
  if (!winPlan.recognition?.has_win) {
    return null;
  }

  const recognition = recognitionWithLifeTrophyTitle(winPlan.recognition, titles.independent);
  const recognized = await persistRecognizedWins({
    clerkUserId: args.clerkUserId,
    sourceType: "sms_inbound",
    sourceMessageSid: args.messageSid,
    sourceMessageId: null,
    sourceEventId: null,
    activeCommitmentId: args.commitmentId,
    activeCommitmentClerkUserId: args.clerkUserId,
    occurredAtIso: args.occurredAtIso,
    recognition,
  });
  scheduleC1IfWinsDurable({
    persisted: recognized.persisted,
    conflicts: recognized.conflicts,
    clerkUserId: args.clerkUserId,
    messageSid: args.messageSid,
  });
  return recognized;
}
