// src/lib/memory/pattern-extractor.ts

/**
 * ======================================================
 * Weekly Pattern Extraction (RETENTION v3 + KEYS)
 * ======================================================
 *
 * Output:
 * {
 *   identity: string
 *   encouragement: string
 *   patterns: { key: string; text: string }[]
 * }
 */

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

type Bucket =
  | "focus"
  | "discipline"
  | "avoidance"
  | "pressure"
  | "energy"
  | "family"
  | "leadership"
  | "confidence"
  | "steadiness"
  | "general";

function bucketFor(atom: string): Bucket[] {
  const t = normalizeText(atom).toLowerCase();
  if (!t) return ["general"];

  const buckets: Bucket[] = [];
  const add = (b: Bucket) => {
    if (!buckets.includes(b)) buckets.push(b);
  };

  if (t.includes("focus")) add("focus");
  if (t.includes("discipline")) add("discipline");
  if (t.includes("avoidance")) add("avoidance");
  if (t.includes("pressure")) add("pressure");
  if (t.includes("energy")) add("energy");
  if (t.includes("family")) add("family");
  if (t.includes("leadership")) add("leadership");
  if (t.includes("confidence")) add("confidence");
  if (t.includes("steadiness")) add("steadiness");

  return buckets.length ? buckets : ["general"];
}

function identityLine(bucket: Bucket): string {
  switch (bucket) {
    case "discipline":
      return "You are becoming more disciplined.";
    case "focus":
      return "You are protecting your attention better.";
    case "avoidance":
      return "You are getting more honest when avoidance shows up.";
    case "pressure":
      return "You are steadier under pressure.";
    case "energy":
      return "You are learning to show up even when energy dips.";
    case "family":
      return "You are balancing responsibility more clearly.";
    case "leadership":
      return "You are raising your standard in small moments.";
    case "confidence":
      return "You are building confidence through follow-through.";
    case "steadiness":
      return "You are becoming steadier in how you operate.";
    default:
      return "You are showing up consistently.";
  }
}

function bulletLine(bucket: Bucket): string {
  switch (bucket) {
    case "discipline":
      return "You follow through when you shrink the task.";
    case "focus":
      return "Your best days happen when you remove noise.";
    case "avoidance":
      return "Action gets easier once you start.";
    case "pressure":
      return "Small steps calm big pressure.";
    case "energy":
      return "Showing up matters more than feeling ready.";
    case "family":
      return "Responsibility can fuel you or weigh on you.";
    case "leadership":
      return "Standards show up in small decisions.";
    case "confidence":
      return "Small wins build belief.";
    case "steadiness":
      return "Simple actions repeated become your edge.";
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