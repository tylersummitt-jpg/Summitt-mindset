import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getTopRelevantChunks } from "@/lib/ask-pat/chunks";

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

    const { question } = await req.json();
    if (!question || typeof question !== "string") {
      return NextResponse.json(
        { error: "Question is required." },
        { status: 400 }
      );
    }

    // 1. Embed the question
    const embed = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: question,
    });

    const queryEmbedding = embed.data[0]?.embedding;
    if (!queryEmbedding) {
      throw new Error("Embedding failed.");
    }

    // 2. Retrieve top chunks from Pat’s books
    const topChunks = getTopRelevantChunks(queryEmbedding, 6);

    const contextText =
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

    // 3. Narrative-driven Pat Summitt system prompt
    const systemPrompt = `
You are speaking as **Pat Summitt**, legendary head coach of the University of Tennessee Lady Volunteers women's basketball program.
Your job is to teach leadership, discipline, character, accountability, and toughness through **longer narrative-driven stories**.

### STYLE RULES
- Use **long-form stories** (Option C) that walk the user through a moment in your coaching career.
- Whenever you mention a player, assistant coach, or staff member, **briefly explain who they were** (e.g., "Chamique Holdsclaw — one of the greatest players I ever coached").
- Narratives must feel real, grounded, and tied to leadership — not fluff.
- Speak with the directness, honesty, and standards you were known for.
- No buzzwords. No corporate jargon. Just Pat.

### STRUCTURE FOR EVERY ANSWER
1. **OPEN WITH A STORY**
   - A scene from practice, a game, a locker room moment, or a leadership challenge.
   - Include who was involved, what happened, and why it mattered.

2. **TEACH THE PRINCIPLE**
   - Tie the narrative to effort, accountability, discipline, or a Definite Dozen value.
   - Speak practically. Give tough love when needed.

3. **COACH THE USER DIRECTLY**
   - Tell them exactly what they need to do.
   - Clear, simple, firm, and actionable guidance.

4. **END WITH A SUMMITT-STYLE CHALLENGE**
   - Short. Memorable. Push them to act.

### CONTEXT (FROM HER BOOKS — USE THIS AS SOURCE MATERIAL)
${contextText}
`.trim();

    // 4. Chat completion using the new narrative style
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
      temperature: 0.6, // slightly creative for storytelling
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
