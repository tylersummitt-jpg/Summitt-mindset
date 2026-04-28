/**
 * AI-grounded Victory Room summary (one paragraph). Runtime-only; no persistence.
 * Input bundle is narrow; validation + deterministic fallback keep the page safe without AI.
 */

import OpenAI from "openai";

import type { VictoryRoomViewData } from "@/lib/v2-victory-room-view";

export const V2_VICTORY_SUMMARY_MODEL = "gpt-4o-mini";

const MAX_CHARS = 450;
const TARGET_MIN = 280;
const TARGET_MAX = 400;
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

/** Narrow JSON-safe bundle sent to the model (and used for fallback). */
export type VictorySummaryInput = {
  address_as: string;
  preferred_name: string | null;
  identity_anchor_text: string | null;
  effective_ask: string;
  commitment_title: string | null;
  moments: { headline: string; body: string }[];
  comeback_lines: string[];
  /** True when there are no derived moments and no comeback lines — skip AI. */
  sparse: boolean;
  /** Any digit present in bundle fields (allows model to echo numbers if ever added). */
  input_contains_digit: boolean;
};

const STOPWORDS = new Set([
  "there",
  "your",
  "you",
  "this",
  "that",
  "with",
  "from",
  "have",
  "been",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "about",
  "their",
  "them",
  "these",
  "those",
  "being",
  "after",
  "before",
  "would",
  "could",
  "should",
  "might",
  "still",
  "into",
  "than",
  "then",
  "here",
  "just",
  "very",
  "also",
  "only",
  "even",
  "more",
  "most",
  "some",
  "such",
  "other",
  "coach",
  "coaching",
  "commitment",
  "accountability",
]);

const HYPE_BANNED = [
  "achievement",
  "unlocked",
  "level",
  "badge",
  "streak",
  "unstoppable",
  "crushing it",
  "crushing",
  "legend",
  "beast mode",
  "mvp",
  "winner",
  "dominate",
  "epic",
  "game changer",
  "game-changer",
] as const;

const TRANSFORMATION_BANNED = [
  /\bcompletely transformed\b/i,
  /\bchanged everything\b/i,
  /\bbrand new you\b/i,
  /\bnew person\b/i,
  /\blife[\s-]changing\b/i,
  /\bnever been\b/i,
  /\bbest version\b/i,
  /\bunrecognizable\b/i,
];

function truncateOneLine(s: string, max: number): string {
  const x = s.trim().replace(/\s+/g, " ");
  if (x.length <= max) return x;
  return `${x.slice(0, max - 1)}…`;
}

function getOpenAIClientOrNull(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) return null;
  return new OpenAI({ apiKey });
}

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

/**
 * Build the structured input bundle from the Victory Room view (already trusted).
 */
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

  const comeback_lines = view.comebackLines.slice(0, 3).map((l) => truncateOneLine(l, TRUNC.comebackLine));

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

function hasBannedHype(text: string): boolean {
  const lower = text.toLowerCase();
  for (const w of HYPE_BANNED) {
    if (lower.includes(w)) return true;
  }
  return false;
}

function hasBannedTransformation(text: string): boolean {
  return TRANSFORMATION_BANNED.some((re) => re.test(text));
}

function referenceBlobForOverlap(input: VictorySummaryInput): string {
  const parts: string[] = [
    input.address_as.toLowerCase(),
    ...(input.preferred_name ? [input.preferred_name.toLowerCase()] : []),
    input.effective_ask.toLowerCase(),
    ...(input.identity_anchor_text ? [input.identity_anchor_text.toLowerCase()] : []),
    ...(input.commitment_title ? [input.commitment_title.toLowerCase()] : []),
    ...input.moments.map((m) => `${m.headline} ${m.body}`.toLowerCase()),
    ...input.comeback_lines.map((l) => l.toLowerCase()),
  ];
  return parts.join(" ");
}

/**
 * Require meaningful overlap with grounded text (moments, comeback, anchor, title, or ask).
 */
export function hasGroundingWordOverlap(output: string, input: VictorySummaryInput): boolean {
  const blob = referenceBlobForOverlap(input);
  const words = output.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [];
  const significant = words.filter((w) => !STOPWORDS.has(w));
  if (significant.length === 0) return false;
  const hits = significant.filter((w) => blob.includes(w));
  if (significant.length <= 3) return hits.length >= 1;
  return hits.length >= 2;
}

/** Phrase / anchor overlap when short moment copy yields few long tokens. */
export function hasGroundingPhraseOverlap(output: string, input: VictorySummaryInput): boolean {
  const o = output.toLowerCase();
  for (const m of input.moments) {
    const b = m.body.toLowerCase().replace(/\s+/g, " ").trim();
    if (b.length >= 10) {
      const slice = b.slice(0, Math.min(28, b.length));
      if (o.includes(slice)) return true;
    }
    const h = m.headline.toLowerCase().replace(/\s+/g, " ").trim();
    if (h.length >= 8) {
      const slice = h.slice(0, Math.min(20, h.length));
      if (o.includes(slice)) return true;
    }
  }
  for (const line of input.comeback_lines) {
    const l = line.toLowerCase();
    if (l.length >= 12) {
      if (o.includes(l.slice(0, Math.min(22, l.length)))) return true;
    }
  }
  if (input.identity_anchor_text) {
    for (const w of input.identity_anchor_text.toLowerCase().split(/\s+/)) {
      const t = w.replace(/[^a-z]/g, "");
      if (t.length >= 5 && o.includes(t)) return true;
    }
  }
  return false;
}

export function hasGroundingEvidenceOverlap(output: string, input: VictorySummaryInput): boolean {
  return hasGroundingWordOverlap(output, input) || hasGroundingPhraseOverlap(output, input);
}

/** Reject if output mentions digit sequences not present in input bundle. */
function mentionsUnsupportedNumbers(output: string, input: VictorySummaryInput): boolean {
  if (input.input_contains_digit) return false;
  return /\d/.test(output);
}

/**
 * Light check: obvious facts not in bundle (calendar years / ordinals) when digits disallowed.
 */
function mentionsSuspiciousFacts(output: string, input: VictorySummaryInput): boolean {
  if (input.input_contains_digit) return false;
  if (/\b20[12]\d\b/.test(output)) return true;
  return false;
}

export function validateVictorySummaryOutput(text: string, input: VictorySummaryInput): boolean {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return false;
  if (t.length > MAX_CHARS) return false;
  if (countSentences(t) > MAX_SENTENCES) return false;
  if (hasBannedHype(t)) return false;
  if (hasBannedTransformation(t)) return false;
  if (mentionsUnsupportedNumbers(t, input)) return false;
  if (mentionsSuspiciousFacts(t, input)) return false;
  if (!input.sparse && !hasGroundingEvidenceOverlap(t, input)) return false;
  return true;
}

function buildSystemPrompt(): string {
  return [
    "You write one short paragraph for a private coaching product called Victory Room.",
    "Rules:",
    `- Write exactly 2 or 3 sentences. Max ${MAX_CHARS} characters total. No bullet points.`,
    `- Target length roughly ${TARGET_MIN}-${TARGET_MAX} characters when possible.`,
    "- Paraphrase ONLY facts present in the JSON user message. Do not invent events, outcomes, timelines, or numbers.",
    "- Do not mention streaks, scores, levels, badges, or achievements.",
    "- Tone: warm, grounded, identity-aware, confident but humble. No hype, no therapy jargon, no fake precision.",
    "- Use the identity anchor phrase only if it appears in the JSON and it fits naturally; do not force it.",
    "- Do not claim life transformation or permanent change.",
    "Output: plain text paragraph only. No title, no quotes around the whole paragraph.",
  ].join("\n");
}

export async function generateVictorySummaryParagraph(
  client: OpenAI,
  input: VictorySummaryInput
): Promise<string | null> {
  const userPayload = JSON.stringify(input);
  try {
    const res = await client.chat.completions.create({
      model: V2_VICTORY_SUMMARY_MODEL,
      temperature: 0.35,
      max_tokens: 220,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        {
          role: "user",
          content: `Write the paragraph using ONLY this JSON as facts:\n${userPayload}`,
        },
      ],
    });
    const raw = res.choices[0]?.message?.content?.trim().replace(/\s+/g, " ");
    return raw && raw.length > 0 ? raw : null;
  } catch (e) {
    console.error("[v2-victory-room-summary] OpenAI call failed", {
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** One short grounded line when there are no moments and no comeback lines yet. */
export function buildSparseEarlyChapterSummary(input: VictorySummaryInput): string {
  const ask = truncateOneLine(input.effective_ask, 220);
  const name = input.address_as;
  const line = `${name}, you are in the early chapter of this commitment. The bar right now is: ${ask} Proof will show up here as you answer checks honestly — no performance, just truth.`;
  return clampToMaxSentences(truncateOneLine(line, MAX_CHARS), MAX_SENTENCES);
}

export function buildDeterministicVictorySummaryFallback(input: VictorySummaryInput): string {
  const ask = truncateOneLine(input.effective_ask, 200);
  const s1 = `${input.address_as}, your coach is holding you to this right now: ${ask}`;

  let s2 = "";
  if (input.moments.length > 0) {
    const a = truncateOneLine(input.moments[0].body, 160);
    const b =
      input.moments.length > 1 ? truncateOneLine(input.moments[1].body, 120) : "";
    s2 = b ? `Recent proof includes: ${a} ${b}` : `Recent proof includes: ${a}`;
  } else if (input.comeback_lines.length > 0) {
    s2 = truncateOneLine(input.comeback_lines[0], 200);
  } else {
    s2 = "Keep answering honestly — that is how this room fills in.";
  }

  let s3 = "";
  if (input.comeback_lines.length > 0 && input.moments.length > 0) {
    s3 = truncateOneLine(input.comeback_lines[0], 180);
  }

  const parts = [s1, s2, s3].filter(Boolean);
  let out = parts.join(" ");
  out = clampToMaxSentences(out, MAX_SENTENCES);
  out = truncateOneLine(out, MAX_CHARS);
  out = clampToMaxSentences(out, MAX_SENTENCES);
  return out;
}

export type VictorySummaryProvenance = "ai" | "fallback" | "early_chapter";

export async function resolveVictoryRoomSummaryParagraph(
  view: VictoryRoomViewData,
  addressAs: string
): Promise<{ paragraph: string; provenance: VictorySummaryProvenance }> {
  const input = buildVictorySummaryInput(view, addressAs);
  if (!input) {
    return { paragraph: "", provenance: "fallback" };
  }

  if (input.sparse) {
    return { paragraph: buildSparseEarlyChapterSummary(input), provenance: "early_chapter" };
  }

  const client = getOpenAIClientOrNull();
  if (!client) {
    return {
      paragraph: buildDeterministicVictorySummaryFallback(input),
      provenance: "fallback",
    };
  }

  const raw = await generateVictorySummaryParagraph(client, input);
  if (raw) {
    if (validateVictorySummaryOutput(raw, input)) {
      return { paragraph: raw.trim(), provenance: "ai" };
    }
    const trimmed = truncateOneLine(raw, MAX_CHARS).replace(/\s+/g, " ").trim();
    if (validateVictorySummaryOutput(trimmed, input)) {
      return { paragraph: trimmed, provenance: "ai" };
    }
  }

  return {
    paragraph: buildDeterministicVictorySummaryFallback(input),
    provenance: "fallback",
  };
}
