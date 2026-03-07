// src/lib/memory/pattern-extractor.ts

/**
 * ======================================================
 * Weekly Pattern Extraction (RETENTION v4 + KEYS)
 * ======================================================
 *
 * Output:
 * {
 *   identity: string
 *   encouragement: string
 *   patterns: { key: string; text: string }[]
 * }
 *
 * NOTE TO SELF:
 * Pattern keys are intentionally human-readable because:
 * - updateRecentSummary() uses pattern_key directly
 * - Coach Pat context surfaces pattern keys directly
 * So keys should read naturally in plain English.
 */

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

type Bucket =
  | "follow-through"
  | "focus"
  | "discipline"
  | "calm under pressure"
  | "communication"
  | "clarity"
  | "leadership"
  | "confidence"
  | "courage"
  | "respect"
  | "gratitude"
  | "trust"
  | "health"
  | "family"
  | "energy"
  | "avoidance"
  | "general";

function bucketFor(atom: string): Bucket[] {
  const t = normalizeText(atom).toLowerCase();
  if (!t) return ["general"];

  const buckets: Bucket[] = [];
  const add = (b: Bucket) => {
    if (!buckets.includes(b)) buckets.push(b);
  };

  // New richer atom detection
  if (t.includes("practiced follow-through")) add("follow-through");
  if (t.includes("practiced focus") || t.includes("protecting focus")) add("focus");
  if (t.includes("practiced discipline")) add("discipline");
  if (t.includes("practiced calm under pressure") || t.includes("under pressure"))
    add("calm under pressure");
  if (t.includes("practiced communication") || t.includes("speaking clearly"))
    add("communication");
  if (t.includes("practiced clarity")) add("clarity");
  if (t.includes("practiced leadership")) add("leadership");
  if (t.includes("practiced confidence")) add("confidence");
  if (t.includes("practiced courage")) add("courage");
  if (t.includes("practiced respect") || t.includes("showing respect"))
    add("respect");
  if (t.includes("practiced gratitude") || t.includes("encouraging someone"))
    add("gratitude");
  if (t.includes("practiced trust") || t.includes("keeping a promise"))
    add("trust");
  if (t.includes("practiced health") || t.includes("taking care of health"))
    add("health");

  if (t.includes("in family life")) add("family");
  if (t.includes("despite low energy")) add("energy");
  if (t.includes("despite avoidance")) add("avoidance");

  // Legacy support from older atoms already in dev data
  if (t.includes("focus practice")) add("focus");
  if (t.includes("discipline practice")) add("discipline");
  if (t.includes("leadership practice")) add("leadership");
  if (t.includes("confidence practice")) add("confidence");
  if (t.includes("steadiness practice")) add("calm under pressure");
  if (t.includes("communication practice")) add("communication");
  if (t.includes("clarity practice")) add("clarity");
  if (t.includes("family being a real anchor")) add("family");
  if (t.includes("energy being a factor")) add("energy");
  if (t.includes("avoidance showing up")) add("avoidance");
  if (t.includes("pressure showing up")) add("calm under pressure");

  return buckets.length ? buckets : ["general"];
}

function identityLine(bucket: Bucket): string {
  switch (bucket) {
    case "follow-through":
      return "You are becoming someone who finishes what matters.";
    case "focus":
      return "You are protecting your attention better.";
    case "discipline":
      return "You are becoming more disciplined in small moments.";
    case "calm under pressure":
      return "You are getting steadier under pressure.";
    case "communication":
      return "You are getting clearer in how you speak and respond.";
    case "clarity":
      return "You are getting clearer about what matters first.";
    case "leadership":
      return "You are leading yourself better in real moments.";
    case "confidence":
      return "You are building confidence through action.";
    case "courage":
      return "You are moving toward hard things more directly.";
    case "respect":
      return "You are raising your standard in how you treat people.";
    case "gratitude":
      return "You are widening your perspective in healthy ways.";
    case "trust":
      return "You are becoming more reliable in small commitments.";
    case "health":
      return "You are treating your body and energy with more intention.";
    case "family":
      return "You are carrying family responsibility with more steadiness.";
    case "energy":
      return "You are learning to show up even when energy dips.";
    case "avoidance":
      return "You are getting more honest when avoidance shows up.";
    default:
      return "You are showing up consistently.";
  }
}

function bulletLine(bucket: Bucket): string {
  switch (bucket) {
    case "follow-through":
      return "You build momentum when you finish one real thing.";
    case "focus":
      return "Your best work happens when you protect your attention.";
    case "discipline":
      return "Small standards are strengthening your day-to-day life.";
    case "calm under pressure":
      return "You do better when you slow down before reacting.";
    case "communication":
      return "Clear words reduce confusion and wasted energy.";
    case "clarity":
      return "The next right step gets easier when you name it clearly.";
    case "leadership":
      return "Leadership is showing up in small decisions, not speeches.";
    case "confidence":
      return "Belief grows when action comes first.";
    case "courage":
      return "Hard things shrink when you move toward them directly.";
    case "respect":
      return "Respect shows up in attention, tone, and follow-through.";
    case "gratitude":
      return "Perspective steadies you when pressure starts to rise.";
    case "trust":
      return "Trust grows when your actions stay dependable.";
    case "health":
      return "Energy improves when care becomes a real choice.";
    case "family":
      return "Responsibility can become a source of purpose, not just weight.";
    case "energy":
      return "Showing up matters more than waiting to feel perfect.";
    case "avoidance":
      return "Action usually gets easier once you begin.";
    default:
      return "Consistency compounds.";
  }
}

export function extractWeeklyPatternsFromMemoryAtoms(atoms: string[]) {
  const scores = new Map<Bucket, number>();

  for (const atom of atoms) {
    for (const b of bucketFor(atom)) {
      scores.set(b, (scores.get(b) ?? 0) + 1);
    }
  }

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([bucket]) => bucket)
    .filter((b) => b !== "general");

  const top = ranked.slice(0, 2);

  const identity = identityLine(top[0] ?? "general");

  const patterns = top.map((b) => ({
    key: b,
    text: bulletLine(b),
  }));

  const encouragement = "Keep going. Stay steady.";

  return {
    identity,
    encouragement,
    patterns,
  };
}