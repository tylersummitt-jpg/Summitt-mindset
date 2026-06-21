/**
 * Daily fresh-move / CTA do-not-repeat — derived from recent 72h coach bodies (no OpenAI).
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

const MIN_PHRASE_CHARS = 12;
const MAX_PHRASE_CHARS = 72;
const MAX_PHRASES = 8;

const CTA_LEAD_RE =
  /\b(?:aim for|focus on|try to|try using|use a|use the|consider|protect the|start with|set a|get in|block out|schedule|spend|give yourself|take)\s+([^.;!?]{8,60})/gi;

const DURATION_CTA_RE =
  /\b(?:(?:one|another|two|three|\d+)\s+(?:hour|minute|min|step|rep)s?\s+(?:of\s+)?[^.;!?]{0,48})/gi;

const HOUR_OF_RE = /\b(?:one|another|\d+)\s+hour\s+of\s+[^.;!?]{4,48}/gi;

const ADVICE_TOOL_RE =
  /\b(?:timer(?:\s+(?:or|and)\s+gentle\s+sound)?|gentle\s+sound|soft\s+sound|pomodoro|alarm|reminder)\b/gi;

function normPhrase(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function clipPhrase(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= MAX_PHRASE_CHARS) return t;
  return `${t.slice(0, MAX_PHRASE_CHARS - 1)}…`;
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

  for (const re of [CTA_LEAD_RE, DURATION_CTA_RE, HOUR_OF_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const raw = (m[1] ?? m[0])?.trim();
      if (raw) cta.push(raw);
    }
  }

  ADVICE_TOOL_RE.lastIndex = 0;
  let am: RegExpExecArray | null;
  while ((am = ADVICE_TOOL_RE.exec(text)) !== null) {
    advice.push(am[0].trim());
  }

  return { cta, advice };
}

export function deriveDailyFreshMoveFacts(
  coachBodies: RecentCoachBodyDoNotRepeat[] | null | undefined
): DailyFreshMoveFacts {
  const bodies = (coachBodies ?? []).slice(-6);
  const ctaOut: DailyFreshMovePhrase[] = [];
  const adviceOut: DailyFreshMovePhrase[] = [];
  const ctaSeen = new Set<string>();
  const adviceSeen = new Set<string>();

  for (const body of bodies) {
    const { cta, advice } = extractPhrasesFromCoachBody(body);
    for (const p of cta) pushUnique(ctaOut, ctaSeen, p, body);
    for (const p of advice) pushUnique(adviceOut, adviceSeen, p, body);
  }

  return {
    recent_cta_do_not_repeat: ctaOut.slice(0, MAX_PHRASES),
    recent_advice_do_not_repeat: adviceOut.slice(0, MAX_PHRASES),
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
  const hourOf = np.match(/(?:one|another|\d+)\s+hour\s+of\s+[a-z][a-z\s]{2,32}/);
  if (hourOf?.[0]) out.push(hourOf[0].trim());
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

/** Compact freshness for DailySmsWritingBriefV1 (max 3 phrases from 7d coach bodies). */
export function deriveFreshnessAvoidPhrasesForBrief(
  coachBodies: RecentCoachBodyDoNotRepeat[] | null | undefined
): BriefFreshnessAvoidPhrase[] {
  const fresh = deriveDailyFreshMoveFacts(coachBodies);
  const merged: DailyFreshMovePhrase[] = [];
  const seen = new Set<string>();
  const candidates = [
    ...fresh.recent_cta_do_not_repeat,
    ...fresh.recent_advice_do_not_repeat,
  ].reverse();
  for (const item of candidates) {
    const key = normPhrase(item.phrase);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
    if (merged.length >= BRIEF_FRESHNESS_MAX_PHRASES) break;
  }
  return merged.map((i) => ({ phrase: i.phrase, at_local: i.at_local }));
}

export function dailyWritingBriefFreshnessTelemetry(
  phrases: BriefFreshnessAvoidPhrase[]
): Record<string, unknown> {
  return { daily_freshness_avoid_count: phrases.length };
}
