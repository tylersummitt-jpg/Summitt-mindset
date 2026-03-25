// src/lib/coach-reply-generator.ts

import OpenAI from "openai";
import { getTopRelevantChunks } from "@/lib/ask-pat/chunks";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { buildProfileContext } from "@/lib/profile-context";
import { buildCoachPatContext } from "@/lib/coach-pat-context";
import { supabaseServer } from "@/lib/supabase-server";
import { getDisplayNameForUser } from "@/lib/resolve-preferred-name";
import { finalizeWithName } from "@/lib/format-with-name";
import {
  assertTextSafeForBrand,
  COACH_REPLY_BLOCKED_FALLBACK,
  COACH_REPLY_OUTPUT_FALLBACK,
  lexicalSafetyPass,
  PAT_BRAND_SAFETY_RULES,
  sanitizeModelOutput,
} from "@/lib/ai-safety";

type Params = {
  userId: string;
  dayNumber: number;
  userMessage: string;
  actionItem?: string;
  source?: "app" | "sms";
};

export type CoachReplyMeta = {
  model: string;
  temperature: number;
  max_tokens: number;
  fallbackUsed: boolean;
};

export type CoachReplyResult = {
  text: string;
  meta: CoachReplyMeta;
};

/* ======================================================
   OpenAI
====================================================== */

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  return new OpenAI({ apiKey });
}

/* ======================================================
   Utilities
====================================================== */

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

function splitIntoSentences(text: string): string[] {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function expandContractions(text: string): string {
  return (text || "")
    .replace(/\byou['’]re\b/gi, "you are")
    .replace(/\bthey['’]re\b/gi, "they are")
    .replace(/\bwe['’]re\b/gi, "we are")
    .replace(/\bi['’]m\b/gi, "I am")
    .replace(/\bcan['’]t\b/gi, "cannot")
    .replace(/\bwon['’]t\b/gi, "will not")
    .replace(/\bit['’]s\b/gi, "it is")
    .replace(/\bthat['’]s\b/gi, "that is");
}

function removeApostrophes(text: string): string {
  return (text || "").replace(/['’]/g, "");
}

function stripMemoryMetaLanguage(text: string): string {
  let t = text || "";

  const patterns: RegExp[] = [
    /\b(as you said|as you wrote|you said|you wrote|you mentioned)\b/gi,
    /\b(earlier|previously|yesterday|last week|last month)\b/gi,
    /\b(from your journal|journal|journaling)\b/gi,
    /\b(reflection|summary|summaries)\b/gi,
    /\b(I remember|I recall|memory)\b/gi,
  ];

  for (const re of patterns) {
    t = t.replace(re, "");
  }

  return normalizeText(t);
}

function stripThirdPersonPatReferences(text: string): string {
  let t = text || "";
  const patterns: RegExp[] = [
    /\bPat used to say\b/gi,
    /\bPat believed\b/gi,
    /\bPat would say\b/gi,
    /\bCoach Pat\b/gi,
  ];
  for (const re of patterns) {
    t = t.replace(re, "");
  }
  return normalizeText(t);
}

function stripEmojis(text: string): string {
  return (text || "").replace(/\p{Emoji}/gu, "");
}

function finalizeOutput(text: string): string {
  let t = text || "";

  t = t.replace(/\n+/g, " ");
  t = t.replace(/!/g, ".");
  t = stripEmojis(t);

  t = t.replace(/\s+([,.!?])/g, "$1");
  t = t.replace(/([,.!?]){2,}/g, "$1");

  return normalizeText(t);
}

function enforceHardCaps(text: string, source: "app" | "sms" = "app"): string {
  const MAX_SENTENCES = 5;

  const sentences = splitIntoSentences(text);
  const cappedSentences = sentences.slice(0, MAX_SENTENCES);
  return normalizeText(cappedSentences.join(" "));
}

/** Hard character cap for SMS. Trim at sentence or word boundary. Never hard-slice. */
function enforceSmsCharCap(text: string, maxChars: number): string {
  if (!text || text.length <= maxChars) return text;
  const sentences = splitIntoSentences(text);
  let acc = "";
  for (const s of sentences) {
    const next = acc ? `${acc} ${s}` : s;
    if (next.length > maxChars) break;
    acc = next;
  }
  if (acc) return normalizeText(acc);
  if (sentences[0] && sentences[0].length <= maxChars) {
    return normalizeText(sentences[0]);
  }
  if (sentences[0]) {
    const words = sentences[0].split(" ").filter(Boolean);
    let built = "";
    for (const w of words) {
      const next = built ? `${built} ${w}` : w;
      if (next.length > maxChars) break;
      built = next;
    }
    return built ? normalizeText(built) : normalizeText(words[0] || "");
  }
  return normalizeText(text);
}

function firstSentence(text: string): string | null {
  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) return null;
  return normalizeText(sentences[0]);
}

function buildProfileBlock(profile: {
  identity?: string;
  relationships?: string;
  work?: string;
  health?: string;
  pressure?: string;
}): string {
  const lines: string[] = [];

  if (profile.identity) lines.push(`IDENTITY: ${profile.identity}`);
  if (profile.relationships) lines.push(`RELATIONSHIPS: ${profile.relationships}`);
  if (profile.work) lines.push(`WORK: ${profile.work}`);
  if (profile.health) lines.push(`HEALTH: ${profile.health}`);
  if (profile.pressure) lines.push(`PRESSURE: ${profile.pressure}`);

  return lines.length ? lines.join("\n") : "PROFILE: none";
}

/* ======================================================
   Conversation Context
====================================================== */

async function loadRecentConversation(userId: string, dayNumber: number) {
  const { data } = await supabaseServer
    .from("coach_conversations")
    .select("role, content")
    .eq("clerk_user_id", userId)
    .eq("day_number", dayNumber)
    .order("created_at", { ascending: true })
    .limit(6);

  if (!data || data.length === 0) {
    return {
      conversation: "none",
      lastCoachInsight: "none",
    };
  }

  const conversation = data
    .slice(-6)
    .map((m) => `${m.role.toUpperCase()}: ${normalizeText(m.content)}`)
    .join("\n");

  const lastCoachMessage = [...data]
    .reverse()
    .find((m) => normalizeText(m.role).toLowerCase() === "coach");

  const lastCoachInsight =
    firstSentence(normalizeText(lastCoachMessage?.content ?? "")) || "none";

  return {
    conversation,
    lastCoachInsight,
  };
}

async function loadMemorySummaries(userId: string) {
  let dailySummariesBlock = "none";
  let weeklySummaryBlock = "none";

  try {
    const { data: dailySummaries, error: dailyErr } = await supabaseServer
      .from("daily_summaries")
      .select("daily_summaries, day_number")
      .eq("clerk_user_id", userId)
      .order("day_number", { ascending: false })
      .limit(3);

    if (dailyErr) {
      console.error("Coach reply daily_summaries failed:", dailyErr.message);
    } else if (dailySummaries && dailySummaries.length > 0) {
      const lines = [...dailySummaries]
        .reverse()
        .map((row) => `Day ${row.day_number}: ${row.daily_summaries}`)
        .filter(Boolean);

      if (lines.length > 0) {
        dailySummariesBlock = lines.join("\n");
      }
    }

    const { data: weeklySummary, error: weeklyErr } = await supabaseServer
      .from("weekly_summaries")
      .select("weekly_summary")
      .eq("clerk_user_id", userId)
      .order("week_end_day", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (weeklyErr) {
      console.error("Coach reply weekly_summaries failed:", weeklyErr.message);
    } else if (weeklySummary?.weekly_summary) {
      weeklySummaryBlock = normalizeText(weeklySummary.weekly_summary);
    }
  } catch (err) {
    console.error("Coach reply memory summaries failed:", err);
  }

  return { dailySummariesBlock, weeklySummaryBlock };
}

async function loadTodayJournalEntry(userId: string, dayNumber: number) {
  try {
    const { data } = await supabaseServer
      .from("journal_entries")
      .select("content")
      .eq("clerk_user_id", userId)
      .eq("day_number", dayNumber)
      .maybeSingle();

    return normalizeText(data?.content ?? "") || "none";
  } catch (err) {
    console.error("Coach reply journal load failed:", err);
    return "none";
  }
}

/* ======================================================
   Fallback
====================================================== */

function fallbackReply(dayNumber: number): string {
  if (dayNumber <= 7) {
    return "Good. Keep it simple. Do the next right thing today. Then do it again tomorrow.";
  }
  if (dayNumber <= 30) {
    return "Good. Stay steady. Do one small thing that matches your goal. Then stop.";
  }
  return "Good. Stay disciplined. Keep your standard today. Then reset for tomorrow.";
}

/* ======================================================
   Generator
====================================================== */

const SMS_HARD_CHAR_CAP = 280;

export async function generateCoachReply({
  userId,
  dayNumber,
  userMessage,
  actionItem,
  source = "app",
}: Params): Promise<CoachReplyResult> {
  const openai = getOpenAIClient();

  const MODEL = "gpt-4.1-mini";
  const TEMPERATURE = 0.5;
  const isSms = source === "sms";
  const MAX_TOKENS = isSms ? 180 : 220;

  const md = await getClerkPublicMetadata(userId);
  const totalDaysCompleted = md?.totalDaysCompleted ?? 0;
  const daysInRow = md?.daysInRow ?? 0;
  const currentDay = md?.currentDay ?? dayNumber;

  const profile = await buildProfileContext(userId);

  const coachContext = await buildCoachPatContext({
    userId,
    dayNumber,
    actionItem: actionItem ?? "",
  });

  const { conversation, lastCoachInsight } = await loadRecentConversation(
    userId,
    dayNumber
  );

  const { dailySummariesBlock, weeklySummaryBlock } =
    await loadMemorySummaries(userId);

  const todayJournal = await loadTodayJournalEntry(userId, dayNumber);

  const practiceSummary = coachContext?.today_practice?.practice_summary || "none";

  const primaryPattern =
    Array.isArray(coachContext?.patterns) && coachContext.patterns.length
      ? coachContext.patterns[0]
      : "none";

  const recentSummary = coachContext?.recent_summary?.summary_text || "none";

  const cleanUserMessage = normalizeText(userMessage);

  const combinedUserFacingInput = [
    cleanUserMessage,
    todayJournal !== "none" ? todayJournal : "",
  ]
    .filter((s) => s.length > 0)
    .join("\n\n");

  const inputSafe = await assertTextSafeForBrand(
    openai,
    combinedUserFacingInput.length > 0 ? combinedUserFacingInput : cleanUserMessage
  );

  if (!inputSafe.ok) {
    let text = COACH_REPLY_BLOCKED_FALLBACK;
    text = expandContractions(text);
    text = removeApostrophes(text);
    text = stripMemoryMetaLanguage(text);
    text = stripThirdPersonPatReferences(text);
    text = finalizeOutput(text);
    text = enforceHardCaps(text, source);
    if (source === "sms") text = enforceSmsCharCap(text, SMS_HARD_CHAR_CAP);
    const displayName = await getDisplayNameForUser(userId);
    text = finalizeWithName(text, displayName ?? undefined);
    if (!lexicalSafetyPass(text)) {
      text = COACH_REPLY_BLOCKED_FALLBACK;
    }
    return {
      text,
      meta: {
        model: MODEL,
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS,
        fallbackUsed: true,
      },
    };
  }

  // Retrieve a relevant Pat story using embeddings
  let storyContext = "none";

  try {
    const embed = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: cleanUserMessage,
    });

    const queryEmbedding = embed.data?.[0]?.embedding;

    if (queryEmbedding) {
      const chunks = getTopRelevantChunks(queryEmbedding, 1);
      if (chunks.length > 0) {
        storyContext = chunks[0].text;
      }
    }
  } catch (err) {
    console.error("Coach story retrieval failed:", err);
  }

  const systemPrompt = `
You are Coach Pat Summitt.

Voice:
Calm. Direct. Simple language. Short sentences.

Rules:
- One paragraph
- Up to 5 sentences
- No emojis
- No exclamation marks
- No contractions
- Never explain how you know something
- Never mention journals, summaries, or past entries
- Use at most ONE personal detail
- Use at most ONE pattern
- When helpful, reference patterns from the athlete's recent practice history.
- Use LAST_COACH_INSIGHT only to avoid repeating yourself
- Do not quote LAST_COACH_INSIGHT back word-for-word
- If the user is circling the same issue, move the coaching forward one step
- Speak directly as Pat in first person.
- Use "I" or "my" when referencing your experience.
- Never refer to Pat in third person.
- Do not say phrases like "Pat used to say", "Pat believed", "Pat would say", or "Coach Pat".
- If the user has built consistency (multiple days or streak), you may acknowledge it briefly in a calm, grounded way. Never over-celebrate. Keep it subtle and matter-of-fact.
- Do not mention progression every time. Only reference it when it genuinely strengthens the coaching moment.

${PAT_BRAND_SAFETY_RULES}
`.trim();

  const userPrompt = `
PROGRESSION:
- Total Days Completed: ${totalDaysCompleted}
- Current Day: ${currentDay}
- Days In Row: ${daysInRow}

GOAL: today's practice
DAY: ${dayNumber}

TODAY PRACTICE:
${practiceSummary}

TODAY'S JOURNAL REFLECTION:
${todayJournal}

RECENT DAILY PRACTICE:
${dailySummariesBlock}

WEEKLY REFLECTION:
${weeklySummaryBlock}

PATTERN:
${primaryPattern}

RECENT SUMMARY:
${recentSummary}

LAST COACH INSIGHT:
${lastCoachInsight}

RECENT CONVERSATION:
${conversation}

RELEVANT STORY FROM YOUR CAREER:
${storyContext}

${buildProfileBlock(profile)}

USER MESSAGE:
${cleanUserMessage}

Write the coach reply.

Guidelines:
- Match the depth of the user.
- If they ask for help, give one principle and one action.
- If they are short, be short.
- If they are reflective, respond calmly.
- The practice may influence today's standard.
- The pattern may shape the coaching insight.
- LAST COACH INSIGHT is for continuity, not repetition.
- Push the conversation one step forward when appropriate.
`.trim();

  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const fallback = fallbackReply(dayNumber);

  let raw = completion.choices[0]?.message?.content?.trim() || fallback;
  const fallbackUsed = !completion.choices[0]?.message?.content;

  raw = await sanitizeModelOutput(openai, raw, COACH_REPLY_OUTPUT_FALLBACK);

  raw = expandContractions(raw);
  raw = removeApostrophes(raw);
  raw = stripMemoryMetaLanguage(raw);
  raw = stripThirdPersonPatReferences(raw);
  raw = finalizeOutput(raw);
  raw = enforceHardCaps(raw, source);
  if (source === "sms") raw = enforceSmsCharCap(raw, SMS_HARD_CHAR_CAP);

  if (!raw || raw.length < 10) {
    raw = fallback;
  }

  const displayName = await getDisplayNameForUser(userId);
  raw = finalizeWithName(raw, displayName ?? undefined);

  if (!lexicalSafetyPass(raw)) {
    raw = COACH_REPLY_OUTPUT_FALLBACK;
  }

  return {
    text: raw,
    meta: {
      model: MODEL,
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
      fallbackUsed,
    },
  };
}