/**
 * Pure deterministic Coach Pat's Read for Victory Room SSR (no OpenAI).
 */

import {
  inferRecentProofCategory,
  type VictoryMoment,
  type VictoryRoomViewData,
} from "@/lib/v2-victory-room-view";

const MAX_CHARS = 450;
const MAX_SENTENCES = 3;

const TRUNC = {
  name: 72,
  anchor: 220,
  ask: 380,
  title: 100,
  momentHeadline: 72,
  momentBody: 200,
  comebackLine: 220,
} as const;

function truncateOneLine(s: string, max: number): string {
  const x = s.trim().replace(/\s+/g, " ");
  if (x.length <= max) return x;
  return `${x.slice(0, max - 1)}…`;
}

function countSentences(text: string): number {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return 0;
  const parts = t.split(/(?<=[.!?])\s+/).filter((p) => p.length > 0);
  return Math.max(parts.length, 1);
}

function clampToMaxSentences(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  const parts = t.split(/(?<=[.!?])\s+/).filter((p) => p.length > 0);
  if (parts.length <= max) return t;
  return parts.slice(0, max).join(" ").trim();
}

/** Narrow JSON-safe bundle for Pat read and AI summary input. */
export type VictorySummaryInput = {
  address_as: string;
  preferred_name: string | null;
  identity_anchor_text: string | null;
  effective_ask: string;
  commitment_title: string | null;
  moments: { headline: string; body: string }[];
  comeback_lines: string[];
  sparse: boolean;
  input_contains_digit: boolean;
};

function bundleHasDigit(input: VictorySummaryInput): boolean {
  const blob = JSON.stringify({
    address_as: input.address_as,
    preferred_name: input.preferred_name,
    identity_anchor_text: input.identity_anchor_text,
    effective_ask: input.effective_ask,
    commitment_title: input.commitment_title,
    moments: input.moments,
    comeback_lines: input.comeback_lines,
  });
  return /\d/.test(blob);
}

export function buildVictorySummaryInput(
  view: VictoryRoomViewData,
  addressAs: string
): VictorySummaryInput | null {
  if (!view.hasActiveV2Commitment) {
    return null;
  }

  const askRaw = view.effectiveCoachingAsk?.trim() || "Your commitment is active.";

  const moments = view.moments.slice(0, 5).map((m) => ({
    headline: truncateOneLine(m.headline, TRUNC.momentHeadline),
    body: truncateOneLine(m.body, TRUNC.momentBody),
  }));

  const comeback_lines = view.comebackLines
    .slice(0, 3)
    .map((l) => truncateOneLine(l, TRUNC.comebackLine));

  const input: VictorySummaryInput = {
    address_as: truncateOneLine(addressAs.trim() || "there", TRUNC.name),
    preferred_name: view.profile.preferred_name?.trim()
      ? truncateOneLine(view.profile.preferred_name, TRUNC.name)
      : null,
    identity_anchor_text: view.profile.identity_anchor_text?.trim()
      ? truncateOneLine(view.profile.identity_anchor_text, TRUNC.anchor)
      : null,
    effective_ask: truncateOneLine(askRaw, TRUNC.ask),
    commitment_title: view.commitment?.title?.trim()
      ? truncateOneLine(view.commitment.title, TRUNC.title)
      : null,
    moments,
    comeback_lines,
    sparse: moments.length === 0 && comeback_lines.length === 0,
    input_contains_digit: false,
  };
  input.input_contains_digit = bundleHasDigit(input);
  return input;
}

function normalizeCompareText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function hasAdaptiveOverlayAsk(view: VictoryRoomViewData, input: VictorySummaryInput): boolean {
  const base = normalizeCompareText(view.commitment?.behavior_statement);
  const effective = normalizeCompareText(input.effective_ask);
  if (!effective || effective === "your commitment is active.") return false;
  return base !== effective;
}

/** Evidence-aware coaching instruction — not a repeat of the canonical current goal. */
export function buildNextMoveCopy(
  view: VictoryRoomViewData,
  input: VictorySummaryInput
): string {
  if (input.sparse) {
    return "Start with one honest check-in today — name whether you kept the goal or tell the truth about what got in the way.";
  }

  const latestMoment = view.moments[0] ?? null;
  const latestCategory = latestMoment ? inferRecentProofCategory(latestMoment) : null;

  const hasComebackSignal =
    view.comebackLines.length > 0 ||
    latestCategory === "told_the_truth" ||
    latestCategory === "came_back";

  if (hasComebackSignal) {
    if (view.comebackLines.length > 0 || latestCategory === "came_back") {
      return "Stay in the conversation today — name the result plainly, then make the next move small enough to complete.";
    }
    return "Use the truth you just named. Remove one obstacle and answer the next check-in honestly.";
  }

  if (latestCategory === "showed_up" || latestCategory === "kept_the_thread_alive") {
    return "Protect the same standard today. Do the work early enough that the day does not decide for you.";
  }

  if (hasAdaptiveOverlayAsk(view, input)) {
    const adaptiveAsk = truncateOneLine(input.effective_ask, TRUNC.ask);
    return `Today's adjustment is the move: ${adaptiveAsk}. Keep it honest and temporary.`;
  }

  return "Take the next honest step today, then let your check-in tell the truth about what happened.";
}

export type DeterministicPatRead = {
  strength: string;
  pattern: string | null;
  nextMove: string;
  provenance: "deterministic";
};

export function buildDeterministicPatRead(
  view: VictoryRoomViewData,
  addressAs: string
): DeterministicPatRead | null {
  const input = buildVictorySummaryInput(view, addressAs);
  if (!input) return null;

  const name = input.address_as;

  let strength = "";
  if (input.sparse) {
    strength = `${name}, you opened this chapter with a clear identity and goal. Proof will gather here as you answer real check-ins honestly — no performance, just truth.`;
  } else if (input.identity_anchor_text) {
    const proofHint =
      input.moments.length > 0
        ? truncateOneLine(input.moments[0].body, 160)
        : input.comeback_lines.length > 0
          ? truncateOneLine(input.comeback_lines[0], 160)
          : null;
    strength = proofHint
      ? `You are building proof around who you said you are becoming: ${truncateOneLine(input.identity_anchor_text, 120)}. Recent check-ins show ${proofHint}`
      : `You are building proof around who you said you are becoming: ${truncateOneLine(input.identity_anchor_text, 160)}.`;
  } else if (input.moments.length > 0) {
    strength = `Your recent check-ins show real follow-through: ${truncateOneLine(input.moments[0].body, 200)}`;
  } else if (input.comeback_lines.length > 0) {
    strength = truncateOneLine(input.comeback_lines[0], 220);
  } else {
    strength = `${name}, you are in the early chapter of this commitment. Keep answering honestly — that is how this room fills in.`;
  }

  let pattern: string | null = null;
  if (!input.sparse && input.moments.length >= 2) {
    const cats = input.moments.map((m) => {
      const full: VictoryMoment = {
        id: "pat-read",
        occurredAt: new Date(0).toISOString(),
        headline: m.headline,
        body: m.body,
        groundedInEventTypes: [],
      };
      return inferRecentProofCategory(full);
    });
    const first = cats[0];
    const sameCategory = first != null && cats.filter((c) => c === first).length >= 2;
    const hasComeback =
      view.comebackLines.length > 0 ||
      cats.includes("came_back") ||
      cats.includes("told_the_truth");
    if (sameCategory && first) {
      const label =
        first === "told_the_truth"
          ? "telling the truth and staying in it"
          : first === "came_back"
            ? "coming back after a miss"
            : first === "adjusted_wisely"
              ? "adjusting wisely instead of quitting"
              : first === "raised_the_bar"
                ? "raising the bar with honesty"
                : first === "showed_up" || first === "kept_the_thread_alive"
                  ? "keeping your goal in daily check-ins"
                  : null;
      if (label) {
        pattern = `A pattern is showing up: ${label}. This is evidence of who you are becoming — not about being perfect.`;
      }
    } else if (
      hasComeback &&
      cats.includes("told_the_truth") &&
      (cats.includes("came_back") || view.comebackLines.length > 0)
    ) {
      pattern =
        "A pattern is showing up: you get honest after a miss and stay in the conversation instead of disappearing. The proof is that you kept coming back.";
    }
  }

  const nextMove = buildNextMoveCopy(view, input);

  return {
    strength: clampToMaxSentences(truncateOneLine(strength, MAX_CHARS), MAX_SENTENCES),
    pattern: pattern
      ? clampToMaxSentences(truncateOneLine(pattern, MAX_CHARS), 2)
      : null,
    nextMove: clampToMaxSentences(truncateOneLine(nextMove, MAX_CHARS), 2),
    provenance: "deterministic",
  };
}
