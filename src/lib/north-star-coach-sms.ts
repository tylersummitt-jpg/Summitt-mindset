/**
 * North Star SMS gate — single deterministic layer before user-visible coaching/accountability SMS.
 * Accountability spine decides events; this layer only shapes wording (no OpenAI by default).
 */

import { inboundDefersTodayForTomorrow } from "@/lib/v3-sms-turn";

export const NORTH_STAR_SMS_MAX_LEN = 300;
/** Weekly Pat Pause + proof packs can exceed one GSM segment; carriers concatenate segments. */
export const NORTH_STAR_SMS_LONG_FORM_MAX_LEN = 2000;

export type NorthStarCoachChannel =
  | "inbound_coach_reply"
  | "daily_outbound"
  | "contract_prompt"
  | "contract_ack"
  | "refresh"
  | "pending_resolution"
  | "reactivation"
  | "blocker_followup"
  | "clarification"
  | "central_brain_pivot"
  | "weekly_sms"
  | "followup_sms"
  | "missed_yesterday_sms"
  | "inactivity_rescue"
  | "post_churn_winback"
  | "lifecycle_sms"
  | "guided_contract_proposal"
  /** Reserved for future Day 4–5 pulse outbound if enabled (currently log-only cron). */
  | "day4_5_sms_pulse"
  | "other_coaching";

export type NorthStarCoachSmsMeta = {
  source:
    | "approved"
    | "rewritten"
    | "deterministic_minimal"
    | "openai_finalized"
    | "openai_failed_deterministic_fallback";
  blockedReasons: string[];
  originalBody?: string;
  /** Phase 3 — set when async finalizer runs (success or fallback). */
  openaiAttempted?: boolean;
  openaiFailedReason?: string | null;
  contextPacketUsed?: boolean;
  finalizerVersion?: string;
  north_star_openai_model?: string | null;
  /** Full-body structural guard replaced proposed coaching (temporal / completion mismatch). */
  north_star_structural_replacement?: boolean;
  /** Proposed reply substantially repeated the latest coach question after the user answered. */
  repeated_question_guard_fired?: boolean;
  repeated_question_original?: string;
  repeated_question_replacement?: string;
};

/**
 * Conversation-aware inputs for Phase 2 North Star (deterministic merge + guards).
 * Populated from the SMS conversation context pack and spine-adjacent rows at send time.
 */
export type NorthStarSmsContextPacket = {
  activeCommitmentId?: string | null;
  behaviorStatement?: string | null;
  effectiveAskText?: string | null;

  latestInboundRaw?: string | null;
  latestOutboundBody?: string | null;
  latestOpenQuestion?: string | null;
  expectedReplySemantics?: string | null;

  recentTranscriptLines?: string[];
  recentTranscriptSnippet?: string | null;

  todayCompleted?: boolean;
  latestOutcomeType?: string | null;
  finalEventType?: string | null;

  futureIntentHint?: "today" | "tomorrow" | "future" | "stretch" | "durable_change" | "unknown" | null;
  proofSignal?: boolean;
  missSignal?: boolean;
  blockerSignal?: boolean;

  latestBlockerPreview?: string | null;
  coachingSummary?: string | null;
  relationshipProfileSummary?: string | null;

  identityAnchorText?: string | null;
  peopleSummary?: string | null;
  lifeDesires?: string | null;
  pressureSummary?: string | null;

  source?: string | null;
  debug?: Record<string, unknown>;
  /** V3 SMS Brain — inbound routed as answer to latest open coach question. */
  v3AnswerToOpenQuestion?: boolean;
  v3TurnSubkind?: string | null;
};

export type NorthStarCoachSmsArgs = {
  proposedBody: string;
  channel: NorthStarCoachChannel;
  latestInboundRaw?: string | null;
  latestOutboundBody?: string | null;
  behaviorStatement?: string | null;
  effectiveAskText?: string | null;
  eventType?: string | null;
  finalEventType?: string | null;
  decisionReason?: string | null;
  replySource?: string | null;
  promptKind?: string | null;
  alreadyCompletedToday?: boolean;
  recentTranscriptSnippet?: string | null;
  /** Phase 2 — merged with scalar args (explicit args win on duplicates). */
  contextPacket?: NorthStarSmsContextPacket;
  metadata?: Record<string, unknown>;
  /** When true, allow app navigation lines (subscription/settings). */
  userAskedAboutAppNavigation?: boolean;
  /** Default {@link NORTH_STAR_SMS_MAX_LEN}; use {@link NORTH_STAR_SMS_LONG_FORM_MAX_LEN} for weekly / long-form. */
  maxLen?: number;
  /** Keep paragraph breaks (weekly reflection, winback link SMS). */
  preserveNewlines?: boolean;
};

export type NorthStarCoachSmsResult = {
  visibleBody: string;
  meta: NorthStarCoachSmsMeta;
};

function norm(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function clip(s: string, max = NORTH_STAR_SMS_MAX_LEN): string {
  const t = norm(s);
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

/** Single-line / standard SMS clip uses collapsed whitespace. */
function clipPreserveParagraphs(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

/** After scrub steps: collapse whitespace, optionally keep newlines between paragraphs. */
function finalizeTextShape(s: string, preserveNewlines: boolean): string {
  if (!preserveNewlines) return norm(s);
  return s
    .trim()
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((ln) => ln.trim().replace(/\s+/g, " "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function inboundSignalsCompletion(raw: string | null | undefined): boolean {
  const t = (raw ?? "").toLowerCase();
  return /\b(done|got it done|got it|completed|finished|yes|proof|nailed it|crushed it|protected|focused)\b/.test(
    t
  );
}

function outboundSignalsProofAck(body: string | null | undefined): boolean {
  const t = (body ?? "").toLowerCase();
  return (
    /logged as done/.test(t) ||
    /that'?s proof/.test(t) ||
    /got the bar done/.test(t) ||
    /comeback is going in your proof/.test(t) ||
    /counting .*done/.test(t) ||
    /marking .*done/.test(t)
  );
}

export function signalsTomorrowPlanning(text: string | null | undefined): boolean {
  const t = (text ?? "").toLowerCase();
  return /\b(tomorrow|next week)\b/.test(t) ||
    /\b(i'?m going to|i am going to|going to|i'?ll|planning for|plan for tomorrow)\b/.test(t) ||
    /\b(increase the goal|raise the goal|two hours|2 hours|three hours|3 hours|\d+\s*hours)\b/.test(t) ||
    /\bmake it\b/.test(t);
}

function outboundAsksTomorrowPlan(out: string | null | undefined): boolean {
  const o = out ?? "";
  return /\btomorrow\b/i.test(o) && /\?/.test(o);
}

/** User explicitly asking about today (weak heuristic — avoids suppressing legitimate today asks). */
function inboundExplicitlyAboutToday(raw: string | null | undefined): boolean {
  const t = (raw ?? "").toLowerCase();
  return /\b(today|this morning|tonight|just now|earlier today)\b/.test(t) && !signalsTomorrowPlanning(raw);
}

export type NorthStarFutureIntentHint =
  | "today"
  | "tomorrow"
  | "future"
  | "stretch"
  | "durable_change"
  | "unknown";

/**
 * Cheap intent bucket for structural guards (deterministic; no LLM).
 */
export function deriveFutureIntentHint(raw: string | null | undefined): NorthStarFutureIntentHint | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  if (inboundExplicitlyAboutToday(raw)) return "today";
  if (/\b(next week|next month|later this week)\b/i.test(t)) return "future";
  if (/\b(forever|from now on|new normal|baseline)\b/i.test(t)) return "durable_change";
  if (/\b(increase|raise|lower|change)\s+(the\s+)?(goal|bar|commitment|hours|line)\b/i.test(t)) return "stretch";
  if (signalsTomorrowPlanning(raw)) return "tomorrow";
  return "unknown";
}

type MergedNorthStarFields = {
  inbound: string;
  outbound: string;
  openQuestion: string;
  effectiveAsk: string;
  behavior: string;
};

function mergeNorthStarFields(args: NorthStarCoachSmsArgs): MergedNorthStarFields {
  const pkt = args.contextPacket;
  return {
    inbound: (args.latestInboundRaw ?? pkt?.latestInboundRaw ?? "").trim(),
    outbound: (args.latestOutboundBody ?? pkt?.latestOutboundBody ?? "").trim(),
    openQuestion: (pkt?.latestOpenQuestion ?? "").trim(),
    effectiveAsk: (args.effectiveAskText ?? pkt?.effectiveAskText ?? "").trim(),
    behavior: (args.behaviorStatement ?? pkt?.behaviorStatement ?? "").trim(),
  };
}

function outboundForGuards(m: MergedNorthStarFields): string {
  const primary = m.outbound || m.openQuestion;
  return primary.trim();
}

export function asksTodayCompletionQuestion(body: string): boolean {
  const t = body.toLowerCase();
  if (/what'?s your plan for today/i.test(t)) return true;
  if (/focus on (the commitment|today)/i.test(t)) return true;
  if (/for today, aim/i.test(t)) return true;
  if (/did you complete the hour today/i.test(t)) return true;
  if (/did you spend the hour today/i.test(t)) return true;
  if (/did you complete.{0,80}(today|hour)/i.test(body)) return true;
  if (/did you get that done/i.test(t)) return true;
  if (/did you get a chance/i.test(t)) return true;
  if (/did you manage/i.test(t) && /\btoday\b/.test(t)) return true;
  if (/did it happen\?/i.test(t) && /\btoday\b/.test(t)) return true;
  if (/did you do.{0,40}today/i.test(t)) return true;
  if (/smallest\s+honest\s+next\s+step/i.test(t) && /\btoday\b/i.test(t)) return true;
  if (/10\s*minutes\s+or\s+less/i.test(t)) return true;
  if (/\bstill\s+do\s+today\b/i.test(t)) return true;
  return false;
}

function extractHourMention(inbound: string): string | null {
  const m = inbound.match(/\b(\d+)\s*(hours?|hrs?|hr)\b/i);
  if (m) return `${m[1]} hour${m[1] === "1" ? "" : "s"}`;
  const m2 = inbound.match(/\b(one|two|three|four|\d+)\s+hours?\b/i);
  if (m2) return m2[0] ?? null;
  return null;
}

function pickTomorrowContinuation(inbound: string): string {
  const hm = extractHourMention(inbound);
  if (hm) {
    return `Good. Tomorrow is the target — ${hm}. What exact block are you protecting, and what time does it start?`;
  }
  return "Good. Tomorrow is the target. What exact block are you protecting — what time does it start?";
}

function pickCompletionContinuation(seed: string): string {
  const lines = [
    "Today is handled. What made the rep possible?",
    "That's proof. Don't waste the win — what's tomorrow's first protected block?",
    "That counts. You did the rep. What time does tomorrow's block start?",
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h + seed.charCodeAt(i)) % 997;
  return lines[h % lines.length]!;
}

function normalizeForQuestionOverlap(s: string): string {
  return norm(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function substantiallySameCoachQuestion(proposedBody: string, coachLine: string): boolean {
  const p = normalizeForQuestionOverlap(proposedBody);
  const c = normalizeForQuestionOverlap(coachLine);
  if (c.length < 22 || p.length < 14) return false;
  const cWords = c.split(" ").filter((w) => w.length > 3);
  const pWords = new Set(p.split(" ").filter((w) => w.length > 3));
  let overlap = 0;
  for (const w of cWords) if (pWords.has(w)) overlap++;
  const ratio = cWords.length ? overlap / cWords.length : 0;
  if (ratio >= 0.48 && /\?/.test(coachLine) && /\?/.test(proposedBody)) return true;
  if (p.includes(c.slice(0, Math.min(72, c.length)))) return true;
  return false;
}

function proposedRepeatsLatestCoachAsk(
  proposed: string,
  merged: MergedNorthStarFields,
  pkt: NorthStarSmsContextPacket | undefined
): boolean {
  const inbound = merged.inbound.trim();
  if (inbound.length < 2) return false;
  const targets: string[] = [];
  const outbound = outboundForGuards(merged);
  if (outbound.length > 18) targets.push(outbound);
  const lo = pkt?.latestOpenQuestion?.trim();
  if (lo && lo.length > 12 && norm(lo) !== norm(outbound)) targets.push(lo);

  for (const t of targets) {
    if (substantiallySameCoachQuestion(proposed, t)) return true;
  }
  return false;
}

function pickSafeNonRepeatReplacement(merged: MergedNorthStarFields): string {
  const inbound = merged.inbound;
  if (inboundDefersTodayForTomorrow(inbound)) {
    return pickTomorrowContinuation(inbound);
  }
  const hm = extractHourMention(inbound);
  if (hm && /\b(am|pm|morning|evening|:)\b/i.test(inbound)) {
    return `Locked — ${hm} it is. Nothing fancy — just execute.`;
  }
  if (
    inbound.trim().length > 14 &&
    !/^(yes|no|yep|nope)\b/i.test(inbound.trim()) &&
    inbound.split(/\s+/).filter(Boolean).length >= 2 &&
    !/\?/.test(inbound)
  ) {
    const snippet = inbound.trim().slice(0, 52);
    return `Got it — "${snippet}${inbound.trim().length > 52 ? "…" : ""}" — what's the next concrete move?`;
  }
  const lines = [
    "Got it. I'm not going to ask the same thing again. What should I hold you to next?",
    "Fair. Then tomorrow needs to be concrete. What time are you protecting?",
    "That answers it. What's the next concrete move?",
  ];
  let h = 0;
  for (let i = 0; i < inbound.length; i++) h = (h * 31 + inbound.charCodeAt(i)) >>> 0;
  return lines[h % lines.length]!;
}

function applyRepeatedQuestionKillSwitch(
  args: NorthStarCoachSmsArgs,
  proposed: string,
  merged: MergedNorthStarFields
): { replacement: string | null; original?: string } {
  const ch = args.channel;
  if (
    ch !== "inbound_coach_reply" &&
    ch !== "blocker_followup" &&
    ch !== "central_brain_pivot" &&
    ch !== "clarification"
  ) {
    return { replacement: null };
  }
  const pkt = args.contextPacket;
  if (!merged.inbound.trim()) return { replacement: null };
  if (!proposedRepeatsLatestCoachAsk(proposed, merged, pkt)) return { replacement: null };
  return {
    replacement: pickSafeNonRepeatReplacement(merged),
    original: proposed,
  };
}

function scrubRobotMotivation(s: string, preserveNl: boolean): { text: string; hits: string[] } {
  const hits: string[] = [];
  let t = s;
  const pairs: Array<[RegExp, string]> = [
    [/yes\s*,\s*no\s*,\s*or\s*partial[^.!?]*[.!?]?/gi, ""],
    [/reply\s+yes\s*,\s*no[^.!?]*[.!?]?/gi, ""],
    [/say\s+yes\s+or\s+no[^.!?]*[.!?]?/gi, ""],
    [/great\s+job[!.,]?/gi, "Good"],
    [/great\s+work[!.,]?/gi, "Good"],
    [/great\s+to\s+hear[^.!?]*[.!?]/gi, ""],
    [/keep\s+this\s+momentum[^.!?]*[.!?]?/gi, ""],
    [/keep\s+momentum[^.!?]*[.!?]?/gi, ""],
    [/keep\s+pushing[^.!?]*[.!?]?/gi, ""],
    [/you'?ve\s+got\s+this[^.!?]*[.!?]?/gi, ""],
    [/let'?s\s+keep\s+moving\s+forward[^.!?]*[.!?]?/gi, ""],
    [/staying\s+focused\s+is\s+crucial\s+for\s+your\s+progress[^.!?]*[.!?]?/gi, ""],
    [/good\s+to\s+see\s+you\s+(here|back)[^.!?]*[.!?]?/gi, ""],
  ];
  for (const [re, rep] of pairs) {
    if (re.test(t)) hits.push(re.source.slice(0, 40));
    t = t.replace(re, rep);
  }
  return { text: finalizeTextShape(t, preserveNl), hits };
}

function scrubCheckInWorkflow(
  s: string,
  channel: NorthStarCoachChannel,
  preserveNl: boolean
): { text: string; hits: string[] } {
  const hits: string[] = [];
  let t = s;
  const dailyish =
    channel === "daily_outbound" || channel === "reactivation" || channel === "weekly_sms";

  const replacements: Array<[RegExp, string]> = [
    [/today'?s\s+check-?\s*in:?\s*/gi, ""],
    [/quick\s+check:?\s*/gi, ""],
    [/did\s+you\s+get\s+a\s+chance[^.!?]*\?/gi, dailyish ? "Did you protect the rep today?" : "Did you do it?"],
    [/first\s+week\s+of\s+your\s+commitment[^.!?]*[.!?]?/gi, ""],
    [/daily\s+check-?\s*ins?[^.!?]*[.!?]?/gi, ""],
  ];
  for (const [re, rep] of replacements) {
    if (re.test(t)) hits.push(re.source.slice(0, 35));
    t = t.replace(re, rep);
  }
  return { text: finalizeTextShape(t, preserveNl), hits };
}

/** Collapse generic “how did your X go / did you manage to carve…” daily essay into one direct ask. */
function scrubDailyOutboundEssayAndManage(
  s: string,
  channel: NorthStarCoachChannel,
  mergedAsk: string,
  preserveNl: boolean
): { text: string; hits: string[] } {
  if (channel !== "daily_outbound" && channel !== "reactivation") {
    return { text: s, hits: [] };
  }
  const hits: string[] = [];
  let t = s.trim();
  const core = mergedAsk.trim().slice(0, 72).replace(/\s+/g, " ").trim() || "the rep";

  if (/\bhow did your\b/i.test(t) && /\bdid you manage\b/i.test(t)) {
    hits.push("daily_double_question_essay_scrub");
    t = `Did you protect ${core} today?`;
  } else if (/\bhow did your\s+[^.!?]{6,100}\s+go\s+today\b/i.test(t)) {
    hits.push("daily_how_did_focus_go_scrub");
    t = t.replace(/\b[^.!?]{0,120}?how did your\s+[^.!?]{6,100}\s+go\s+today\?\s*/i, "").trim();
    if (!/\?/.test(t)) {
      t = `${t.length ? `${t} ` : ""}Did you protect ${core} today?`.trim();
    }
  } else if (/\bdid you manage to\s+carve\s+out\b/i.test(t)) {
    hits.push("did_you_manage_carve_scrub");
    t = t.replace(/\bdid you manage to\s+carve\s+out[^.!?]*\?/gi, `Did it happen today?`);
  } else if (/\bdid you manage to\b/i.test(t)) {
    hits.push("did_you_manage_scrub");
    t = t.replace(/\bdid you manage to[^.!?]+\?/gi, `Did it happen with ${core}?`);
  }

  return { text: finalizeTextShape(t, preserveNl), hits };
}

function scrubWrongTemporal(s: string, preserveNl: boolean): { text: string; hits: string[] } {
  const hits: string[] = [];
  let t = s;
  const pairs: Array<[RegExp, string]> = [
    [/focus\s+on\s+the\s+commitment\s+first[^.!?]*[.!?]?/gi, ""],
    [/for\s+today,\s+aim[^.!?]*[.!?]?/gi, ""],
    [/build\s+from\s+there[^.!?]*[.!?]?/gi, ""],
    [/ambitious\s+goal[^.!?]*[.!?]?/gi, ""],
  ];
  for (const [re, rep] of pairs) {
    if (re.test(t)) hits.push(re.source.slice(0, 35));
    t = t.replace(re, rep);
  }
  return { text: finalizeTextShape(t, preserveNl), hits };
}

function scrubProductJargon(s: string, preserveNl: boolean): { text: string; hits: string[] } {
  const hits: string[] = [];
  let t = s;
  const pairs: Array<[RegExp, string]> = [
    [/\brecommit\s+to\s+this\s+bar\b/gi, "stay in on this line"],
    [/\brecommit\s+to\s+this\b/gi, "stay in on this"],
    [/\brecommit\s+to\s+this\s+for\s+7\s+days\b/gi, "keep this steady for the next week"],
    [/\bsame\s+commitment\b/gi, "same focus"],
    [/\bsame\s+bar\b/gi, "same line"],
    [/\bcurrent\s+bar\b/gi, "the line"],
    [/\bactive\s+for\s+7\s+days\b/gi, "for the next week"],
    [/\bsmaller\s+window\b/gi, "shorter window"],
    [/\bpending\s+resolution\b/gi, "open loop"],
    [/\badaptive\s+overlay\b/gi, "temporary stretch"],
    [/\boverlay\s+proposal\b/gi, "stretch offer"],
    [/\bproposal_yes_no\b/gi, "yes or no"],
    [/\bcontract\s+proposal\b/gi, "stretch offer"],
    [/\bV2\b/g, ""],
    [/\bevent\s+spine\b/gi, ""],
    [/\bcommitment\s+event\b/gi, ""],
    [/\baccountability\s+system\b/gi, ""],
    [/coach\s+pat\s+is\s+currently[^.!?]*[.!?]?/gi, ""],
    [/stay\s+on\s+track[^.!?]*[.!?]?/gi, ""],
  ];
  for (const [re, rep] of pairs) {
    if (re.test(t)) hits.push(re.source.slice(0, 30));
    t = t.replace(re, rep);
  }
  return { text: finalizeTextShape(t, preserveNl), hits };
}

function scrubAppDeflection(s: string, allow: boolean, preserveNl: boolean): { text: string; hits: string[] } {
  if (allow) return { text: finalizeTextShape(s, preserveNl), hits: [] };
  const hits: string[] = [];
  let t = s;
  const pairs: Array<[RegExp, string]> = [
    [/check\s+the\s+app[^.!?]*[.!?]?/gi, ""],
    [/open\s+the\s+app[^.!?]*[.!?]?/gi, ""],
    [/use\s+the\s+app[^.!?]*[.!?]?/gi, ""],
    [/if\s+you\s+need\s+to\s+adjust\s+your\s+plan[^.!?]*[.!?]?/gi, ""],
    [/in\s+the\s+app\s+for\s+updates[^.!?]*[.!?]?/gi, ""],
  ];
  for (const [re, rep] of pairs) {
    if (re.test(t)) hits.push("app_deflection");
    t = t.replace(re, rep);
  }
  return { text: finalizeTextShape(t, preserveNl), hits };
}

function softenHeavyContractJargon(s: string, preserveNl: boolean): string {
  let t = s;
  t = t.replace(
    /\bcan we keep the same line steady for a week\??\s*recommit to this for 7 days[^.!?]*[.!?]?/gi,
    "Want to keep this plain for the next week — one honest rep a day? Tell me yes if that's the lock."
  );
  t = t.replace(/\brecommit to this for 7 days\b/gi, "keep this steady for the next week");
  t = t.replace(/\brecommit to this bar for 7 days\b/gi, "hold this line for the next week");
  return finalizeTextShape(t, preserveNl);
}

function scrubV3AnswerToOpenQuestionCopy(s: string, preserveNl: boolean): { text: string; hits: string[] } {
  const hits: string[] = [];
  let t = s;
  const pairs: Array<[RegExp, string]> = [
    [/did\s+you\s+manage\s+to\s+dictate[^.!?]*\??/gi, ""],
    [/dictate\s+a\s+story\s+today[^.!?]*\??/gi, ""],
    [/check\s+the\s+app[^.!?]*[.!?]?/gi, ""],
    [/let\s+me\s+know\s+how\s+it\s+went[^.!?]*[.!?]?/gi, ""],
    [/staying\s+consistent[^.!?]*[.!?]?/gi, ""],
    [/it'?s\s+important\s+to[^.!?]*[.!?]?/gi, ""],
    [/yes,\s*no,\s*or\s+partial[^.!?]*[.!?]?/gi, ""],
    [/reply\s+yes\s+or\s+no[^.!?]*[.!?]?/gi, ""],
    [/what\s+story\s+are\s+you\s+excited\s+to\s+dictate[^.!?]*\??/gi, ""],
  ];
  for (const [re, rep] of pairs) {
    if (re.test(t)) hits.push(re.source.slice(0, 36));
    t = t.replace(re, rep);
  }
  return { text: finalizeTextShape(t, preserveNl), hits };
}

/**
 * Full-body replacements — narrow temporal/accountability coherence only (deterministic).
 *
 * Triggers (returns replacement string | null):
 * 1) Open-question + todayCompleted + proposed asks today completion without user speaking “today” → short tomorrow-forward line.
 * 2) Completion/miss/proof context + user/plan points future/tomorrow + proposed re-asks “today” → tomorrow continuation or completion continuation.
 * 3) Proposed asks micro-step-today + user defers to tomorrow → {@link pickTomorrowContinuation}.
 * 4) Duplicate-normalized proposed vs outbound micro-step + deferring inbound → tomorrow continuation.
 *
 * Preserves user meaning where possible; overrides shallow OpenAI failures when state semantics contradict “today” asks.
 */
function applyStructuralGuards(
  args: NorthStarCoachSmsArgs,
  proposed: string,
  merged: MergedNorthStarFields
): string | null {
  const inbound = merged.inbound;
  const outbound = outboundForGuards(merged);
  const proposedNorm = norm(proposed);
  const pkt = args.contextPacket;

  if (
    pkt?.v3AnswerToOpenQuestion &&
    pkt.todayCompleted &&
    asksTodayCompletionQuestion(proposedNorm) &&
    !inboundExplicitlyAboutToday(inbound)
  ) {
    return `Good — locked for tomorrow. Keep the first rep ugly and fast.`;
  }

  const completionCtx =
    args.alreadyCompletedToday === true ||
    pkt?.todayCompleted === true ||
    args.finalEventType === "user_yes" ||
    args.eventType === "user_yes" ||
    inboundSignalsCompletion(inbound) ||
    outboundSignalsProofAck(outbound) ||
    outboundSignalsProofAck(proposedNorm);

  const hint = pkt?.futureIntentHint ?? deriveFutureIntentHint(inbound);
  const futureInbound =
    signalsTomorrowPlanning(inbound) ||
    hint === "tomorrow" ||
    hint === "stretch" ||
    hint === "future" ||
    hint === "durable_change" ||
    inboundDefersTodayForTomorrow(inbound);

  const tomorrowOutboundQ =
    outboundAsksTomorrowPlan(outbound) || outboundAsksTomorrowPlan(pkt?.latestOpenQuestion ?? "");
  const asksToday = asksTodayCompletionQuestion(proposedNorm);

  const asksMicroStepTodayInProposal =
    /\bsmallest\s+honest\s+next\s+step\b/i.test(proposedNorm) ||
    /\b10\s*minutes\s+or\s+less\b/i.test(proposedNorm);
  if (
    asksMicroStepTodayInProposal &&
    inboundDefersTodayForTomorrow(inbound) &&
    !inboundExplicitlyAboutToday(inbound)
  ) {
    return pickTomorrowContinuation(inbound);
  }

  const normalized = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 160);
  const outCore = normalized(outboundForGuards(merged));
  const propCore = normalized(proposedNorm);
  if (
    outCore.length > 35 &&
    propCore.length > 35 &&
    outCore === propCore &&
    asksMicroStepTodayInProposal &&
    inboundDefersTodayForTomorrow(inbound)
  ) {
    return pickTomorrowContinuation(inbound);
  }

  if (asksToday && (futureInbound || tomorrowOutboundQ) && !inboundExplicitlyAboutToday(inbound)) {
    return pickTomorrowContinuation(inbound);
  }

  if (asksToday && completionCtx && !inboundExplicitlyAboutToday(inbound)) {
    if (futureInbound) return pickTomorrowContinuation(inbound);
    return pickCompletionContinuation(proposedNorm + inbound);
  }

  return null;
}

function dailyOutboundFlavor(body: string, channel: NorthStarCoachChannel, mergedAsk: string): string {
  let t = body;
  const weeklyLike = channel === "weekly_sms" || channel === "lifecycle_sms";
  const ask = mergedAsk.trim();
  if ((channel === "daily_outbound" || channel === "reactivation") && (/^\s*$/i.test(t) || t.length < 12)) {
    if (ask.length >= 8 && ask.length <= 100) {
      const one = ask.slice(0, 72).replace(/\s+/g, " ").trim();
      return `Tell the truth first — ${one}. What actually happened with the rep today?`;
    }
    return "Tell the truth first: what happened with the rep today?";
  }
  if (weeklyLike && (/^\s*$/i.test(t) || t.length < 12)) {
    if (ask.length >= 8 && ask.length <= 120) {
      const one = ask.slice(0, 90).replace(/\s+/g, " ").trim();
      return `Pat Pause — ${one}. What's true about your week in one honest line?`;
    }
    return "Pat Pause: what's true about your week — one honest line?";
  }
  if (/quick check|today'?s check/i.test(t)) {
    t = t.replace(/quick check|today'?s check-?in/gi, "").trim();
    if (!t) {
      return weeklyLike
        ? "What's true about this week — wins and misses?"
        : "Today is simple — did you do the rep? Tell me straight.";
    }
  }
  return t;
}

/** Compact context for inbound coach routes (cron). */
export type NorthStarInboundCoachCtx = {
  userMessage: string;
  lastOutboundSmsPreview: string | null | undefined;
  effectiveBehavior: string;
  behaviorStatement: string;
  finalEventType?: string | null;
  replySource?: string | null;
  /** When known from spine/metadata (explicit proof ack for today). */
  alreadyCompletedToday?: boolean;
  /** Built from conversation pack + spine rows — Phase 2 continuity. */
  contextPacket?: NorthStarSmsContextPacket;
};

export function finalizeNorthStarInboundCoachReply(args: {
  proposedBody: string;
  ctx: NorthStarInboundCoachCtx;
  channel?: NorthStarCoachChannel;
}): NorthStarCoachSmsResult {
  const { ctx } = args;
  const pkt = ctx.contextPacket;
  const inferredDone =
    ctx.alreadyCompletedToday === true ||
    ctx.finalEventType === "user_yes" ||
    inboundSignalsCompletion(ctx.userMessage) ||
    pkt?.todayCompleted === true;

  return finalizeNorthStarCoachSms({
    proposedBody: args.proposedBody,
    channel: args.channel ?? "inbound_coach_reply",
    latestInboundRaw: ctx.userMessage,
    latestOutboundBody: ctx.lastOutboundSmsPreview ?? null,
    effectiveAskText: ctx.effectiveBehavior,
    behaviorStatement: ctx.behaviorStatement,
    finalEventType: ctx.finalEventType ?? undefined,
    replySource: ctx.replySource ?? undefined,
    alreadyCompletedToday: inferredDone,
    contextPacket: ctx.contextPacket,
  });
}

/**
 * Final visible SMS for coaching/accountability turns.
 * Deterministic Phase 2 — conversation-aware merge + phrase hygiene; no extra OpenAI calls.
 */
export function finalizeNorthStarCoachSms(args: NorthStarCoachSmsArgs): NorthStarCoachSmsResult {
  const mergedFields = mergeNorthStarFields(args);
  const mergedAsk = mergedFields.effectiveAsk || mergedFields.behavior;

  const preserveNl = args.preserveNewlines === true;
  const originalBody = preserveNl ? args.proposedBody.trim() : norm(args.proposedBody);
  const blockedReasons: string[] = [];
  let working = preserveNl ? finalizeTextShape(args.proposedBody, true) : norm(args.proposedBody);
  let source: NorthStarCoachSmsMeta["source"] = "approved";

  if (!working.trim()) {
    return {
      visibleBody: clip("Say it plain — what happened with the commitment today?"),
      meta: {
        source: "deterministic_minimal",
        blockedReasons: ["empty_proposed_body"],
        originalBody,
      },
    };
  }

  let northStarStructuralReplacement = false;
  const structural = applyStructuralGuards(args, working, mergedFields);
  if (structural != null && structural !== working) {
    northStarStructuralReplacement = true;
    blockedReasons.push("structural_guard_rewrite");
    working = structural;
    source = "deterministic_minimal";
  }

  let repeatedQuestionMeta: Partial<
    Pick<
      NorthStarCoachSmsMeta,
      "repeated_question_guard_fired" | "repeated_question_original" | "repeated_question_replacement"
    >
  > = {};
  const repeatKill = applyRepeatedQuestionKillSwitch(args, working, mergedFields);
  if (repeatKill.replacement != null && repeatKill.replacement !== working) {
    blockedReasons.push("repeated_question_kill_switch");
    repeatedQuestionMeta = {
      repeated_question_guard_fired: true,
      repeated_question_original: repeatKill.original,
      repeated_question_replacement: repeatKill.replacement,
    };
    working = repeatKill.replacement;
    source = "deterministic_minimal";
  }

  if (args.contextPacket?.v3AnswerToOpenQuestion) {
    const v3scrub = scrubV3AnswerToOpenQuestionCopy(working, preserveNl);
    working = v3scrub.text;
    if (v3scrub.hits.length) {
      blockedReasons.push("v3_open_answer_scrub", ...v3scrub.hits.slice(0, 4));
      source = "rewritten";
    }
  }

  const robo = scrubRobotMotivation(working, preserveNl);
  working = robo.text;
  if (robo.hits.length) {
    blockedReasons.push("robot_motivation_scrub", ...robo.hits.slice(0, 3));
    source = "rewritten";
  }

  const chk = scrubCheckInWorkflow(working, args.channel, preserveNl);
  working = chk.text;
  if (chk.hits.length) {
    blockedReasons.push("check_in_workflow_scrub");
    source = "rewritten";
  }

  const dailyEssay = scrubDailyOutboundEssayAndManage(working, args.channel, mergedAsk, preserveNl);
  working = dailyEssay.text;
  if (dailyEssay.hits.length) {
    blockedReasons.push("daily_outbound_essay_scrub", ...dailyEssay.hits.slice(0, 4));
    source = "rewritten";
  }

  const tmp = scrubWrongTemporal(working, preserveNl);
  working = tmp.text;
  if (tmp.hits.length) {
    blockedReasons.push("wrong_temporal_scrub");
    source = "rewritten";
  }

  const jargon = scrubProductJargon(working, preserveNl);
  working = jargon.text;
  if (jargon.hits.length) {
    blockedReasons.push("product_jargon_scrub");
    source = "rewritten";
  }

  if (
    args.channel === "contract_prompt" ||
    args.channel === "contract_ack" ||
    args.channel === "guided_contract_proposal" ||
    /recommit to this|7\s*days|proposal_yes|overlay proposal/i.test(working)
  ) {
    const before = working;
    working = softenHeavyContractJargon(working, preserveNl);
    if (working !== before) {
      blockedReasons.push("contract_language_rewrite");
      source = "rewritten";
    }
  }

  const app = scrubAppDeflection(working, args.userAskedAboutAppNavigation === true, preserveNl);
  working = app.text;
  if (app.hits.length) {
    blockedReasons.push(...app.hits);
    source = "rewritten";
  }

  if (
    args.channel === "daily_outbound" ||
    args.channel === "reactivation" ||
    args.channel === "weekly_sms" ||
    args.channel === "lifecycle_sms"
  ) {
    const before = working;
    working = dailyOutboundFlavor(working, args.channel, mergedAsk);
    if (working !== before) blockedReasons.push("daily_outbound_flavor");
    source = working !== before ? "rewritten" : source;
  }

  if (preserveNl) {
    working = working
      .split("\n")
      .map((ln) => ln.replace(/\s+([.!?])/g, "$1").trim())
      .join("\n");
  } else {
    working = norm(working.replace(/\s+([.!?])/g, "$1"));
  }

  if (working.trim().length < 10) {
    if (args.channel === "daily_outbound" || args.channel === "reactivation") {
      working =
        mergedAsk.length >= 8 && mergedAsk.length <= 100
          ? `Tell the truth first — ${mergedAsk.slice(0, 72).replace(/\s+/g, " ").trim()}. What happened with today's rep?`
          : "What happened with today's rep — honestly?";
    } else if (args.channel === "weekly_sms" || args.channel === "lifecycle_sms") {
      working =
        mergedAsk.length >= 8 && mergedAsk.length <= 120
          ? `Pat Pause — ${mergedAsk.slice(0, 72).replace(/\s+/g, " ").trim()}. One honest line about your week?`
          : "Pat Pause: one honest line about your week?";
    } else if (
      (args.channel === "inbound_coach_reply" || args.channel === "blocker_followup") &&
      args.contextPacket?.blockerSignal
    ) {
      working = "What's the real obstacle—in one honest line?";
    } else {
      working = "What's true — did you get the bar done today?";
    }
    source = "deterministic_minimal";
    blockedReasons.push("collapsed_after_scrub_recovery");
  }

  const maxLen = args.maxLen ?? NORTH_STAR_SMS_MAX_LEN;
  const visibleBody = preserveNl ? clipPreserveParagraphs(working, maxLen) : clip(working, maxLen);

  if (source === "approved" && visibleBody !== originalBody) {
    source = "rewritten";
  }

  return {
    visibleBody,
    meta: {
      source,
      blockedReasons,
      originalBody,
      ...(northStarStructuralReplacement ? { north_star_structural_replacement: true } : {}),
      ...(Object.keys(repeatedQuestionMeta).length ? repeatedQuestionMeta : {}),
    },
  };
}

/**
 * Gate coaching copy but append an exact compliance footer unchanged (e.g. STOP/HELP).
 * Declared after {@link finalizeNorthStarCoachSms} so the implementation closes over the canonical gate.
 */
export function finalizeNorthStarCoachSmsPreservingSuffix(args: {
  proposedFullBody: string;
  suffixToPreserve: string;
} & Omit<NorthStarCoachSmsArgs, "proposedBody">): NorthStarCoachSmsResult {
  const suf = args.suffixToPreserve.trim();
  let coaching = args.proposedFullBody.trimEnd();
  while (coaching.endsWith(suf)) {
    coaching = coaching.slice(0, -suf.length).trimEnd();
  }
  const { proposedFullBody: _full, suffixToPreserve: _sufKey, ...gateArgs } = args;
  void _full;
  void _sufKey;
  const inner = finalizeNorthStarCoachSms({
    ...gateArgs,
    proposedBody: coaching,
  });
  const combined = `${inner.visibleBody.trimEnd()}\n\n${suf}`;
  const max = args.maxLen ?? NORTH_STAR_SMS_LONG_FORM_MAX_LEN;
  const visibleBody = args.preserveNewlines
    ? clipPreserveParagraphs(combined, max)
    : clip(combined, max);
  return {
    visibleBody,
    meta: {
      ...inner.meta,
      originalBody: args.proposedFullBody.trim(),
      blockedReasons: [
        ...inner.meta.blockedReasons,
        ...(suf ? ["compliance_suffix_preserved_unchanged"] : []),
      ],
    },
  };
}
