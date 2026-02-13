// src/lib/memory/compress-reflection.ts

/**
 * ======================================================
 * Safe Reflection Compression (DETERMINISTIC)
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
 *
 * Output is designed to be fed into:
 * - daily_summaries
 * - weekly_summaries
 * - CoachPatContext grounding
 *
 * This is NOT "summary of what they wrote".
 * It's a safe, coachable "signal snapshot".
 */

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

function clampChars(input: string, max: number): string {
  const t = normalizeText(input);
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max).trim()}…` : t;
}

type PracticeCategory =
  | "focus"
  | "discipline"
  | "leadership"
  | "gratitude"
  | "confidence"
  | "communication"
  | "stress"
  | "clarity"
  | "presence"
  | "values"
  | "general";

function categorizePractice(actionItem: string | null): PracticeCategory {
  const a = normalizeText(actionItem || "").toLowerCase();
  if (!a) return "general";

  if (a.includes("focus") || a.includes("attention") || a.includes("distraction"))
    return "focus";
  if (a.includes("discipline") || a.includes("standard") || a.includes("commit"))
    return "discipline";
  if (a.includes("lead") || a.includes("team") || a.includes("coach"))
    return "leadership";
  if (a.includes("gratitude") || a.includes("thank")) return "gratitude";
  if (a.includes("confidence") || a.includes("self-belief")) return "confidence";
  if (a.includes("communicat") || a.includes("conversation") || a.includes("listen"))
    return "communication";
  if (a.includes("stress") || a.includes("overwhelm") || a.includes("anx"))
    return "stress";
  if (a.includes("clarity") || a.includes("decide") || a.includes("priorit"))
    return "clarity";
  if (a.includes("present") || a.includes("breath") || a.includes("pause"))
    return "presence";
  if (a.includes("value") || a.includes("identity")) return "values";

  return "general";
}

function practiceLabel(category: PracticeCategory): string {
  switch (category) {
    case "focus":
      return "Focus practice";
    case "discipline":
      return "Discipline practice";
    case "leadership":
      return "Leadership practice";
    case "gratitude":
      return "Perspective practice";
    case "confidence":
      return "Confidence practice";
    case "communication":
      return "Communication practice";
    case "stress":
      return "Steadiness practice";
    case "clarity":
      return "Clarity practice";
    case "presence":
      return "Presence practice";
    case "values":
      return "Identity practice";
    default:
      return "Daily practice";
  }
}

/**
 * We extract *signals*, not sentences.
 * This must never output raw user wording.
 */
function extractSignals(raw: string): {
  themes: string[];
  tone: "steady" | "strained" | "encouraged";
} {
  const t = normalizeText(raw).toLowerCase();
  if (!t) return { themes: [], tone: "steady" };

  const themes: string[] = [];

  const add = (s: string) => {
    if (!themes.includes(s)) themes.push(s);
  };

  // broad, coach-safe themes
  if (t.includes("overthink") || t.includes("spiral") || t.includes("stuck"))
    add("getting stuck in your head");
  if (t.includes("tired") || t.includes("exhaust") || t.includes("burnout"))
    add("energy being a factor");
  if (t.includes("stress") || t.includes("overwhelm") || t.includes("anx"))
    add("pressure showing up");
  if (t.includes("avoid") || t.includes("procrast") || t.includes("delay"))
    add("avoidance showing up");
  if (t.includes("focus") || t.includes("distract") || t.includes("scatter"))
    add("protecting your focus");
  if (t.includes("family") || t.includes("kids") || t.includes("spouse"))
    add("family being a real anchor");
  if (t.includes("lead") || t.includes("team") || t.includes("manager"))
    add("leading in real moments");
  if (t.includes("confiden") || t.includes("self-belief"))
    add("confidence growing through action");
  if (t.includes("discipline") || t.includes("standard") || t.includes("commit"))
    add("holding the standard in small moments");
  if (t.includes("grateful") || t.includes("gratitude"))
    add("perspective helping you stay steady");
  if (t.includes("angry") || t.includes("frustrat"))
    add("frustration needing direction");
  if (t.includes("sad") || t.includes("down"))
    add("mood dipping and needing steadiness");
  if (t.includes("proud") || t.includes("win") || t.includes("progress"))
    add("progress being earned through follow-through");

  // tone heuristic
  const strained =
    t.includes("can't") ||
    t.includes("cannot") ||
    t.includes("hard") ||
    t.includes("struggle") ||
    t.includes("overwhelm") ||
    t.includes("anx") ||
    t.includes("burnout") ||
    t.includes("exhaust");

  const encouraged =
    t.includes("proud") ||
    t.includes("better") ||
    t.includes("progress") ||
    t.includes("win") ||
    t.includes("grateful");

  const tone: "steady" | "strained" | "encouraged" = strained
    ? "strained"
    : encouraged
      ? "encouraged"
      : "steady";

  return { themes: themes.slice(0, 2), tone };
}

function buildCoachSafeAtom({
  actionItem,
  journalContent,
}: {
  actionItem: string | null;
  journalContent: string;
}): string {
  const category = categorizePractice(actionItem);
  const label = practiceLabel(category);

  const { themes, tone } = extractSignals(journalContent);

  // Build 2 short sentences. No "today". No quotes. No journaling talk.
  const themeLine =
    themes.length === 0
      ? "Noticed what matters and stayed honest."
      : themes.length === 1
        ? `Noticed ${themes[0]}.`
        : `Noticed ${themes[0]} and ${themes[1]}.`;

  const secondLine =
    tone === "strained"
      ? "Kept it simple and stayed with the next right step."
      : tone === "encouraged"
        ? "Built momentum by following through on a small standard."
        : "Held steady and stayed intentional.";

  return `${label}. ${themeLine} ${secondLine}`;
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
  const atom = buildCoachSafeAtom({ actionItem, journalContent });

  // extra hard guard: never allow quotes or journaling words
  const sanitized = atom
    .replace(/["']/g, "")
    .replace(/\b(journal|journaling|entry|wrote|writing)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return clampChars(sanitized, maxChars);
}
