// src/lib/coach-reply-generator.ts

import OpenAI from "openai";
import { getTopRelevantChunks } from "@/lib/ask-pat/chunks";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { buildProfileContext } from "@/lib/profile-context";
import {
  buildCoachPatContext,
  type CoachPatPatternInsight,
} from "@/lib/coach-pat-context";
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

function getSmsSelectionContext(message: string): string | null {
  const entries: Record<string, { selection: string; question: string }> = {
    // Day 1 (A–D maps via translateSmsReply dayNumber <= 7 after Days 2–7)
    "I need focus today": {
      selection: "Focus",
      question: "What do you need most today?",
    },
    "I need energy today": {
      selection: "Energy",
      question: "What do you need most today?",
    },
    "I need confidence today": {
      selection: "Confidence",
      question: "What do you need most today?",
    },
    "I need clarity today": {
      selection: "Clarity",
      question: "What do you need most today?",
    },

    // Day 2
    "I will rest today": {
      selection: "Rest",
      question: "How will you take care of yourself today?",
    },
    "I will move my body today": {
      selection: "Move your body",
      question: "How will you take care of yourself today?",
    },
    "I will fuel my body today": {
      selection: "Fuel your body",
      question: "How will you take care of yourself today?",
    },
    "I will clear my mind today": {
      selection: "Clear your mind",
      question: "How will you take care of yourself today?",
    },

    // Day 3
    "I will finish something I've been putting off today": {
      selection: "Finish something you've been putting off",
      question: "What kind of win will you get?",
    },
    "I will knock out a quick task today": {
      selection: "Knock out a quick task",
      question: "What kind of win will you get?",
    },
    "I will make progress on something important today": {
      selection: "Make progress on something important",
      question: "What kind of win will you get?",
    },
    "I will do something that makes me feel better today": {
      selection: "Do something that makes you feel better",
      question: "What kind of win will you get?",
    },

    // Day 4
    "I will stay focused on what matters today": {
      selection: "Stay focused on what matters",
      question: "How will you show up today?",
    },
    "I will keep my energy steady today": {
      selection: "Keep your energy steady",
      question: "How will you show up today?",
    },
    "I will follow through no matter what today": {
      selection: "Follow through no matter what",
      question: "How will you show up today?",
    },
    "I will stay positive and composed today": {
      selection: "Stay positive and composed",
      question: "How will you show up today?",
    },

    // Day 5
    "I will reset and start again today": {
      selection: "Reset and start again",
      question: "If today gets off track, how will you respond?",
    },
    "I will do one small thing today": {
      selection: "Do one small thing",
      question: "If today gets off track, how will you respond?",
    },
    "I will slow down and regroup today": {
      selection: "Slow down and regroup",
      question: "If today gets off track, how will you respond?",
    },
    "I will keep going no matter what today": {
      selection: "Keep going no matter what",
      question: "If today gets off track, how will you respond?",
    },

    // Day 6
    "I will show up focused today": {
      selection: "Focused",
      question: "How do you want to show up today?",
    },
    "I will show up steady today": {
      selection: "Steady",
      question: "How do you want to show up today?",
    },
    "I will show up disciplined today": {
      selection: "Disciplined",
      question: "How do you want to show up today?",
    },
    "I will show up positive today": {
      selection: "Positive",
      question: "How do you want to show up today?",
    },

    // Day 7
    "I am starting to build something": {
      selection: "Starting to build something",
      question: "Which one feels most true right now?",
    },
    "I am showing up more consistently": {
      selection: "Showing up more consistently",
      question: "Which one feels most true right now?",
    },
    "I am learning how to adjust": {
      selection: "Learning how to adjust",
      question: "Which one feels most true right now?",
    },
    "I am not there yet, but I am trying": {
      selection: "Not there yet, but trying",
      question: "Which one feels most true right now?",
    },
  };

  const entry = entries[message.trim()];
  if (!entry) return null;

  return `USER SELECTION:
${entry.selection}

QUESTION:
${entry.question}
`;
}

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
    // Allow natural acknowledgment; do not strip "you said" / "you wrote" / "you mentioned".
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

const SHORT_ACK_PHRASES = new Set([
  "ok",
  "okay",
  "got it",
  "cool",
  "thanks",
  "thank you",
  "will do",
  "sounds good",
]);

/** Very short acknowledgments: conversational reply, not full coaching arc. */
function isShortCoachReplyMessage(clean: string): boolean {
  const t = normalizeText(clean);
  if (!t) return false;
  if (t.length < 25) return true;
  const core = t.replace(/[.!?…]+$/gu, "").trim().toLowerCase();
  return SHORT_ACK_PHRASES.has(core);
}

function enforceHardCaps(
  text: string,
  source: "app" | "sms" = "app",
  maxSentences: number = 5
): string {
  const cap = Math.max(1, Math.min(maxSentences, 5));

  const sentences = splitIntoSentences(text);
  const cappedSentences = sentences.slice(0, cap);
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

  const practiceActionSignal =
    coachContext?.today_practice?.practice_action_signal?.trim() || "none";

  function primaryPatternForPrompt(
    patterns: CoachPatPatternInsight[] | undefined
  ): string {
    if (!patterns?.length) return "none";
    const first = patterns[0];
    const text = normalizeText(first?.pattern_text ?? "");
    if (text) return text;
    const key = normalizeText(first?.pattern_key ?? "");
    return key || "none";
  }

  const primaryPattern = primaryPatternForPrompt(coachContext?.patterns);

  const yesterdayContext =
    coachContext?.yesterday_summary?.text?.trim() || "none";

  const recentSummary = coachContext?.recent_summary?.summary_text || "none";

  const cleanUserMessage = normalizeText(userMessage);
  const isShortResponse = isShortCoachReplyMessage(cleanUserMessage);

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
    text = enforceHardCaps(
      text,
      source,
      isShortResponse ? 2 : 5
    );
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
- User profile information may be outdated. If the user has said something more recent that conflicts with their profile, prioritize the user's recent statements over the profile.
- Use the most relevant part of the user's identity when it strengthens the coaching moment.
- One paragraph
- Up to 5 sentences
- No emojis
- No exclamation marks
- No contractions
- Never explain how you know something
- You can still speak directly to what they are experiencing. Do not reference the source of your knowledge.
- Do not mention journals, summaries, or past entries explicitly. However, you SHOULD acknowledge the user's current experience in natural language by referencing what they are going through in your own words.
- Start your response by acknowledging the user's current situation in a specific and human way, based on their message.
- Use the most relevant identity detail when it strengthens the coaching moment. Avoid listing multiple unrelated details.
- When referencing patterns or behavior, prefer identity-based language. Instead of describing what the user did, reflect who they are becoming. Examples (keep natural, not repetitive):
  - "You're the kind of person who follows through"
  - "This is what consistency looks like for you"
  - "You're building the habit of showing up even when it's hard"
- When using patterns, translate them into natural identity language instead of repeating labels.
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
- Avoid specific time references like "yesterday", "last week", or exact time-based phrases. Instead, use general language like "recently", "the last time you showed up", or "you've been showing a pattern of".
- Include a brief moment of coaching authority. This can be: a short principle you have learned, or a very brief reference to your experience. Keep it to one sentence. Do not tell long stories.
- Prioritize encouragement over correction. Reinforce what the user is doing well before guiding what to do next.
- When appropriate, reinforce that the user's effort is working. Use subtle, grounded language such as:
  - "This is starting to become natural for you"
  - "You are settling into this"
  - "This is how change happens"
  - "You are building something that lasts"
  Avoid exaggeration or hype.
- Connect progress to identity when possible. Show that who they are becoming is leading to real change.
- Your response should feel:
  - mostly understanding and encouragement
  - lightly directional
  - grounded in calm authority
- Do not overwhelm the user with instruction.
- Structure your response like this (keep it flexible, not robotic):
  1. Acknowledge their current experience
  2. Reinforce who they are or how they are showing up
  3. Include one sentence of coaching authority
  4. Offer one simple direction or encouragement
- If SHORT_RESPONSE_MODE is true:
  - respond in 1–2 sentences only
  - keep it simple, warm, and human
  - do NOT follow the full coaching structure
  - do NOT add coaching authority unless it fits naturally
  - this should feel like a quick, natural response

${PAT_BRAND_SAFETY_RULES}
`.trim();

  const selectionContext = getSmsSelectionContext(cleanUserMessage);

  const userPrompt = `
SHORT_RESPONSE_MODE:
${isShortResponse ? "true" : "false"}

PROGRESSION:
- Total Days Completed: ${totalDaysCompleted}
- Current Day: ${currentDay}
- Days In Row: ${daysInRow}

GOAL: today's practice
DAY: ${dayNumber}

TODAY PRACTICE:
${practiceSummary}

PRACTICE ACTION:
${practiceActionSignal}

RECENTLY:
${yesterdayContext}

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

${selectionContext ? selectionContext : ""}
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
  raw = enforceHardCaps(raw, source, isShortResponse ? 2 : 5);
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