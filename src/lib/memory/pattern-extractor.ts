// src/lib/memory/pattern-extractor.ts

/**
 * ======================================================
 * Pattern Extraction (DETERMINISTIC)
 * ======================================================
 *
 * Input: safe memory atoms (already compressed)
 * Output: 1–2 coachable "pattern handles"
 *
 * Rules:
 * - never therapeutic
 * - never diagnostic
 * - never moralizing
 * - short, usable by Coach Pat naturally
 *
 * This is a stepping stone toward a real pattern_insights table.
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

  if (t.includes("focus practice") || t.includes("protecting your focus")) add("focus");
  if (t.includes("discipline practice") || t.includes("holding the standard")) add("discipline");
  if (t.includes("avoidance")) add("avoidance");
  if (t.includes("pressure") || t.includes("overwhelm")) add("pressure");
  if (t.includes("energy being a factor")) add("energy");
  if (t.includes("family being a real anchor")) add("family");
  if (t.includes("leadership practice") || t.includes("leading in real moments")) add("leadership");
  if (t.includes("confidence practice") || t.includes("confidence growing")) add("confidence");
  if (t.includes("steadiness practice") || t.includes("held steady")) add("steadiness");

  return buckets.length ? buckets : ["general"];
}

function renderPattern(bucket: Bucket): string | null {
  switch (bucket) {
    case "discipline":
      return "You build momentum when you keep a small, consistent standard.";
    case "focus":
      return "Your best days come when you protect your attention and keep it simple.";
    case "avoidance":
      return "When avoidance shows up, honesty is your first win — then action gets easier.";
    case "pressure":
      return "Under pressure, you do better when you shrink the task and steady yourself.";
    case "energy":
      return "Energy swings are real — you’re learning to show up anyway, without drama.";
    case "family":
      return "Family is an anchor for you — it can motivate and also add weight.";
    case "leadership":
      return "Leadership shows up in small moments — you’re learning to raise your standard there.";
    case "confidence":
      return "Confidence grows when you follow through on small promises.";
    case "steadiness":
      return "Steadiness is becoming your edge — simple actions, repeated, without noise.";
    default:
      return null;
  }
}

export function extractWeeklyPatternsFromMemoryAtoms(atoms: string[]): string[] {
  const scores = new Map<Bucket, number>();

  for (const atom of atoms) {
    for (const b of bucketFor(atom)) {
      scores.set(b, (scores.get(b) ?? 0) + 1);
    }
  }

  // Sort by frequency
  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([bucket]) => bucket)
    .filter((b) => b !== "general");

  const out: string[] = [];
  for (const b of ranked) {
    const p = renderPattern(b);
    if (!p) continue;
    out.push(p);
    if (out.length >= 2) break;
  }

  return out;
}
