import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getTopRelevantChunks } from "@/lib/ask-pat/chunks";
import { supabaseServer } from "@/lib/supabase-server";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ASK_PAT_PER_DAY = 10;

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY missing in environment");
  }
  return new OpenAI({ apiKey });
}

function todayKeyUTC() {
  // YYYY-MM-DD in UTC
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  try {
    // 1️⃣ Auth — identify the athlete
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ======================================================
    // ✅ Anti-Spam Guard (CANONICAL)
    // ======================================================
    // Limit: 10 requests per user per UTC day
    const dayKey = todayKeyUTC();

    const { data: usageRows, error: usageErr } = await supabaseServer
      .from("ask_pat_usage")
      .select("id")
      .eq("clerk_user_id", userId)
      .eq("day_key", dayKey);

    if (usageErr) {
      console.error("Ask Pat usage lookup failed:", usageErr.message);

      // If we can't check usage, fail CLOSED (protect costs)
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

    // Record usage immediately (so retries still count)
    const { error: insertUsageErr } = await supabaseServer
      .from("ask_pat_usage")
      .insert({
        clerk_user_id: userId,
        day_key: dayKey,
      });

    if (insertUsageErr) {
      console.error("Ask Pat usage insert failed:", insertUsageErr.message);

      // Fail closed
      return NextResponse.json(
        {
          error: "Ask Pat is temporarily unavailable. Please try again later.",
          reason: "usage_insert_failed",
        },
        { status: 200 }
      );
    }

    // 2️⃣ Parse question
    const { question } = await req.json();
    if (!question || typeof question !== "string") {
      return NextResponse.json(
        { error: "Question is required." },
        { status: 400 }
      );
    }

    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      return NextResponse.json(
        { error: "Question is required." },
        { status: 400 }
      );
    }

    // 3️⃣ SAVE QUESTION TO MEMORY (raw memory)
    await supabaseServer.from("journal_entries").insert({
      clerk_user_id: userId,
      day_number: 0,
      content: trimmedQuestion,
    });

    // 4️⃣ Load recent MEMORY (compressed + safe)
    const memoryLines: string[] = [];

    // Last 7 daily summaries
    const { data: dailySummaries } = await supabaseServer
      .from("daily_summaries")
      .select("daily_summaries, day_number")
      .eq("clerk_user_id", userId)
      .order("day_number", { ascending: false })
      .limit(7);

    if (dailySummaries && dailySummaries.length > 0) {
      memoryLines.push("RECENT DAILY PRACTICE:");
      for (const row of dailySummaries.reverse()) {
        memoryLines.push(`- Day ${row.day_number}: ${row.daily_summaries}`);
      }
    }

    // Most recent weekly summary (if exists)
    const { data: weeklySummary } = await supabaseServer
      .from("weekly_summaries")
      .select("weekly_summary")
      .eq("clerk_user_id", userId)
      .order("week_end_day", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (weeklySummary?.weekly_summary) {
      memoryLines.push("");
      memoryLines.push("WEEKLY REFLECTION:");
      memoryLines.push(weeklySummary.weekly_summary);
    }

    const athleteContext =
      memoryLines.length > 0
        ? memoryLines.join("\n")
        : "No recent practice reflections available.";

    // ✅ OpenAI client created ONLY at request time
    const openai = getOpenAIClient();

    // 5️⃣ Embed the question
    const embed = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: trimmedQuestion,
    });

    const queryEmbedding = embed.data[0]?.embedding;
    if (!queryEmbedding) throw new Error("Embedding failed.");

    // 6️⃣ Retrieve Pat’s book context
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

    // 7️⃣ Memory-aware Pat Summitt system prompt
    const systemPrompt = `
You are **Pat Summitt**, legendary head coach of the University of Tennessee Lady Volunteers.

You are coaching THIS PERSON — not a generic leader.

====================
ATHLETE CONTEXT (REAL PRACTICE & REFLECTION)
${athleteContext}
====================

COACHING INSTRUCTIONS
- Reference patterns you see in their practice when relevant
- Be honest, firm, and specific
- Do not summarize their reflections — COACH them

STYLE RULES
- Teach through real stories from your career
- No corporate language
- No fluff

ANSWER STRUCTURE
1. Open with a story
2. Teach the principle
3. Coach the user directly
4. End with a Summitt-style challenge

SOURCE MATERIAL (FROM YOUR BOOKS)
${bookContext}
`.trim();

    // 8️⃣ Ask Pat
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: trimmedQuestion },
      ],
      temperature: 0.6,
    });

    const answer =
      completion.choices[0]?.message?.content ??
      "I don't have an answer right now.";

    return NextResponse.json({ answer, ok: true });
  } catch (err) {
    console.error("Ask Pat error:", err);
    return NextResponse.json(
      { error: "Something went wrong processing your question." },
      { status: 500 }
    );
  }
}
