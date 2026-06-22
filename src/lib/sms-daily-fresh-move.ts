/**
 * Daily fresh-move / CTA do-not-repeat — derived from recent coach bodies (no OpenAI).
 */

import type { RecentCoachBodyDoNotRepeat } from "@/lib/sms-recent-coach-body-anti-repeat";

export type DailyFreshMovePhrase = {
  phrase: string;
  source_body_preview: string;
  at_local: string | null;
};

export type DailyFreshMoveFacts = {
  recent_cta_do_not_repeat: DailyFreshMovePhrase[];
  recent_advice_do_not_repeat: DailyFreshMovePhrase[];
  fresh_move_required: boolean;
};

export type BriefFreshnessGoalContext = {
  effectiveAsk?: string | null;
  behaviorStatement?: string | null;
};

const MIN_PHRASE_CHARS = 12;
const MAX_PHRASE_CHARS = 72;
const MAX_PHRASES = 8;
const BRIEF_FRESHNESS_BODY_WINDOW = 12;

const WORD_NUMBERS = "one|two|three|four|five|ten|fifteen|twenty|thirty";

const CTA_LEAD_RE =
  /\b(?:aim for|focus on|try to|try using|use a|use the|consider|protect the|start with|set a|get in|block out|schedule|spend|give yourself|take)\s+([^.;!?]{8,60})/gi;

const DURATION_CTA_RE = new RegExp(
  `\\b(?:(?:${WORD_NUMBERS}|\\d+)\\s+(?:hour|minute|min|step|rep)s?\\s+(?:of\\s+)?[^.;!?]{0,48})`,
  "gi"
);

const HOUR_OF_RE =
  /\b(?:(?:one|another|that|the|\d+)\s+hour\s+of\s+[^.;!?]{4,48})/gi;

const BEHAVIOR_GOAL_RE =
  /\b(?:get out of bed|wake up?)\s+without\s+snooz[^.;!?]{0,24}/gi;

const MINUTES_EVERY_RE =
  /\b(?:(?:\d+|ten|five|fifteen|twenty|thirty)\s+minutes?\s+(?:every\s+)?[^.;!?]{4,40})/gi;

const TIMER_SOUND_RE =
  /\b(?:timer\s+(?:or|and)\s+gentle\s+sound|gentle\s+sound\s+(?:or|and)\s+timer)\b/gi;

const ANOTHER_HOUR_FOCUSED_RE = /\banother hour.{0,12}focused work\b/gi;

const ADVICE_TOOL_RE =
  /\b(?:timer|gentle\s+sound|soft\s+sound|pomodoro|alarm|reminder)\b/gi;

const GOAL_TOKEN_STOP = new Set([
  "hour",
  "hours",
  "minute",
  "minutes",
  "today",
  "your",
  "with",
  "that",
  "this",
  "from",
  "have",
  "will",
  "about",
  "just",
  "keep",
  "time",
  "daily",
]);

function normPhrase(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function clipPhrase(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= MAX_PHRASE_CHARS) return t;
  return `${t.slice(0, MAX_PHRASE_CHARS - 1)}…`;
}

function goalTokens(goal?: BriefFreshnessGoalContext): string[] {
  const text = `${goal?.effectiveAsk ?? ""} ${goal?.behaviorStatement ?? ""}`.toLowerCase();
  const words = text.match(/\b[a-z]{4,}\b/g) ?? [];
  return [...new Set(words.filter((w) => !GOAL_TOKEN_STOP.has(w)))];
}

function phraseRankScore(phrase: string, goal?: BriefFreshnessGoalContext, kind: "cta" | "advice" = "cta"): number {
  const np = normPhrase(phrase);
  let score = kind === "cta" ? 2 : 0;
  for (const token of goalTokens(goal)) {
    if (np.includes(token)) score += 3;
  }
  if (/\b(?:that|the)\s+hour\s+of\b/.test(np)) score += 5;
  if (/\bhour\s+of\b/.test(np)) score += 3;
  if (/\b(?:one|another|\d+)\s+hour\b/.test(np)) score += 2;
  if (/\b(?:five|ten|fifteen|twenty|thirty|\d+)\s+minutes?\b/.test(np)) score += 2;
  if (/\bwithout\s+snooz/.test(np)) score += 4;
  if (/\bmaintaining\b|\bconcentration\b/.test(np) && !/\bhour\b|\bminute\b|\bdistribution\b/.test(np)) {
    score -= 3;
  }
  return score;
}

function pushUnique(
  out: DailyFreshMovePhrase[],
  seen: Set<string>,
  phrase: string,
  body: RecentCoachBodyDoNotRepeat
): void {
  const clipped = clipPhrase(phrase);
  if (clipped.length < MIN_PHRASE_CHARS) return;
  const key = normPhrase(clipped);
  if (seen.has(key)) return;
  seen.add(key);
  out.push({
    phrase: clipped,
    source_body_preview: body.body_preview,
    at_local: body.at_local,
  });
}

function extractPhrasesFromCoachBody(body: RecentCoachBodyDoNotRepeat): {
  cta: string[];
  advice: string[];
} {
  const text = body.body?.trim() || body.body_preview?.trim() || "";
  if (!text) return { cta: [], advice: [] };

  const cta: string[] = [];
  const advice: string[] = [];

  for (const re of [CTA_LEAD_RE, DURATION_CTA_RE, HOUR_OF_RE, MINUTES_EVERY_RE, BEHAVIOR_GOAL_RE, ANOTHER_HOUR_FOCUSED_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const raw = (m[1] ?? m[0])?.trim();
      if (raw) cta.push(raw);
    }
  }

  TIMER_SOUND_RE.lastIndex = 0;
  let tm: RegExpExecArray | null;
  while ((tm = TIMER_SOUND_RE.exec(text)) !== null) {
    advice.push(tm[0].trim());
  }

  ADVICE_TOOL_RE.lastIndex = 0;
  let am: RegExpExecArray | null;
  while ((am = ADVICE_TOOL_RE.exec(text)) !== null) {
    advice.push(am[0].trim());
  }

  return { cta, advice };
}

export function deriveDailyFreshMoveFacts(
  coachBodies: RecentCoachBodyDoNotRepeat[] | null | undefined,
  goal?: BriefFreshnessGoalContext
): DailyFreshMoveFacts {
  const bodies = (coachBodies ?? []).slice(-BRIEF_FRESHNESS_BODY_WINDOW);
  const ctaOut: DailyFreshMovePhrase[] = [];
  const adviceOut: DailyFreshMovePhrase[] = [];
  const ctaSeen = new Set<string>();
  const adviceSeen = new Set<string>();

  for (const body of bodies) {
    const { cta, advice } = extractPhrasesFromCoachBody(body);
    for (const p of cta) pushUnique(ctaOut, ctaSeen, p, body);
    for (const p of advice) pushUnique(adviceOut, adviceSeen, p, body);
  }

  const rank = (items: DailyFreshMovePhrase[], kind: "cta" | "advice") =>
    [...items].sort((a, b) => phraseRankScore(b.phrase, goal, kind) - phraseRankScore(a.phrase, goal, kind));

  return {
    recent_cta_do_not_repeat: rank(ctaOut, "cta").slice(0, MAX_PHRASES),
    recent_advice_do_not_repeat: rank(adviceOut, "advice").slice(0, MAX_PHRASES),
    fresh_move_required: ctaOut.length > 0 || adviceOut.length > 0,
  };
}

export function buildDailyFreshMovePromptBlock(fresh: DailyFreshMoveFacts): string {
  if (!fresh.fresh_move_required) return "";
  const lines = [
    "",
    "DAILY FRESH MOVE — do not repeat recent CTA/advice from prior coach SMS:",
    `- fresh_move_required: ${fresh.fresh_move_required}`,
  ];
  for (const item of fresh.recent_cta_do_not_repeat) {
    const when = item.at_local?.trim() ? `[${item.at_local}] ` : "";
    lines.push(`- recent_cta_do_not_repeat ${when}"${item.phrase}" (from: "${item.source_body_preview}")`);
  }
  for (const item of fresh.recent_advice_do_not_repeat) {
    const when = item.at_local?.trim() ? `[${item.at_local}] ` : "";
    lines.push(`- recent_advice_do_not_repeat ${when}"${item.phrase}" (from: "${item.source_body_preview}")`);
  }
  lines.push(
    "- If the goal is the same, choose a different honest move or a more specific next step — do not reuse these CTAs/tools."
  );
  return lines.join("\n");
}

export type DailyRepeatedCtaViolation = {
  blocked: true;
  phrase: string;
  kind: "cta" | "advice";
  prior_coach_body_preview: string;
};

function ctaMatchPhrases(phrase: string): string[] {
  const np = normPhrase(phrase);
  const out = [np];
  const hourOf = np.match(/(?:(?:one|another|that|the|\d+)\s+hour\s+of\s+[a-z][a-z\s]{2,32})/);
  if (hourOf?.[0]) out.push(hourOf[0].trim());
  const bareHourOf = np.match(/\bhour\s+of\s+[a-z][a-z\s]{2,32}/);
  if (bareHourOf?.[0]) out.push(bareHourOf[0].trim());
  const trimmed = np.split(/\s+today\s+|\s+to\s+keep\s+|\s+before\s+/)[0]?.trim();
  if (trimmed && trimmed !== np) out.push(trimmed);
  return [...new Set(out.filter((p) => p.length >= MIN_PHRASE_CHARS))];
}

export function detectDailyRepeatedCtaViolation(args: {
  body: string;
  freshMove: DailyFreshMoveFacts | null | undefined;
  /** When true, same CTA may repeat (e.g. fresh proof today). */
  newProofAllowsSameCta?: boolean;
}): DailyRepeatedCtaViolation | null {
  if (args.newProofAllowsSameCta === true) return null;
  const fresh = args.freshMove;
  if (!fresh?.fresh_move_required) return null;
  const normBody = normPhrase(args.body);
  if (!normBody) return null;

  const checkList = [
    ...fresh.recent_cta_do_not_repeat.map((x) => ({ ...x, kind: "cta" as const })),
    ...fresh.recent_advice_do_not_repeat.map((x) => ({ ...x, kind: "advice" as const })),
  ];

  for (const item of checkList) {
    const variants =
      item.kind === "cta"
        ? ctaMatchPhrases(item.phrase)
        : [normPhrase(item.phrase)];
    for (const np of variants) {
      if (np.length >= MIN_PHRASE_CHARS && normBody.includes(np)) {
        return {
          blocked: true,
          phrase: item.phrase,
          kind: item.kind,
          prior_coach_body_preview: item.source_body_preview,
        };
      }
    }
    if (item.kind === "advice") {
      const np = normPhrase(item.phrase);
      const core = np.split(/\s+to\s+|\s+when\s+|\s+before\s+/)[0]?.trim() ?? np;
      if (core.length >= MIN_PHRASE_CHARS && normBody.includes(core)) {
        return {
          blocked: true,
          phrase: item.phrase,
          kind: item.kind,
          prior_coach_body_preview: item.source_body_preview,
        };
      }
    }
  }
  return null;
}

export function dailyFreshMoveTelemetry(
  fresh: DailyFreshMoveFacts,
  violation: DailyRepeatedCtaViolation | null
): Record<string, unknown> {
  return {
    daily_fresh_move_required: fresh.fresh_move_required,
    daily_recent_cta_count: fresh.recent_cta_do_not_repeat.length,
    daily_recent_advice_count: fresh.recent_advice_do_not_repeat.length,
    ...(violation
      ? {
          daily_repeated_cta_detected: true,
          repeated_cta_phrase: violation.phrase,
          repeated_cta_kind: violation.kind,
          prior_coach_body_preview: violation.prior_coach_body_preview,
          daily_fresh_move_guard_blocked: true,
        }
      : {}),
  };
}

export const BRIEF_FRESHNESS_MAX_PHRASES = 3;

export type BriefFreshnessAvoidPhrase = {
  phrase: string;
  at_local: string | null;
};

/** Compact freshness for DailySmsWritingBriefV1 (max 3 phrases, goal-ranked). */
export function deriveFreshnessAvoidPhrasesForBrief(
  coachBodies: RecentCoachBodyDoNotRepeat[] | null | undefined,
  goal?: BriefFreshnessGoalContext
): BriefFreshnessAvoidPhrase[] {
  const fresh = deriveDailyFreshMoveFacts(coachBodies, goal);
  const merged: Array<DailyFreshMovePhrase & { kind: "cta" | "advice" }> = [
    ...fresh.recent_cta_do_not_repeat.map((p) => ({ ...p, kind: "cta" as const })),
    ...fresh.recent_advice_do_not_repeat.map((p) => ({ ...p, kind: "advice" as const })),
  ];
  merged.sort(
    (a, b) => phraseRankScore(b.phrase, goal, b.kind) - phraseRankScore(a.phrase, goal, a.kind)
  );

  const seen = new Set<string>();
  const out: BriefFreshnessAvoidPhrase[] = [];
  for (const item of merged) {
    const key = normPhrase(item.phrase);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ phrase: item.phrase, at_local: item.at_local });
    if (out.length >= BRIEF_FRESHNESS_MAX_PHRASES) break;
  }
  return out;
}

export function dailyWritingBriefFreshnessTelemetry(
  phrases: BriefFreshnessAvoidPhrase[]
): Record<string, unknown> {
  return { daily_freshness_avoid_count: phrases.length };
}
