// src/lib/memory/compress-reflection.ts

/**
 * ======================================================
 * Safe Reflection Compression (RETENTION v4 — ONE SENTENCE)
 * ======================================================
 *
 * Converts raw journal text into a coach-safe memory atom.
 *
 * Hard constraints:
 * - NEVER copy raw phrasing
 * - NEVER include quotes
 * - NEVER mention journaling / entries / writing
 * - NEVER include dates/times ("today", "yesterday", etc.)
 * - Must remain time-agnostic
 * - MUST BE ONE SENTENCE ONLY
 *
 * Output is designed to be fed into:
 * - daily_summaries
 * - weekly_summaries
 * - pattern extraction
 * - CoachPatContext grounding
 *
 * This is NOT a diary recap.
 * This is a safe signal snapshot.
 *
 * NOTE TO SELF:
 * The goal is better retention signal, not literary prose.
 * Prefer simple, generalized language that preserves:
 * - standard
 * - domain
 * - blocker
 * - follow-through / action
 */

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

function clampChars(input: string, max: number): string {
  const t = normalizeText(input);
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max).trim()}…` : t;
}

function stripQuotesAndMeta(input: string): string {
  return normalizeText(input)
    .replace(/["'`]/g, "")
    .replace(/\b(journal|journaling|entry|entries|wrote|writing|typed)\b/gi, "")
    .replace(
      /\b(today|tonight|tomorrow|yesterday|this morning|this afternoon|this evening|last night|last week|this week)\b/gi,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
}

function getPrimaryActionSignal(actionItem: string | null): string {
  const cleaned = stripQuotesAndMeta(actionItem || "");
  if (!cleaned) return "";

  const splitters = [
    "Fresh angle today:",
    "If today gets crowded,",
    "If the day gets crowded,",
    "Examples:",
  ];

  for (const marker of splitters) {
    const idx = cleaned.indexOf(marker);
    if (idx > 0) {
      return normalizeText(cleaned.slice(0, idx));
    }
  }

  return cleaned;
}

type Standard =
  | "follow-through"
  | "focus"
  | "discipline"
  | "leadership"
  | "clarity"
  | "communication"
  | "calm under pressure"
  | "respect"
  | "gratitude"
  | "confidence"
  | "courage"
  | "trust"
  | "health"
  | "presence"
  | "values"
  | "general";

type Domain =
  | "work"
  | "family"
  | "relationships"
  | "health"
  | "team"
  | "home"
  | "personal life"
  | "general";

type Blocker =
  | "avoidance"
  | "pressure"
  | "low energy"
  | "distraction"
  | "overthinking"
  | "fear"
  | "frustration"
  | "self-doubt"
  | null;

type FollowThrough =
  | "finishing a task"
  | "starting a task"
  | "having a hard conversation"
  | "speaking clearly"
  | "staying steady"
  | "protecting focus"
  | "showing respect"
  | "encouraging someone"
  | "taking care of health"
  | "keeping a promise"
  | "taking a small step"
  | "holding a standard"
  | null;

function inferStandard(actionItem: string | null, journalContent: string): Standard {
  const action = getPrimaryActionSignal(actionItem).toLowerCase();
  const journal = stripQuotesAndMeta(journalContent).toLowerCase();
  const combined = `${action} ${journal}`;

  if (
    combined.includes("finish") ||
    combined.includes("follow through") ||
    combined.includes("follow-through") ||
    combined.includes("hardest thing first") ||
    combined.includes("complete") ||
    combined.includes("done")
  ) {
    return "follow-through";
  }

  if (
    combined.includes("focus") ||
    combined.includes("attention") ||
    combined.includes("distract")
  ) {
    return "focus";
  }

  if (
    combined.includes("discipline") ||
    combined.includes("habit") ||
    combined.includes("routine") ||
    combined.includes("standard")
  ) {
    return "discipline";
  }

  if (
    combined.includes("lead") ||
    combined.includes("leadership") ||
    combined.includes("example")
  ) {
    return "leadership";
  }

  if (
    combined.includes("clear") ||
    combined.includes("clarity") ||
    combined.includes("first step") ||
    combined.includes("what matters most") ||
    combined.includes("goal")
  ) {
    return "clarity";
  }

  if (
    combined.includes("conversation") ||
    combined.includes("message") ||
    combined.includes("boundary") ||
    combined.includes("feedback") ||
    combined.includes("listen") ||
    combined.includes("honest") ||
    combined.includes("speak")
  ) {
    return "communication";
  }

  if (
    combined.includes("calm") ||
    combined.includes("steady") ||
    combined.includes("pressure") ||
    combined.includes("responding") ||
    combined.includes("tough moment") ||
    combined.includes("plans change")
  ) {
    return "calm under pressure";
  }

  if (
    combined.includes("respect") ||
    combined.includes("listen without interrupting") ||
    combined.includes("full attention")
  ) {
    return "respect";
  }

  if (combined.includes("thank") || combined.includes("gratitude")) {
    return "gratitude";
  }

  if (
    combined.includes("confidence") ||
    combined.includes("stand tall") ||
    combined.includes("self-belief")
  ) {
    return "confidence";
  }

  if (
    combined.includes("fear") ||
    combined.includes("courage") ||
    combined.includes("speak up") ||
    combined.includes("hard thing")
  ) {
    return "courage";
  }

  if (
    combined.includes("trust") ||
    combined.includes("keep a promise") ||
    combined.includes("be on time")
  ) {
    return "trust";
  }

  if (
    combined.includes("body") ||
    combined.includes("mind") ||
    combined.includes("water") ||
    combined.includes("walk") ||
    combined.includes("bed") ||
    combined.includes("sleep") ||
    combined.includes("health") ||
    combined.includes("energy")
  ) {
    return "health";
  }

  if (
    combined.includes("present") ||
    combined.includes("pause") ||
    combined.includes("breathe")
  ) {
    return "presence";
  }

  if (combined.includes("value") || combined.includes("honesty") || combined.includes("kindness")) {
    return "values";
  }

  return "general";
}

function inferDomain(journalContent: string, actionItem: string | null): Domain {
  const combined = `${stripQuotesAndMeta(actionItem || "")} ${stripQuotesAndMeta(
    journalContent
  )}`.toLowerCase();

  if (
    combined.includes("work") ||
    combined.includes("email") ||
    combined.includes("meeting") ||
    combined.includes("project") ||
    combined.includes("draft") ||
    combined.includes("call") ||
    combined.includes("task") ||
    combined.includes("manager") ||
    combined.includes("career")
  ) {
    return "work";
  }

  if (
    combined.includes("family") ||
    combined.includes("kids") ||
    combined.includes("child") ||
    combined.includes("parent") ||
    combined.includes("home with the kids")
  ) {
    return "family";
  }

  if (
    combined.includes("spouse") ||
    combined.includes("wife") ||
    combined.includes("husband") ||
    combined.includes("partner") ||
    combined.includes("relationship") ||
    combined.includes("marriage")
  ) {
    return "relationships";
  }

  if (
    combined.includes("health") ||
    combined.includes("sleep") ||
    combined.includes("water") ||
    combined.includes("walk") ||
    combined.includes("workout") ||
    combined.includes("body") ||
    combined.includes("energy")
  ) {
    return "health";
  }

  if (
    combined.includes("team") ||
    combined.includes("group") ||
    combined.includes("coworker") ||
    combined.includes("staff")
  ) {
    return "team";
  }

  if (
    combined.includes("house") ||
    combined.includes("home") ||
    combined.includes("drawer") ||
    combined.includes("room")
  ) {
    return "home";
  }

  if (
    combined.includes("friend") ||
    combined.includes("mentor") ||
    combined.includes("coach")
  ) {
    return "relationships";
  }

  return "personal life";
}

function inferBlocker(journalContent: string): Blocker {
  const t = stripQuotesAndMeta(journalContent).toLowerCase();

  if (
    t.includes("avoid") ||
    t.includes("procrast") ||
    t.includes("delay") ||
    t.includes("put off")
  ) {
    return "avoidance";
  }

  if (
    t.includes("stress") ||
    t.includes("pressure") ||
    t.includes("overwhelm") ||
    t.includes("anx")
  ) {
    return "pressure";
  }

  if (
    t.includes("tired") ||
    t.includes("exhaust") ||
    t.includes("burnout") ||
    t.includes("drained") ||
    t.includes("low energy")
  ) {
    return "low energy";
  }

  if (
    t.includes("distract") ||
    t.includes("scroll") ||
    t.includes("phone") ||
    t.includes("noise") ||
    t.includes("scatter")
  ) {
    return "distraction";
  }

  if (
    t.includes("overthink") ||
    t.includes("spiral") ||
    t.includes("stuck in my head") ||
    t.includes("stuck in your head")
  ) {
    return "overthinking";
  }

  if (t.includes("fear") || t.includes("afraid") || t.includes("nervous")) {
    return "fear";
  }

  if (t.includes("frustrat") || t.includes("angry") || t.includes("irritated")) {
    return "frustration";
  }

  if (
    t.includes("doubt") ||
    t.includes("not good enough") ||
    t.includes("cannot do this") ||
    t.includes("cant do this")
  ) {
    return "self-doubt";
  }

  return null;
}

function inferFollowThrough(
  actionItem: string | null,
  journalContent: string,
  standard: Standard
): FollowThrough {
  const combined = `${getPrimaryActionSignal(actionItem)} ${stripQuotesAndMeta(
    journalContent
  )}`.toLowerCase();

  if (
    combined.includes("finish") ||
    combined.includes("done") ||
    combined.includes("complete") ||
    combined.includes("clear one drawer") ||
    combined.includes("reply to one email")
  ) {
    return "finishing a task";
  }

  if (
    combined.includes("start") ||
    combined.includes("first step") ||
    combined.includes("begin") ||
    combined.includes("hardest thing first")
  ) {
    return "starting a task";
  }

  if (
    combined.includes("conversation") ||
    combined.includes("boundary") ||
    combined.includes("feedback") ||
    combined.includes("hard talk") ||
    combined.includes("honest")
  ) {
    return "having a hard conversation";
  }

  if (
    combined.includes("message") ||
    combined.includes("say clearly") ||
    combined.includes("speak clearly") ||
    combined.includes("speak up")
  ) {
    return "speaking clearly";
  }

  if (
    combined.includes("calm") ||
    combined.includes("steady") ||
    combined.includes("stand tall") ||
    combined.includes("responding")
  ) {
    return "staying steady";
  }

  if (
    combined.includes("focus") ||
    combined.includes("attention") ||
    combined.includes("remove noise")
  ) {
    return "protecting focus";
  }

  if (
    combined.includes("respect") ||
    combined.includes("listen") ||
    combined.includes("full attention")
  ) {
    return "showing respect";
  }

  if (
    combined.includes("encourage") ||
    combined.includes("thank you") ||
    combined.includes("thank") ||
    combined.includes("believe in you")
  ) {
    return "encouraging someone";
  }

  if (
    combined.includes("walk") ||
    combined.includes("water") ||
    combined.includes("bed") ||
    combined.includes("sleep") ||
    combined.includes("workout") ||
    combined.includes("body") ||
    combined.includes("health")
  ) {
    return "taking care of health";
  }

  if (
    combined.includes("trust") ||
    combined.includes("promise") ||
    combined.includes("be on time") ||
    combined.includes("follow through")
  ) {
    return "keeping a promise";
  }

  if (
    combined.includes("small step") ||
    combined.includes("one step") ||
    combined.includes("move toward")
  ) {
    return "taking a small step";
  }

  if (
    combined.includes("standard") ||
    combined.includes("value") ||
    combined.includes("patience") ||
    combined.includes("honesty") ||
    combined.includes("effort") ||
    combined.includes("kindness")
  ) {
    return "holding a standard";
  }

  switch (standard) {
    case "follow-through":
    case "discipline":
      return "finishing a task";
    case "communication":
      return "speaking clearly";
    case "calm under pressure":
      return "staying steady";
    case "health":
      return "taking care of health";
    default:
      return null;
  }
}

function domainPhrase(domain: Domain): string {
  switch (domain) {
    case "work":
      return "in work";
    case "family":
      return "in family life";
    case "relationships":
      return "in a relationship";
    case "health":
      return "with health";
    case "team":
      return "with a team";
    case "home":
      return "at home";
    case "personal life":
      return "in personal life";
    default:
      return "";
  }
}

function blockerPhrase(blocker: Blocker): string {
  switch (blocker) {
    case "avoidance":
      return "despite avoidance";
    case "pressure":
      return "under pressure";
    case "low energy":
      return "despite low energy";
    case "distraction":
      return "while fighting distraction";
    case "overthinking":
      return "while getting out of the head";
    case "fear":
      return "despite fear";
    case "frustration":
      return "while redirecting frustration";
    case "self-doubt":
      return "despite self-doubt";
    default:
      return "";
  }
}

function buildCoachSafeAtom({
  actionItem,
  journalContent,
}: {
  actionItem: string | null;
  journalContent: string;
}): string {
  const standard = inferStandard(actionItem, journalContent);
  const domain = inferDomain(journalContent, actionItem);
  const blocker = inferBlocker(journalContent);
  const followThrough = inferFollowThrough(actionItem, journalContent, standard);

  const parts: string[] = [];

  parts.push(`Practiced ${standard}`);

  const domainText = domainPhrase(domain);
  if (domainText) {
    parts.push(domainText);
  }

  if (followThrough) {
    parts.push(`by ${followThrough}`);
  }

  const blockerText = blockerPhrase(blocker);
  if (blockerText) {
    parts.push(blockerText);
  }

  let sentence = parts.join(" ");

  sentence = sentence
    .replace(/\s+/g, " ")
    .replace(/\s+\./g, ".")
    .trim();

  if (!sentence.endsWith(".")) {
    sentence += ".";
  }

  return sentence;
}

export function compressReflectionToMemoryAtom({
  actionItem,
  journalContent,
  maxChars = 300,
}: {
  actionItem: string | null;
  journalContent: string;
  maxChars?: number;
}): string {
  const safeAction = stripQuotesAndMeta(actionItem || "");
  const safeJournal = stripQuotesAndMeta(journalContent || "");

  if (!safeJournal) return "";

  const atom = buildCoachSafeAtom({
    actionItem: safeAction,
    journalContent: safeJournal,
  });

  const sanitized = atom
    .replace(/["'`]/g, "")
    .replace(/\b(journal|journaling|entry|entries|wrote|writing|typed)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return clampChars(sanitized, maxChars);
}