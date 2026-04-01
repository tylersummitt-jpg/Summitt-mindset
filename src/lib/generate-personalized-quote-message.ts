import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabase-server";
import type { ProfileContext } from "@/lib/profile-context";

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

export function compactProfileForPrompt(profile: ProfileContext): string {
  const parts: string[] = [];
  if (profile.identity?.trim()) parts.push(`Identity: ${profile.identity.trim()}`);
  if (profile.relationships?.trim())
    parts.push(`Relationships: ${profile.relationships.trim()}`);
  if (profile.work?.trim()) parts.push(`Work: ${profile.work.trim()}`);
  if (profile.health?.trim()) parts.push(`Health: ${profile.health.trim()}`);
  if (profile.pressure?.trim()) parts.push(`Pressure: ${profile.pressure.trim()}`);
  const block = parts.join("\n").trim();
  return block ? block.slice(0, 1500) : "none";
}

export async function loadSummariesForQuoteSms(userId: string): Promise<string> {
  try {
    const [recentRes, dailyRes, weeklyRes] = await Promise.all([
      supabaseServer
        .from("recent_summary")
        .select("summary_text")
        .eq("clerk_user_id", userId)
        .maybeSingle(),
      supabaseServer
        .from("daily_summaries")
        .select("daily_summaries, day_number")
        .eq("clerk_user_id", userId)
        .order("day_number", { ascending: false })
        .limit(3),
      supabaseServer
        .from("weekly_summaries")
        .select("weekly_summary")
        .eq("clerk_user_id", userId)
        .order("week_end_day", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const lines: string[] = [];
    const rt = recentRes.data?.summary_text;
    if (rt && rt.trim()) lines.push(`Recent patterns: ${normalizeText(rt)}`);

    const rows = dailyRes.data;
    if (rows?.length) {
      const ordered = [...rows].reverse();
      const ds = ordered
        .map((r) =>
          normalizeText(
            `Day ${r.day_number}: ${String((r as { daily_summaries?: string }).daily_summaries ?? "")}`
          )
        )
        .filter(Boolean);
      if (ds.length) lines.push(`Recent practice notes:\n${ds.join("\n")}`);
    }

    const wk = weeklyRes.data?.weekly_summary;
    if (wk && wk.trim()) {
      lines.push(`Weekly reflection (excerpt): ${normalizeText(wk).slice(0, 500)}`);
    }

    return lines.join("\n\n").trim() || "none";
  } catch (err) {
    console.error("[generatePersonalizedQuoteMessage] summaries load failed:", err);
    return "none";
  }
}

function getOpenAI(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

export type QuotePersonalizationTone = "supportive" | "challenging" | "neutral";

/** Below this length (after trim), summaries are treated as empty for tone (reentry → supportive). */
const SUMMARIES_BLOCK_THIN_MAX_CHARS = 48;

const SUPPORTIVE_TONE_SIGNALS = [
  "low energy",
  "tired",
  "drained",
  "pressure",
  "overwhelmed",
  "struggling",
  "hard day",
  "difficult",
  "stressed",
  "off track",
] as const;

const CHALLENGING_TONE_SIGNALS = [
  "momentum",
  "showing up",
  "consistent",
  "follow through",
  "follow-through",
  "kept going",
  "discipline",
  "progress",
  "locked in",
] as const;

function isSummariesBlockThin(summariesBlock: string): boolean {
  const t = summariesBlock.trim();
  if (!t) return true;
  if (t.toLowerCase() === "none") return true;
  return t.length < SUMMARIES_BLOCK_THIN_MAX_CHARS;
}

/**
 * Lightweight tone from memory + profile text already used in the user prompt.
 * Thin / missing summaries default to supportive (reentry). Otherwise supportive
 * signals win over challenging, then challenging, then neutral.
 */
export function derivePersonalizationTone(
  summariesBlock: string,
  profileBlock: string
): QuotePersonalizationTone {
  if (isSummariesBlockThin(summariesBlock)) return "supportive";

  const text = `${summariesBlock}\n${profileBlock}`.toLowerCase();

  for (const signal of SUPPORTIVE_TONE_SIGNALS) {
    if (text.includes(signal)) return "supportive";
  }
  for (const signal of CHALLENGING_TONE_SIGNALS) {
    if (text.includes(signal)) return "challenging";
  }
  return "neutral";
}

const QUOTE_SMS_RULES_BASE = `You are writing a very short SMS that follows a Pat Summitt quote.

Rules:
- Output ONLY 2 or 3 sentences. No more.
- Each sentence should be short (8–18 words).
- Speak directly to the reader using their first name once if provided in the user message, and only when it fits naturally — never force it.
- If no real first name is provided in the user message, speak directly without a name — do not invent one, and do not use placeholders like "there" or "friend" as if they were a name.
- The first sentence should reflect the meaning of the quote in simple terms.
- The second sentence should apply it to their life or current situation (use context from the message when helpful; if context is thin, anchor to universal human experiences like effort, momentum, fatigue, doubt, or discipline).
- If you add a third sentence, keep it one short line in the same calm, encouraging tone.
- Calm. Encouraging. Simple words.
- No emojis. No exclamation marks.
- Do not quote Pat or speak as Pat.
- Do not repeat the quote.
- Do not mention summaries, profiles, or data.
`.trim();

function buildQuoteSmsSystemPrompt(tone: QuotePersonalizationTone): string {
  return `${QUOTE_SMS_RULES_BASE}

Tone for this user: ${tone}

Tone guidance:
- supportive → softer, encouraging, reduce pressure
- challenging → slightly push forward, reinforce growth
- neutral → balanced

You MUST follow the tone guidance strictly.
This tone should shape how you speak, not just what you say.
`.trim();
}

/** Builds the user prompt for the completion (exact wording used in production). */
export function buildPersonalizedQuoteUserPrompt(args: {
  quoteText: string;
  profileBlock: string;
  summariesBlock: string;
  /** When true, args.firstName is included. Otherwise the name block is omitted. */
  hasRealFirstName: boolean;
  firstName?: string;
}): string {
  const nameBlock = args.hasRealFirstName && args.firstName?.trim()
    ? `USER FIRST NAME:\n${args.firstName.trim()}`
    : "";

  return `
QUOTE (for your understanding only; do not include it in your output):
${args.quoteText}

${nameBlock ? `${nameBlock}\n\n` : ""}ONBOARDING / IDENTITY CONTEXT:
${args.profileBlock}

RECENT MEMORY / SUMMARIES:
${args.summariesBlock}

Write ONLY the 2-3 sentence personalized message (no quote, no greeting line, no sign-off).
`.trim();
}

/**
 * Returns coaching lines to place after the quote in an SMS, or empty string if skipped/failed.
 */
export async function generatePersonalizedQuoteMessage(args: {
  quoteText: string;
  firstName: string;
  summaries: string;
  profile: ProfileContext;
}): Promise<string> {
  const profileBlock = compactProfileForPrompt(args.profile);
  const summariesBlock = (args.summaries || "").trim() || "none";
  const rawName = (args.firstName || "").trim();
  const hasRealFirstName =
    rawName.length > 0 && rawName.toLowerCase() !== "there";

  const client = getOpenAI();
  if (!client) {
    console.warn("[generatePersonalizedQuoteMessage] OPENAI_API_KEY missing; quote only");
    return "";
  }

  const userPrompt = buildPersonalizedQuoteUserPrompt({
    quoteText: args.quoteText.trim(),
    profileBlock,
    summariesBlock,
    hasRealFirstName,
    ...(hasRealFirstName ? { firstName: rawName } : {}),
  });

  const tone = derivePersonalizationTone(summariesBlock, profileBlock);

  try {
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.55,
      max_tokens: 120,
      messages: [
        { role: "system", content: buildQuoteSmsSystemPrompt(tone) },
        { role: "user", content: userPrompt },
      ],
    });

    const out = res.choices[0]?.message?.content?.trim() ?? "";
    if (!out) return "";
    return out.replace(/!/g, ".").replace(/\s+/g, " ").trim();
  } catch (err) {
    console.error("[generatePersonalizedQuoteMessage] OpenAI failed:", err);
    return "";
  }
}

const DAY2_QUESTION_SYSTEM =
  "You write one striking coaching question for SMS Day 2. Output only the question text. No labels, no preamble. You MUST open with the user's first name in a natural, human way (for example: \"Tyler, what would it look like today if...\"). Name first, then a comma or brief pause, then the question — not robotic. If FIRST_NAME is clearly a placeholder like \"there\", open with direct second-person \"you\" instead and still keep it personal.";

/**
 * Personalized respond prompt for program Day 2 SMS (MCQ options still come from respond_day_questions).
 * Returns empty string if OpenAI is unavailable or the model returns nothing (caller falls back to DB prompts).
 */
export async function generateSmsDay2RespondQuestion(args: {
  firstName: string;
  profile: ProfileContext;
  eveningPrompt: boolean;
}): Promise<string> {
  const client = getOpenAI();
  if (!client) {
    console.warn("[generateSmsDay2RespondQuestion] OPENAI_API_KEY missing");
    return "";
  }

  const profileBlock = compactProfileForPrompt(args.profile);
  const rawName = (args.firstName || "").trim();

  const timeHint = args.eveningPrompt
    ? "The user receives this in the evening; the question may lean slightly more reflective."
    : "The user receives this in the morning; the question may lean slightly more forward-looking.";

  const userPrompt = `
FIRST_NAME (use this at the very start of the question when it is a real name; natural \"Name, ...\"):
${rawName || "(none on file — use second person you)"}

${timeHint}

USER CONTEXT (goals, training focus, life pressure — from onboarding):
${profileBlock}

Write ONE powerful question for SMS (at most 1–2 sentences).
Rules:
- No fluff, no explanation, no emojis, no labels like "Question:"
- No quotation marks wrapping the whole question
- No exclamation marks
- Ground it in what they said they want or where they asked for support when context exists; if context is thin, use universal but still specific language about showing up and identity.
`.trim();

  try {
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.5,
      max_tokens: 120,
      messages: [
        { role: "system", content: DAY2_QUESTION_SYSTEM },
        { role: "user", content: userPrompt },
      ],
    });

    const out = res.choices[0]?.message?.content?.trim() ?? "";
    if (!out) return "";
    return out.replace(/!/g, ".").replace(/\s+/g, " ").trim();
  } catch (err) {
    console.error("[generateSmsDay2RespondQuestion] OpenAI failed:", err);
    return "";
  }
}
