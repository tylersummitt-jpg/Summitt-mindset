import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getTopRelevantChunks } from "@/lib/ask-pat/chunks";
import { supabaseServer } from "@/lib/supabase-server";
import { auth } from "@clerk/nextjs/server";
import { buildProfileContext } from "@/lib/profile-context";
import { getDisplayNameForUser } from "@/lib/resolve-preferred-name";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ASK_PAT_PER_DAY = 10;

/**
 * NOTE TO SELF (ChatGPT):
 * Ask Pat questions must NOT be stored in journal_entries.
 * journal_entries has UNIQUE (clerk_user_id, day_number) and is reserved for Daily OS journaling.
 * Ask Pat is unlimited per day/lifetime, so it writes to ask_pat_questions instead.
 */

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY missing in environment");
  }
  return new OpenAI({ apiKey });
}

function todayKeyUTC() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
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

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dayKey = todayKeyUTC();

    const { data: usageRows, error: usageErr } = await supabaseServer
      .from("ask_pat_usage")
      .select("id")
      .eq("clerk_user_id", userId)
      .eq("day_key", dayKey);

    if (usageErr) {
      console.error("Ask Pat usage lookup failed:", usageErr.message);

      return NextResponse.json(
        {
          error: "Ask Pat is temporarily unavailable. Please try again later.",
          reason: "usage_check_failed",
        },
        { status: 200 }
      );
    }

    const usedCount = usageRows?.length ?? 0;

    if (usedCount >= MAX_ASK_PAT_PER_DAY) {
      return NextResponse.json(
        {
          error:
            "You’ve hit today’s Ask Pat limit. Come back tomorrow — one good question a day compounds.",
          reason: "rate_limited",
          limitPerDay: MAX_ASK_PAT_PER_DAY,
        },
        { status: 200 }
      );
    }

    const { error: insertUsageErr } = await supabaseServer
      .from("ask_pat_usage")
      .insert({
        clerk_user_id: userId,
        day_key: dayKey,
      });

    if (insertUsageErr) {
      console.error("Ask Pat usage insert failed:", insertUsageErr.message);

      return NextResponse.json(
        {
          error: "Ask Pat is temporarily unavailable. Please try again later.",
          reason: "usage_insert_failed",
        },
        { status: 200 }
      );
    }

    const { question } = await req.json();
    if (!question || typeof question !== "string") {
      return NextResponse.json(
        { error: "Question is required." },
        { status: 400 }
      );
    }

    const trimmedQuestion = normalizeText(question);
    if (!trimmedQuestion) {
      return NextResponse.json(
        { error: "Question is required." },
        { status: 400 }
      );
    }

    const { error: askPatSaveErr } = await supabaseServer
      .from("ask_pat_questions")
      .insert({
        clerk_user_id: userId,
        day_key: dayKey,
        question: trimmedQuestion,
      });

    if (askPatSaveErr) {
      console.error("Ask Pat question save failed:", askPatSaveErr.message);
    }

    const profile = await buildProfileContext(userId);

    const memoryLines: string[] = [];

    const { data: dailySummaries, error: dailyErr } = await supabaseServer
      .from("daily_summaries")
      .select("daily_summaries, day_number")
      .eq("clerk_user_id", userId)
      .order("day_number", { ascending: false })
      .limit(7);

    if (dailyErr) {
      console.error("Ask Pat daily_summaries lookup failed:", dailyErr.message);
    }

    if (dailySummaries && dailySummaries.length > 0) {
      memoryLines.push("RECENT DAILY PRACTICE:");
      for (const row of dailySummaries.reverse()) {
        memoryLines.push(`- Day ${row.day_number}: ${row.daily_summaries}`);
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
      console.error("Ask Pat weekly_summaries lookup failed:", weeklyErr.message);
    }

    if (weeklySummary?.weekly_summary) {
      memoryLines.push("");
      memoryLines.push("WEEKLY REFLECTION:");
      memoryLines.push(weeklySummary.weekly_summary);
    }

    const athleteContext =
      memoryLines.length > 0
        ? memoryLines.join("\n")
        : "No recent practice reflections available.";

    const openai = getOpenAIClient();

    const embed = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: trimmedQuestion,
    });

    const queryEmbedding = embed.data[0]?.embedding;
    if (!queryEmbedding) throw new Error("Embedding failed.");

    const topChunks = getTopRelevantChunks(queryEmbedding, 6);

    const bookContext =
      topChunks.length > 0
        ? topChunks
            .map(
              (chunk, idx) =>
                `Excerpt ${idx + 1} (Book: ${chunk.bookId}, Section: ${chunk.sectionTitle}):\n${chunk.text}`
            )
            .join("\n\n")
        : "No relevant excerpts were found.";

    const systemPrompt = `
You are **Pat Summitt**, legendary head coach of the University of Tennessee Lady Volunteers.

You are coaching THIS PERSON — not a generic leader.

====================
PERSONAL CONTEXT
${buildProfileBlock(profile)}
====================

====================
ATHLETE CONTEXT (REAL PRACTICE & REFLECTION)
${athleteContext}
====================

COACHING INSTRUCTIONS
- Use the personal context when it truly helps, but do not lean on too many personal details at once.
- Reference patterns you see in their practice when relevant.
- Be honest, firm, and specific.
- Do not summarize their reflections — coach them.
- Never mention how you know anything about them.
- Do not say "you said" or "you wrote."

STYLE RULES
- Teach through real stories from your career.
- No corporate language.
- No fluff.

ANSWER STRUCTURE
1. Open with a story
2. Teach the principle
3. Coach the user directly
4. End with a Summitt-style challenge

SOURCE MATERIAL (FROM YOUR BOOKS)
${bookContext}
`.trim();

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: trimmedQuestion },
      ],
      temperature: 0.6,
    });

    let answer =
      completion.choices[0]?.message?.content ??
      "I don't have an answer right now.";

    const displayName = await getDisplayNameForUser(userId);
    if (displayName) {
      answer = `${displayName}, ${answer}`;
    }

    return NextResponse.json({ answer, ok: true });
  } catch (err) {
    console.error("Ask Pat error:", err);
    return NextResponse.json(
      { error: "Something went wrong processing your question." },
      { status: 500 }
    );
  }
}