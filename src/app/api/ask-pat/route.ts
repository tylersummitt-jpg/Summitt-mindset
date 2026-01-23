import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getTopRelevantChunks } from "@/lib/ask-pat/chunks";
import { supabaseServer } from "@/lib/supabase-server";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";

const apiKey = process.env.OPENAI_API_KEY;

const openai = new OpenAI({
  apiKey,
});

export async function POST(req: NextRequest) {
  try {
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY missing in .env.local" },
        { status: 500 }
      );
    }

    // 1️⃣ Auth — identify the athlete
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { question } = await req.json();
    if (!question || typeof question !== "string") {
      return NextResponse.json(
        { error: "Question is required." },
        { status: 400 }
      );
    }

    const trimmedQuestion = question.trim();

    // 2️⃣ SAVE QUESTION TO MEMORY (raw memory)
    // Ask Pat questions are non-daily memory → day_number = 0
    await supabaseServer.from("journal_entries").insert({
      clerk_user_id: userId,
      day_number: 0, // ← IMPORTANT FIX
      content: trimmedQuestion,
    });

    // 3️⃣ Load recent MEMORY (compressed + safe)
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

    // 4️⃣ Embed the question
    const embed = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: trimmedQuestion,
    });

    const queryEmbedding = embed.data[0]?.embedding;
    if (!queryEmbedding) {
      throw new Error("Embedding failed.");
    }

    // 5️⃣ Retrieve Pat’s book context
    const topChunks = getTopRelevantChunks(queryEmbedding, 6);

    const bookContext =
      topChunks.length > 0
        ? topChunks
            .map(
              (chunk, idx) =>
                `Excerpt ${idx + 1} (Book: ${chunk.bookId}, Section: ${
                  chunk.sectionTitle
                }):\n${chunk.text}`
            )
            .join("\n\n")
        : "No relevant excerpts were found.";

    // 6️⃣ Memory-aware Pat Summitt system prompt
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

    // 7️⃣ Ask Pat
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

    return NextResponse.json({ answer });
  } catch (err) {
    console.error("Ask Pat error:", err);
    return NextResponse.json(
      { error: "Something went wrong processing your question." },
      { status: 500 }
    );
  }
}
