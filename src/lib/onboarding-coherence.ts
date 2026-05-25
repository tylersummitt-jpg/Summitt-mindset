/**
 * Deterministic goal–identity coherence scoring for SoB onboarding.
 */

export type CoherenceStatus = "high" | "medium" | "low" | "unknown";
export type SmsSuitability = "strong" | "acceptable" | "weak";

export type CoherenceInput = {
  identityAnchor: string;
  goalTitle: string;
  goalBehavior: string;
  selectedAreaId: string;
  bridgeUserResponse?: string | null;
};

export type CoherenceResult = {
  directConnectionLikely: boolean;
  supportingConnectionLikely: boolean;
  confidence: number;
  coherenceStatus: CoherenceStatus;
  smsSuitability: SmsSuitability;
  checkabilityScore: number;
  coachPatNoteText: string | null;
  coachPatNoteGenerated: boolean;
};

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
}

function overlapScore(a: string, b: string): number {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) {
    if (tb.has(t)) shared += 1;
  }
  return shared / Math.max(ta.size, tb.size);
}

export function computeGoalCoherence(input: CoherenceInput): CoherenceResult {
  const identity = input.identityAnchor.trim();
  const behavior = input.goalBehavior.trim();
  const title = input.goalTitle.trim();

  const overlap = Math.max(
    overlapScore(identity, behavior),
    overlapScore(identity, title) * 0.7
  );

  const behaviorLen = behavior.length;
  const checkabilityScore = Math.min(
    100,
    Math.max(
      20,
      Math.round(
        (behaviorLen >= 40 ? 55 : 35) +
          (/\b(will|today|before|after|minutes|hour)\b/i.test(behavior) ? 25 : 0) +
          overlap * 20
      )
    )
  );

  const bridge = (input.bridgeUserResponse ?? "").trim().length > 0;
  const directConnectionLikely = overlap >= 0.12 || bridge;
  const supportingConnectionLikely = overlap >= 0.05 || behaviorLen >= 30;

  let confidence = Math.round(40 + overlap * 120 + (bridge ? 15 : 0));
  confidence = Math.min(100, Math.max(0, confidence));

  let coherenceStatus: CoherenceStatus = "unknown";
  if (confidence >= 75 && directConnectionLikely) coherenceStatus = "high";
  else if (confidence >= 50) coherenceStatus = "medium";
  else if (confidence >= 25) coherenceStatus = "low";

  let smsSuitability: SmsSuitability = "acceptable";
  if (checkabilityScore >= 70 && behaviorLen >= 35) smsSuitability = "strong";
  else if (checkabilityScore < 40 || behaviorLen < 20) smsSuitability = "weak";

  let coachPatNoteText: string | null = null;
  let coachPatNoteGenerated = false;

  if (
    coherenceStatus === "high" &&
    directConnectionLikely &&
    confidence >= 75
  ) {
    coachPatNoteGenerated = true;
    coachPatNoteText =
      "Your daily check-in lines up with who you said you are becoming. That is the kind of goal Coach Pat can hold you to clearly.";
  }

  return {
    directConnectionLikely,
    supportingConnectionLikely,
    confidence,
    coherenceStatus,
    smsSuitability,
    checkabilityScore,
    coachPatNoteText,
    coachPatNoteGenerated,
  };
}

export function shouldShowReviewCoachPatNote(log: {
  coherence_status?: string | null;
  direct_connection_likely?: boolean | null;
  confidence?: number | null;
  coach_pat_note_text?: string | null;
}): boolean {
  return (
    log.coherence_status === "high" &&
    log.direct_connection_likely === true &&
    typeof log.confidence === "number" &&
    log.confidence >= 75 &&
    typeof log.coach_pat_note_text === "string" &&
    log.coach_pat_note_text.trim().length > 0
  );
}
